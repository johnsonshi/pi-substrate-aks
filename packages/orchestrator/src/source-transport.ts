import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { extract } from "tar-stream";

const DEFAULT_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_PATCH_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_FILES = 10_000;
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
const SHA_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const PROTECTED_PATHS = new Set([
  "AGENTS.md",
  "DESIGN.md",
  "INITIAL_PROMPT.md",
  "SECURITY.md",
  "packages/copilot-broker/src/actor-token-authorizer.ts",
  "packages/copilot-broker/src/http-server.ts",
  "packages/orchestrator/src/source-transport.ts",
  "packages/pi-actor/src/workspace-policy.ts",
  "scripts/preflight.sh",
]);
const CREDENTIAL_FILE_NAMES = new Set([
  ".npmrc",
  ".pypirc",
  ".netrc",
  "auth.json",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ed25519",
  "id_ecdsa",
  "id_rsa",
  "kubeconfig",
]);
const CREDENTIAL_DIRECTORIES = new Set([
  ".azure",
  ".copilot",
  ".kube",
  ".ssh",
]);
const CREDENTIAL_CONTENT_PATTERNS = [
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:access_token|refresh_token|client_secret)\s*[:=]\s*["']?[A-Za-z0-9._~-]{16,}/i,
  /\bAuthorization:\s*Bearer\s+[A-Za-z0-9._~-]{16,}/i,
];

export interface SourceArchiveEntry {
  path: string;
  mode: 0o644 | 0o755;
  size: number;
  sha256: string;
}

export interface SourceArchiveArtifact {
  path: string;
  revision: string;
  sha256: string;
  bytes: number;
  entries: SourceArchiveEntry[];
}

export interface ActorWorkspaceBaseline {
  path: string;
  sourceRevision: string;
  baselineCommit: string;
}

export interface PatchArtifact {
  path: string;
  sourceRevision: string;
  sha256: string;
  bytes: number;
  changedPaths: string[];
}

export interface SourceTransportOptions {
  maxArchiveBytes?: number;
  maxPatchBytes?: number;
  maxFiles?: number;
  maxFileBytes?: number;
}

export interface ApplyPatchOptions {
  allowProtectedPaths?: boolean;
}

interface ParsedArchiveEntry extends SourceArchiveEntry {
  content: Buffer;
}

interface RunOptions {
  cwd: string;
  maxOutputBytes: number;
  extraEnv?: Readonly<Record<string, string>>;
}

export class SourceTransport {
  readonly #maxArchiveBytes: number;
  readonly #maxPatchBytes: number;
  readonly #maxFiles: number;
  readonly #maxFileBytes: number;

  constructor(options: SourceTransportOptions = {}) {
    this.#maxArchiveBytes =
      options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
    this.#maxPatchBytes = options.maxPatchBytes ?? DEFAULT_MAX_PATCH_BYTES;
    this.#maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.#maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  async createSourceArchive(
    repositoryPath: string,
    revision: string,
    outputPath: string,
  ): Promise<SourceArchiveArtifact> {
    const repository = await realpath(repositoryPath);
    const archivePath = resolve(outputPath);
    assertArtifactLocation(repository, archivePath);
    await ensureAbsent(archivePath);
    await mkdir(dirname(archivePath), { recursive: true, mode: 0o700 });
    const revisionOutput = await run(
      "git",
      ["rev-parse", "--verify", `${revision}^{commit}`],
      {
        cwd: repository,
        maxOutputBytes: 1_024,
      },
    );
    const sourceRevision = revisionOutput.toString("utf8").trim();
    if (!SHA_PATTERN.test(sourceRevision)) {
      throw new Error("Git revision did not resolve to a commit");
    }
    await this.#validateSourceTree(repository, sourceRevision);
    await run(
      "git",
      [
        "archive",
        "--format=tar",
        `--output=${archivePath}`,
        sourceRevision,
      ],
      {
        cwd: repository,
        maxOutputBytes: 1_024,
      },
    );
    await chmod(archivePath, 0o600);
    const archive = await readBoundedFile(
      archivePath,
      this.#maxArchiveBytes,
      "Source archive",
    );
    const entries = await parseArchive(
      archive,
      this.#maxFiles,
      this.#maxFileBytes,
    );
    for (const entry of entries) {
      assertNoCredentialContent(entry.content);
    }
    return {
      path: archivePath,
      revision: sourceRevision,
      sha256: sha256(archive),
      bytes: archive.length,
      entries: entries.map(({ content: _content, ...entry }) => entry),
    };
  }

