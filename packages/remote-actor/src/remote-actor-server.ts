import {
  createHash,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  SourceTransport,
  type SourceArchiveArtifact,
  type SourceArchiveEntry,
} from "@pisa/orchestrator";
import {
  PiActor,
  WorkspacePolicy,
  type ActorRunResult,
  type PiActorOptions,
} from "@pisa/pi-actor";
import { ACTOR_ID_PATTERN } from "@pisa/protocol";
import type {
  RemoteActorErrorResponse,
  RemoteActorRunRequest,
  RemoteActorRunResponse,
  RemoteSourceArchive,
} from "./protocol.js";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REVISION_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

interface ActorRunner {
  run(task: string, signal?: AbortSignal): Promise<ActorRunResult>;
}

export interface RemoteActorServerOptions {
  actorId: string;
  actorToken: string;
  jobTokenSha256: string;
  brokerUrl: URL;
  workRoot: string;
  model?: string;
  acceptanceCommand?: string;
  maxArchiveBytes?: number;
  maxBodyBytes?: number;
  maxTaskCharacters?: number;
  runTimeoutMs?: number;
  shutdownGraceMs?: number;
  actorFactory?: (options: PiActorOptions) => ActorRunner;
  onUnresponsiveRun?: () => void;
  onJobFinished?: () => void;
}

export class RemoteActorServer {
  readonly #options: RemoteActorServerOptions;
  readonly #jobTokenDigest: Buffer;
  readonly #transport: SourceTransport;
  readonly #acceptanceCommand: string;
  readonly #maxArchiveBytes: number;
  readonly #maxBodyBytes: number;
  readonly #maxTaskCharacters: number;
  readonly #runTimeoutMs: number;
  readonly #shutdownGraceMs: number;
  readonly #actorFactory: (options: PiActorOptions) => ActorRunner;
  readonly #server: Server;
  #workRoot: string | undefined;
  #running = false;