  async materializeSourceArchive(
    artifact: SourceArchiveArtifact,
    workspacePath: string,
  ): Promise<void> {
    const workspace = resolve(workspacePath);
    await ensureAbsent(workspace);
    const archive = await readBoundedFile(
      artifact.path,
      this.#maxArchiveBytes,
      "Source archive",
    );
    if (
      archive.length !== artifact.bytes ||
      sha256(archive) !== artifact.sha256
    ) {
      throw new Error("Source archive integrity check failed");
    }
    const entries = await parseArchive(
      archive,
      this.#maxFiles,
      this.#maxFileBytes,
    );
    assertArchiveManifest(artifact.entries, entries);
    await mkdir(workspace, { mode: 0o700 });
    try {
      for (const entry of entries) {
        const target = resolve(workspace, entry.path);
        assertInside(workspace, target);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, entry.content, {
          flag: "wx",
          mode: entry.mode,
        });
      }
    } catch (error) {
      await rm(workspace, { recursive: true, force: true });
      throw error;
    }
  }

  async initializeActorBaseline(
    workspacePath: string,
    sourceRevision: string,
  ): Promise<ActorWorkspaceBaseline> {
    const workspace = await realpath(workspacePath);
    assertRevision(sourceRevision);
    await run("git", ["init", "--initial-branch=actor"], {
      cwd: workspace,
      maxOutputBytes: 8_192,
    });
    await run(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "add",
        "--force",
        "--all",
        "--",
        ".",
      ],
      {
        cwd: workspace,
        maxOutputBytes: 8_192,
      },
    );
    await run(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgSign=false",
        "commit",
        "--no-gpg-sign",
        "-m",
        `actor baseline ${sourceRevision}`,
      ],
      {
        cwd: workspace,
        maxOutputBytes: 8_192,
        extraEnv: gitIdentityEnvironment(),
      },
    );
    const baseline = (
      await run("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
        cwd: workspace,
        maxOutputBytes: 1_024,
      })
    )
      .toString("utf8")
      .trim();
    assertRevision(baseline);
    return {
      path: workspace,
      sourceRevision,
      baselineCommit: baseline,
    };
  }

  async exportActorPatch(
    baseline: ActorWorkspaceBaseline,
    outputPath: string,
  ): Promise<PatchArtifact> {
    const workspace = await realpath(baseline.path);
    assertRevision(baseline.sourceRevision);
    const patchPath = resolve(outputPath);
    if (relativeInside(workspace, patchPath) !== undefined) {
      throw new Error("Patch artifact must be outside the actor workspace");
    }
    await ensureAbsent(patchPath);
    await scanWorkspace(workspace, this.#maxFiles, this.#maxFileBytes);
    await run(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "add",
        "--force",
        "--all",
        "--",
        ".",
      ],
      {
        cwd: workspace,
        maxOutputBytes: 8_192,
      },
    );
    const changedPaths = parseNullPaths(
      await run(
        "git",
        ["diff", "--cached", "--name-only", "-z", "HEAD", "--", "."],
        {
          cwd: workspace,
          maxOutputBytes: this.#maxPatchBytes,
        },
      ),
    );
    if (changedPaths.length === 0) {
      throw new Error("Actor produced no source changes");
    }
    for (const path of changedPaths) {
      validateTransportPath(path);
      assertNotCredentialPath(path);
    }
    await scanChangedFileContents(
      workspace,
      changedPaths,
      this.#maxFileBytes,
    );
    const patch = await run(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "diff",
        "--cached",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "HEAD",
        "--",
        ".",
      ],
      {
        cwd: workspace,
        maxOutputBytes: this.#maxPatchBytes,
      },
    );
    if (patch.length === 0) {
      throw new Error("Actor patch is empty");
    }
    assertNoCredentialContent(patch);
    await mkdir(dirname(patchPath), { recursive: true, mode: 0o700 });
    await writeFile(patchPath, patch, { flag: "wx", mode: 0o600 });
    return {
      path: patchPath,
      sourceRevision: baseline.sourceRevision,
      sha256: sha256(patch),
      bytes: patch.length,
      changedPaths,
    };
  }

  async applyValidatedPatch(
    repositoryPath: string,
    source: SourceArchiveArtifact,
    patch: PatchArtifact,
    options: ApplyPatchOptions = {},
  ): Promise<string[]> {
    const repository = await realpath(repositoryPath);
    assertArtifactLocation(repository, resolve(patch.path));
    assertRevision(source.revision);
    if (source.revision !== patch.sourceRevision) {
      throw new Error("Patch source revision does not match the archive");
    }
    const patchBytes = await readBoundedFile(
      patch.path,
      this.#maxPatchBytes,
      "Actor patch",
    );
    if (
      patchBytes.length !== patch.bytes ||
      sha256(patchBytes) !== patch.sha256
    ) {
      throw new Error("Actor patch integrity check failed");
    }
    assertNoCredentialContent(patchBytes);
    await assertTrustedRepositoryState(repository, source.revision);

    const stateDirectory = join(repository, ".state");
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    const validationRoot = await mkdtemp(
      join(stateDirectory, "patch-validation-"),
    );
    const validationWorkspace = join(validationRoot, "workspace");
    try {
      await this.materializeSourceArchive(source, validationWorkspace);
      await this.initializeActorBaseline(
        validationWorkspace,
        source.revision,
      );
      await run(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "apply",
          "--binary",
          "--index",
          "--whitespace=error-all",
          patch.path,
        ],
        {
          cwd: validationWorkspace,
          maxOutputBytes: 8_192,
        },
      );
      await scanWorkspace(
        validationWorkspace,
        this.#maxFiles,
        this.#maxFileBytes,
      );
      await assertGitIndexModes(validationWorkspace, this.#maxPatchBytes);
      const validatedPaths = parseNullPaths(
        await run(
          "git",
          ["diff", "--cached", "--name-only", "-z", "HEAD", "--", "."],
          {
            cwd: validationWorkspace,
            maxOutputBytes: this.#maxPatchBytes,
          },
        ),
      );
      assertSamePaths(patch.changedPaths, validatedPaths);
      for (const path of validatedPaths) {
        validateTransportPath(path);
        assertNotCredentialPath(path);
        if (
          options.allowProtectedPaths !== true &&
          isProtectedPath(path)
        ) {
          throw new Error("Actor patch changes protected safety policy");
        }
      }
      await scanChangedFileContents(
        validationWorkspace,
        validatedPaths,
        this.#maxFileBytes,
      );

      await assertTrustedRepositoryState(repository, source.revision);
      await run(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "apply",
          "--binary",
          "--index",
          "--whitespace=error-all",
          patch.path,
        ],
        {
          cwd: repository,
          maxOutputBytes: 8_192,
        },
      );
      return validatedPaths;
    } finally {
      await rm(validationRoot, { recursive: true, force: true });
    }
  }

  async #validateSourceTree(
    repository: string,
    sourceRevision: string,
  ): Promise<void> {
    const tree = await run(
      "git",
      ["ls-tree", "-r", "-z", "--full-tree", sourceRevision],
      {
        cwd: repository,
        maxOutputBytes: this.#maxArchiveBytes,
      },
    );
    const records = splitNull(tree);
    if (records.length > this.#maxFiles) {
      throw new Error("Source tree exceeds the file-count limit");
    }
    for (const record of records) {
      const separator = record.indexOf("\t");
      if (separator < 0) {
        throw new Error("Git tree entry is malformed");
      }
      const metadata = record.slice(0, separator);
      const path = record.slice(separator + 1);
      const match = /^([0-7]{6}) (blob|commit) ([0-9a-f]{40}(?:[0-9a-f]{24})?)$/.exec(
        metadata,
      );
      if (match === null || match[1] === undefined || match[2] === undefined) {
        throw new Error("Git tree entry is unsupported");
      }
      validateTransportPath(path);
      assertNotCredentialPath(path);
      if (match[2] !== "blob" || !["100644", "100755"].includes(match[1])) {
        throw new Error("Source tree contains a link or unsupported entry");
      }
    }
  }
}

async function parseArchive(
  archive: Buffer,
  maxFiles: number,
  maxFileBytes: number,
): Promise<ParsedArchiveEntry[]> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const parser = extract();
    const entries: ParsedArchiveEntry[] = [];
    const seen = new Set<string>();
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      parser.destroy(toError(error));
      rejectPromise(toError(error));
    };
    parser.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxFileBytes) {
          fail(new Error("Source archive entry exceeds the size limit"));
          return;
        }
        chunks.push(chunk);
      });
      stream.once("error", fail);
      stream.once("end", () => {
        if (settled) {
          return;
        }
        try {
          if (
            header.type === "pax-global-header" ||
            header.type === "pax-header"
          ) {
            next();
            return;
          }
          if (header.type === "directory") {
            validateTransportPath(header.name.replace(/\/+$/, ""));
            next();
            return;
          }
          if (header.type !== "file") {
            throw new Error("Source archive contains a link or unsupported entry");
          }
          const path = header.name;
          validateTransportPath(path);
          assertNotCredentialPath(path);
          if (seen.has(path)) {
            throw new Error("Source archive contains duplicate paths");
          }
          seen.add(path);
          if (entries.length >= maxFiles) {
            throw new Error("Source archive exceeds the file-count limit");
          }
          const content = Buffer.concat(chunks);
          entries.push({
            path,
            mode: (header.mode ?? 0) & 0o111 ? 0o755 : 0o644,
            size: content.length,
            sha256: sha256(content),
            content,
          });
          next();
        } catch (error) {
          fail(error);
        }
      });
      stream.resume();
    });
    parser.once("error", fail);
    parser.once("finish", () => {
      if (!settled) {
        settled = true;
        resolvePromise(entries.sort((left, right) => left.path.localeCompare(right.path)));
      }
    });
    Readable.from([archive]).pipe(parser);
  });
}