  constructor(options: RemoteActorServerOptions) {
    if (!ACTOR_ID_PATTERN.test(options.actorId)) {
      throw new Error("Remote actor ID is invalid");
    }
    if (
      !["http:", "https:"].includes(options.brokerUrl.protocol) ||
      options.brokerUrl.username.length > 0 ||
      options.brokerUrl.password.length > 0
    ) {
      throw new Error("Remote actor broker URL is invalid");
    }
    if (!isAbsolute(options.workRoot)) {
      throw new Error("Remote actor work root must be absolute");
    }
    if (!SHA256_PATTERN.test(options.jobTokenSha256)) {
      throw new Error("Remote actor job token digest is invalid");
    }
    this.#options = options;
    this.#jobTokenDigest = Buffer.from(options.jobTokenSha256, "hex");
    this.#acceptanceCommand = options.acceptanceCommand ?? "npm test";
    this.#maxArchiveBytes = options.maxArchiveBytes ?? 8 * 1024 * 1024;
    this.#maxBodyBytes =
      options.maxBodyBytes ?? Math.ceil(this.#maxArchiveBytes * 1.5) + 128 * 1024;
    this.#maxTaskCharacters = options.maxTaskCharacters ?? 32_000;
    this.#runTimeoutMs = options.runTimeoutMs ?? 10 * 60_000;
    this.#shutdownGraceMs = options.shutdownGraceMs ?? 5_000;
    this.#transport = new SourceTransport({
      maxArchiveBytes: this.#maxArchiveBytes,
      maxPatchBytes: 4 * 1024 * 1024,
      maxFiles: 2_000,
      maxFileBytes: 4 * 1024 * 1024,
    });
    this.#actorFactory =
      options.actorFactory ?? ((actorOptions) => new PiActor(actorOptions));
    this.#server = createServer((request, response) => {
      void this.#handle(request, response);
    });
  }

  async listen(host = "127.0.0.1", port = 0): Promise<URL> {
    await mkdir(this.#options.workRoot, {
      recursive: true,
      mode: 0o700,
    });
    this.#workRoot = await realpath(this.#options.workRoot);
    await new Promise<void>((resolveListen, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(port, host, () => {
        this.#server.off("error", reject);
        resolveListen();
      });
    });
    const address = this.#server.address() as AddressInfo;
    return new URL(`http://${host}:${address.port}`);
  }

  async close(): Promise<void> {
    await new Promise<void>((resolveClose, reject) => {
      this.#server.close((error) => {
        if (error === undefined) {
          resolveClose();
        } else {
          reject(error);
        }
      });
    });
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const requestId = randomUUID();
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("x-request-id", requestId);
    try {
      const url = new URL(request.url ?? "/", "http://actor.invalid");
      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, {
          status: "ok",
          actorId: this.#options.actorId,
          ready: this.#workRoot !== undefined,
        });
        return;
      }
      if (
        !this.#authorizeJob(request.headers.authorization)
      ) {
        throw new ActorHttpError(401, "unauthorized");
      }
      if (request.method !== "POST" || url.pathname !== "/v1/run") {
        throw new ActorHttpError(404, "not_found");
      }
      if (this.#running) {
        throw new ActorHttpError(429, "actor_busy");
      }
      const body = await readJson(request, this.#maxBodyBytes);
      if (
        !isRunRequest(
          body,
          this.#maxTaskCharacters,
          this.#maxArchiveBytes,
        )
      ) {
        throw new ActorHttpError(400, "invalid_run_request");
      }
      this.#running = true;
      if (this.#options.onJobFinished !== undefined) {
        response.once("finish", this.#options.onJobFinished);
      }
      try {
        const result = await this.#run(body, requestId);
        sendJson(response, 200, result);
      } finally {
        this.#running = false;
      }
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const actorError =
        error instanceof ActorHttpError
          ? error
          : new ActorHttpError(500, "actor_run_failed");
      const body: RemoteActorErrorResponse = {
        error: {
          code: actorError.code,
          message: "Remote actor request failed",
          requestId,
        },
      };
      sendJson(response, actorError.status, body);
    }
  }

  async #run(
    request: RemoteActorRunRequest,
    requestId: string,
  ): Promise<RemoteActorRunResponse> {
    const workRoot = this.#workRoot;
    if (workRoot === undefined) {
      throw new ActorHttpError(503, "actor_not_ready");
    }
    const runRoot = resolve(workRoot, `run-${requestId}`);
    const workspace = join(runRoot, "workspace");
    const archivePath = join(runRoot, "source.tar");
    const patchPath = join(runRoot, "result.patch");
    const acceptedWorkspace = join(runRoot, "accepted-workspace");
    const acceptedPatchPath = join(runRoot, "accepted-result.patch");
    await mkdir(runRoot, { mode: 0o700 });
    try {
      const archive = Buffer.from(request.source.contentBase64, "base64");
      await writeFile(archivePath, archive, {
        flag: "wx",
        mode: 0o600,
      });
      const source: SourceArchiveArtifact = {
        path: archivePath,
        revision: request.source.revision,
        sha256: request.source.sha256,
        bytes: request.source.bytes,
        entries: request.source.entries,
      };
      await this.#transport.materializeSourceArchive(source, workspace);
      const baseline = await this.#transport.initializeActorBaseline(
        workspace,
        source.revision,
      );
      const actorResult = await this.#runActor(
        this.#actorFactory({
          actorId: this.#options.actorId,
          actorToken: this.#options.actorToken,
          brokerUrl: this.#options.brokerUrl,
          workspace,
          ...(this.#options.model === undefined
            ? {}
            : { model: this.#options.model }),
        }),
        request.task,
      );
      if (
        !actorResult.events.some(
          (event) =>
            event.type === "tool_end" &&
            event.toolName === "workspace_test" &&
            event.isError === false,
        )
      ) {
        throw new ActorHttpError(422, "actor_acceptance_failed");
      }
      const patch = await this.#transport.exportActorPatch(
        baseline,
        patchPath,
      );
      if (
        !samePaths(
          patch.changedPaths,
          actorResult.changedFiles.map((file) => file.path),
        )
      ) {
        throw new ActorHttpError(422, "actor_acceptance_failed");
      }
      const accepted = await this.#transport.materializeValidatedPatch(
        source,
        patch,
        acceptedWorkspace,
      );
      const policy = await WorkspacePolicy.create(acceptedWorkspace);
      const testResult = await policy.bashOperations().exec(
        this.#acceptanceCommand,
        acceptedWorkspace,
        {
          timeout: Math.min(this.#runTimeoutMs, 120_000),
          onData: () => undefined,
        },
      );
      if (testResult.exitCode !== 0) {
        throw new ActorHttpError(422, "actor_acceptance_failed");
      }
      const acceptedPatch = await this.#transport.exportActorPatch(
        accepted.baseline,
        acceptedPatchPath,
      );
      if (
        patch.sha256 !== acceptedPatch.sha256 ||
        patch.bytes !== acceptedPatch.bytes ||
        !samePaths(patch.changedPaths, acceptedPatch.changedPaths)
      ) {
        throw new ActorHttpError(422, "actor_acceptance_failed");
      }
      const patchBytes = await readFile(acceptedPatch.path);
      return {
        requestId,
        actorId: this.#options.actorId,
        events: actorResult.events,
        changedFiles: actorResult.changedFiles,
        patch: {
          sourceRevision: acceptedPatch.sourceRevision,
          sha256: acceptedPatch.sha256,
          bytes: acceptedPatch.bytes,
          changedPaths: acceptedPatch.changedPaths,
          contentBase64: patchBytes.toString("base64"),
        },
      };
    } finally {
      await rm(runRoot, { recursive: true, force: true });
    }
  }

  #authorizeJob(header: string | undefined): boolean {
    if (header === undefined || !header.startsWith("Bearer ")) {
      return false;
    }
    const candidate = createHash("sha256")
      .update(header.slice("Bearer ".length), "utf8")
      .digest();
    return timingSafeEqual(candidate, this.#jobTokenDigest);
  }

  async #runActor(
    actor: ActorRunner,
    task: string,
  ): Promise<ActorRunResult> {
    const controller = new AbortController();
    const actorOutcome = actor.run(task, controller.signal).then(
      (result) => ({ kind: "result" as const, result }),
      (error: unknown) => ({ kind: "error" as const, error }),
    );
    const first = await raceWithDelay(
      actorOutcome,
      this.#runTimeoutMs,
    );
    if (first.kind === "result") {
      return first.result;
    }
    if (first.kind === "error") {
      throw first.error;
    }

    controller.abort(new Error("Remote actor run timed out"));
    const stopped = await raceWithDelay(
      actorOutcome,
      this.#shutdownGraceMs,
    );
    if (stopped.kind === "timeout") {
      this.#options.onUnresponsiveRun?.();
    }
    throw new ActorHttpError(504, "actor_timeout");
  }
}

class ActorHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function readJson(
  request: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      throw new ActorHttpError(413, "body_too_large");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ActorHttpError(400, "invalid_json");
  }
}

function isRunRequest(
  value: unknown,
  maxTaskCharacters: number,
  maxArchiveBytes: number,
): value is RemoteActorRunRequest {
  return (
    isRecord(value) &&
    typeof value.task === "string" &&
    value.task.length > 0 &&
    value.task.length <= maxTaskCharacters &&
    isRemoteSourceArchive(value.source, maxArchiveBytes)
  );
}

function isRemoteSourceArchive(
  value: unknown,
  maxArchiveBytes: number,
): value is RemoteSourceArchive {
  if (
    !isRecord(value) ||
    typeof value.revision !== "string" ||
    !REVISION_PATTERN.test(value.revision) ||
    typeof value.sha256 !== "string" ||
    !SHA256_PATTERN.test(value.sha256) ||
    typeof value.bytes !== "number" ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    value.bytes > maxArchiveBytes ||
    !Array.isArray(value.entries) ||
    value.entries.length < 1 ||
    value.entries.length > 2_000 ||
    !value.entries.every(isSourceArchiveEntry) ||
    typeof value.contentBase64 !== "string" ||
    value.contentBase64.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value.contentBase64)
  ) {
    return false;
  }
  return Buffer.byteLength(value.contentBase64, "base64") === value.bytes;
}

function isSourceArchiveEntry(value: unknown): value is SourceArchiveEntry {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    (value.mode === 0o644 || value.mode === 0o755) &&
    typeof value.size === "number" &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    value.size <= 4 * 1024 * 1024 &&
    typeof value.sha256 === "string" &&
    SHA256_PATTERN.test(value.sha256)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function samePaths(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((path, index) => path === sortedRight[index])
  );
}

async function raceWithDelay<T>(
  promise: Promise<
    | { kind: "result"; result: T }
    | { kind: "error"; error: unknown }
  >,
  delayMs: number,
): Promise<
  | { kind: "result"; result: T }
  | { kind: "error"; error: unknown }
  | { kind: "timeout" }
> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<{ kind: "timeout" }>((resolveTimeout) => {
        timeout = setTimeout(
          () => resolveTimeout({ kind: "timeout" }),
          delayMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.statusCode = status;
  response.end(JSON.stringify(body));
}