function assertArchiveManifest(
  expected: SourceArchiveEntry[],
  actual: ParsedArchiveEntry[],
): void {
  const normalizedExpected = [...expected].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  if (normalizedExpected.length !== actual.length) {
    throw new Error("Source archive manifest does not match");
  }
  for (const [index, entry] of normalizedExpected.entries()) {
    const candidate = actual[index];
    if (
      candidate === undefined ||
      entry.path !== candidate.path ||
      entry.mode !== candidate.mode ||
      entry.size !== candidate.size ||
      entry.sha256 !== candidate.sha256
    ) {
      throw new Error("Source archive manifest does not match");
    }
  }
}

async function assertTrustedRepositoryState(
  repository: string,
  sourceRevision: string,
): Promise<void> {
  const head = (
    await run("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
      cwd: repository,
      maxOutputBytes: 1_024,
    })
  )
    .toString("utf8")
    .trim();
  if (head !== sourceRevision) {
    throw new Error("Trusted repository moved from the source revision");
  }
  const status = await run(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    {
      cwd: repository,
      maxOutputBytes: 64 * 1024,
    },
  );
  if (status.length !== 0) {
    throw new Error("Trusted repository must be clean before patch application");
  }
}

async function scanWorkspace(
  workspace: string,
  maxFiles: number,
  maxFileBytes: number,
): Promise<void> {
  let files = 0;
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (directory === workspace && entry.name === ".git") {
        continue;
      }
      const absolute = join(directory, entry.name);
      const path = relative(workspace, absolute);
      validateTransportPath(path);
      assertNotCredentialPath(path);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
        throw new Error("Actor workspace contains a link or unsupported entry");
      }
      if (metadata.isDirectory()) {
        await walk(absolute);
      } else {
        files += 1;
        if (files > maxFiles) {
          throw new Error("Actor workspace exceeds the file-count limit");
        }
        if (metadata.size > maxFileBytes) {
          throw new Error("Actor workspace file exceeds the size limit");
        }
      }
    }
  };
  await walk(workspace);
}

async function scanChangedFileContents(
  workspace: string,
  paths: string[],
  maxFileBytes: number,
): Promise<void> {
  for (const path of paths) {
    const absolute = resolve(workspace, path);
    assertInside(workspace, absolute);
    try {
      const metadata = await stat(absolute);
      if (!metadata.isFile()) {
        throw new Error("Changed path is not a regular file");
      }
      const content = await readBoundedFile(
        absolute,
        maxFileBytes,
        "Changed file",
      );
      assertNoCredentialContent(content);
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }
}

function validateTransportPath(path: string): void {
  if (
    path.length === 0 ||
    path.includes("\0") ||
    path.includes("\\") ||
    isAbsolute(path)
  ) {
    throw new Error("Source path is invalid");
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\r") ||
        segment.includes("\n"),
    )
  ) {
    throw new Error("Source path is invalid");
  }
  if (segments.includes(".git")) {
    throw new Error("Source path cannot access Git metadata");
  }
}

function assertNotCredentialPath(path: string): void {
  const segments = path.toLowerCase().split("/");
  const name = segments.at(-1) ?? "";
  if (
    CREDENTIAL_DIRECTORIES.size > 0 &&
    segments.some((segment) => CREDENTIAL_DIRECTORIES.has(segment))
  ) {
    throw new Error("Credential-like paths cannot cross the actor boundary");
  }
  if (
    CREDENTIAL_FILE_NAMES.has(name) ||
    (name.startsWith(".env.") && name !== ".env.example") ||
    name === ".env" ||
    /\.(?:key|pem|p12|pfx)$/i.test(name) ||
    /^kubeconfig(?:[._-].*)?$/i.test(name)
  ) {
    throw new Error("Credential-like paths cannot cross the actor boundary");
  }
}

function assertNoCredentialContent(content: Buffer): void {
  const text = content.toString("utf8");
  if (CREDENTIAL_CONTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new Error("Credential-like content cannot cross the actor boundary");
  }
}

function isProtectedPath(path: string): boolean {
  return (
    PROTECTED_PATHS.has(path) ||
    path.startsWith(".github/workflows/")
  );
}

async function assertGitIndexModes(
  workspace: string,
  maxOutputBytes: number,
): Promise<void> {
  const records = splitNull(
    await run("git", ["ls-files", "--stage", "-z"], {
      cwd: workspace,
      maxOutputBytes,
    }),
  );
  for (const record of records) {
    const separator = record.indexOf("\t");
    const metadata = separator < 0 ? "" : record.slice(0, separator);
    if (!/^(?:100644|100755) [0-9a-f]{40}(?:[0-9a-f]{24})? 0$/.test(metadata)) {
      throw new Error("Patch creates a link or unsupported Git entry");
    }
  }
}

function assertSamePaths(expected: string[], actual: string[]): void {
  const left = [...expected].sort();
  const right = [...actual].sort();
  if (
    left.length !== right.length ||
    left.some((path, index) => path !== right[index])
  ) {
    throw new Error("Patch changed-path manifest does not match");
  }
}

function parseNullPaths(output: Buffer): string[] {
  return splitNull(output).map((path) => {
    validateTransportPath(path);
    return path;
  });
}

function splitNull(value: Buffer): string[] {
  const text = value.toString("utf8");
  if (text.includes("\uFFFD")) {
    throw new Error("Path output is not valid UTF-8");
  }
  const values = text.split("\0");
  if (values.at(-1) === "") {
    values.pop();
  }
  return values;
}

function assertInside(root: string, path: string): void {
  if (relativeInside(root, path) === undefined) {
    throw new Error("Path escapes the workspace");
  }
}

function assertArtifactLocation(repository: string, path: string): void {
  const child = relativeInside(repository, path);
  if (
    child !== undefined &&
    child !== ".state" &&
    !child.startsWith(`.state${sep}`)
  ) {
    throw new Error("Artifacts inside the trusted repository must use .state");
  }
}

function relativeInside(root: string, path: string): string | undefined {
  const child = relative(root, path);
  return child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)
    ? undefined
    : child;
}

async function readBoundedFile(
  path: string,
  maxBytes: number,
  label: string,
): Promise<Buffer> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > maxBytes) {
    throw new Error(`${label} exceeds the size limit`);
  }
  return await readFile(path);
}

async function ensureAbsent(path: string): Promise<void> {
  try {
    await access(path);
    throw new Error("Output path already exists");
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }
}

async function run(
  executable: string,
  args: string[],
  options: RunOptions,
): Promise<Buffer> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: {
        PATH: process.env.PATH ?? "",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_ATTR_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        ...options.extraEnv,
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let exceeded = false;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > options.maxOutputBytes) {
        exceeded = true;
        child.kill("SIGTERM");
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.resume();
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      if (exceeded) {
        rejectPromise(new Error("Command output exceeded the limit"));
      } else if (code !== 0) {
        rejectPromise(new Error(`Command failed with exit code ${code ?? "unknown"}`));
      } else {
        resolvePromise(Buffer.concat(chunks));
      }
    });
  });
}

function gitIdentityEnvironment(): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: "Pi Actor",
    GIT_AUTHOR_EMAIL: "pi-actor@invalid",
    GIT_COMMITTER_NAME: "Pi Actor",
    GIT_COMMITTER_EMAIL: "pi-actor@invalid",
  };
}

function assertRevision(value: string): void {
  if (!SHA_PATTERN.test(value)) {
    throw new Error("Revision is invalid");
  }
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isMissing(value: unknown): boolean {
  return (
    value instanceof Error &&
    "code" in value &&
    (value as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
