import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "node:test";
import type { ModelTurnRequest, ModelTurnResponse } from "@pisa/protocol";
import {
  ActorTokenAuthorizer,
  BrokerServer,
  FakeModelBackend,
} from "../../packages/copilot-broker/src/index.js";
import { SourceTransport } from "../../packages/orchestrator/src/index.js";
import { PiActor } from "../../packages/pi-actor/src/index.js";

const execFileAsync = promisify(execFile);
const projectRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const scratchParent = join(projectRoot, ".state", "tests");
const scratchRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratchRoots.splice(0).map(async (root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("trusted source transport", () => {
  test("requires repository-local artifacts to use the ignored state directory", async () => {
    const root = await scratchRoot();
    const repository = await createRepository(root);
    const transport = new SourceTransport();

    await assert.rejects(
      transport.createSourceArchive(
        repository,
        "HEAD",
        join(repository, "source.tar"),
      ),
      /must use \.state/,
    );
  });

  test("moves source through a Pi actor and commits its returned patch locally", async () => {
    const root = await scratchRoot();
    const repository = await createRepository(root);
    const transport = new SourceTransport();
    const archive = await transport.createSourceArchive(
      repository,
      "HEAD",
      join(root, "artifacts", "source.tar"),
    );
    const actorWorkspace = join(root, "actor");
    await transport.materializeSourceArchive(archive, actorWorkspace);
    const baseline = await transport.initializeActorBaseline(
      actorWorkspace,
      archive.revision,
    );
    const actorId = "transport-actor";
    const actorToken = randomBytes(32).toString("base64url");
    const server = new BrokerServer({
      backend: new FakeModelBackend({ responder: codingResponder }),
      authorizer: new ActorTokenAuthorizer({ [actorId]: actorToken }),
    });
    try {
      const actor = new PiActor({
        actorId,
        actorToken,
        brokerUrl: await server.listen(),
        workspace: actorWorkspace,
      });
      const result = await actor.run("Fix the add function and run the tests.");
      assert.deepEqual(result.changedFiles, [
        { path: "math.js", status: "modified" },
      ]);
    } finally {
      await server.close();
    }

    const patch = await transport.exportActorPatch(
      baseline,
      join(root, "artifacts", "actor.patch"),
    );
    assert.deepEqual(
      await transport.applyValidatedPatch(repository, archive, patch),
      ["math.js"],
    );
    await git(repository, [
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--no-gpg-sign",
      "-m",
      "trusted local actor result",
    ]);
    assert.match(await readFile(join(repository, "math.js"), "utf8"), /left \+ right/);
    assert.equal(await git(repository, ["status", "--porcelain"]), "");
  });

  test("round-trips an archive and binary patch into a trusted local commit", async () => {
    const root = await scratchRoot();
    const repository = await createRepository(root);
    const transport = new SourceTransport();
    const archive = await transport.createSourceArchive(
      repository,
      "HEAD",
      join(root, "artifacts", "source.tar"),
    );
    const actorWorkspace = join(root, "actor");

    await transport.materializeSourceArchive(archive, actorWorkspace);
    assert.equal(await pathExists(join(actorWorkspace, ".git")), false);
    const baseline = await transport.initializeActorBaseline(
      actorWorkspace,
      archive.revision,
    );
    await writeFile(
      join(actorWorkspace, "math.js"),
      "export const add = (left, right) => left + right;\n",
      "utf8",
    );
    await writeFile(join(actorWorkspace, "notes.txt"), "actor result\n", "utf8");
    const patch = await transport.exportActorPatch(
      baseline,
      join(root, "artifacts", "actor.patch"),
    );

    assert.deepEqual(patch.changedPaths, ["math.js", "notes.txt"]);
    const applied = await transport.applyValidatedPatch(
      repository,
      archive,
      patch,
    );
    assert.deepEqual(applied, ["math.js", "notes.txt"]);
    assert.match(await readFile(join(repository, "math.js"), "utf8"), /left \+ right/);
    assert.equal(
      await readFile(join(repository, "notes.txt"), "utf8"),
      "actor result\n",
    );
    assert.deepEqual(await stagedPaths(repository), ["math.js", "notes.txt"]);

    const beforeCommit = await git(repository, ["rev-parse", "HEAD"]);
    await git(repository, [
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--no-gpg-sign",
      "-m",
      "apply actor patch",
    ]);
    assert.notEqual(await git(repository, ["rev-parse", "HEAD"]), beforeCommit);
  });

  test("requires explicit review for protected policy changes", async () => {
    const root = await scratchRoot();
    const repository = await createRepository(root);
    const transport = new SourceTransport();
    const archive = await transport.createSourceArchive(
      repository,
      "HEAD",
      join(root, "source.tar"),
    );
    const actorWorkspace = join(root, "actor");
    await transport.materializeSourceArchive(archive, actorWorkspace);
    const baseline = await transport.initializeActorBaseline(
      actorWorkspace,
      archive.revision,
    );
    await writeFile(join(actorWorkspace, "SECURITY.md"), "weakened\n", "utf8");
    const patch = await transport.exportActorPatch(
      baseline,
      join(root, "protected.patch"),
    );

    await assert.rejects(
      transport.applyValidatedPatch(repository, archive, patch),
      /protected safety policy/,
    );
    assert.equal(await git(repository, ["status", "--porcelain"]), "");

    assert.deepEqual(
      await transport.applyValidatedPatch(repository, archive, patch, {
        allowProtectedPaths: true,
      }),
      ["SECURITY.md"],
    );
  });

  test("rejects credential-like source and actor output paths", async () => {
    const root = await scratchRoot();
    const repository = await createRepository(root);
    await writeFile(join(repository, ".env"), "not-a-real-secret\n", "utf8");
    await git(repository, ["add", "--force", ".env"]);
    await git(repository, [
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--no-gpg-sign",
      "-m",
      "add prohibited credential path",
    ]);
    const transport = new SourceTransport();
    await assert.rejects(
      transport.createSourceArchive(
        repository,
        "HEAD",
        join(root, "rejected.tar"),
      ),
      /Credential-like paths/,
    );

    await git(repository, ["rm", ".env"]);
    await git(repository, [
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--no-gpg-sign",
      "-m",
      "remove prohibited credential path",
    ]);
    const archive = await transport.createSourceArchive(
      repository,
      "HEAD",
      join(root, "accepted.tar"),
    );
    const actorWorkspace = join(root, "actor");
    await transport.materializeSourceArchive(archive, actorWorkspace);
    const baseline = await transport.initializeActorBaseline(
      actorWorkspace,
      archive.revision,
    );
    await writeFile(
      join(actorWorkspace, ".env.production"),
      "still-not-a-real-secret\n",
      "utf8",
    );
    await assert.rejects(
      transport.exportActorPatch(baseline, join(root, "rejected.patch")),
      /Credential-like paths/,
    );
  });

  test("rejects source and actor workspace symlinks", async () => {
    const root = await scratchRoot();
    const repository = await createRepository(root);
    await symlink("math.js", join(repository, "math-link"));
    await git(repository, ["add", "math-link"]);
    await git(repository, [
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--no-gpg-sign",
      "-m",
      "add prohibited source link",
    ]);
    const transport = new SourceTransport();
    await assert.rejects(
      transport.createSourceArchive(
        repository,
        "HEAD",
        join(root, "symlink.tar"),
      ),
      /link or unsupported entry/,
    );

    await git(repository, ["rm", "math-link"]);
    await git(repository, [
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--no-gpg-sign",
      "-m",
      "remove prohibited source link",
    ]);
    const archive = await transport.createSourceArchive(
      repository,
      "HEAD",
      join(root, "source.tar"),
    );
    const actorWorkspace = join(root, "actor");
    await transport.materializeSourceArchive(archive, actorWorkspace);
    const baseline = await transport.initializeActorBaseline(
      actorWorkspace,
      archive.revision,
    );
    await symlink("math.js", join(actorWorkspace, "actor-link"));
    await assert.rejects(
      transport.exportActorPatch(baseline, join(root, "actor.patch")),
      /link or unsupported entry/,
    );
  });

  test("rejects a patch modified after export", async () => {
    const root = await scratchRoot();
    const repository = await createRepository(root);
    const transport = new SourceTransport();
    const archive = await transport.createSourceArchive(
      repository,
      "HEAD",
      join(root, "source.tar"),
    );
    const actorWorkspace = join(root, "actor");
    await transport.materializeSourceArchive(archive, actorWorkspace);
    const baseline = await transport.initializeActorBaseline(
      actorWorkspace,
      archive.revision,
    );
    await writeFile(
      join(actorWorkspace, "math.js"),
      "export const add = (left, right) => left + right;\n",
      "utf8",
    );
    const patch = await transport.exportActorPatch(
      baseline,
      join(root, "actor.patch"),
    );
    await writeFile(patch.path, "\n", { flag: "a" });

    await assert.rejects(
      transport.applyValidatedPatch(repository, archive, patch),
      /integrity check failed/,
    );
    assert.equal(await git(repository, ["status", "--porcelain"]), "");
  });
});

async function scratchRoot(): Promise<string> {
  await mkdir(scratchParent, { recursive: true });
  const root = await mkdtemp(join(scratchParent, "source-transport-"));
  scratchRoots.push(root);
  return root;
}

async function createRepository(root: string): Promise<string> {
  const repository = join(root, "trusted");
  await mkdir(repository);
  await git(repository, ["init", "--initial-branch=main"]);
  await writeFile(join(repository, ".gitignore"), ".state/\n", "utf8");
  await writeFile(
    join(repository, "math.js"),
    "export function add(left, right) {\n  return left - right;\n}\n",
    "utf8",
  );
  await writeFile(
    join(repository, "math.test.js"),
    [
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      'import { add } from "./math.js";',
      "",
      'test("adds", () => assert.equal(add(2, 3), 5));',
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(repository, "package.json"),
    JSON.stringify(
      {
        name: "transport-fixture",
        private: true,
        type: "module",
        scripts: { test: "node --test" },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(join(repository, "README.md"), "fixture\n", "utf8");
  await writeFile(join(repository, "SECURITY.md"), "protected\n", "utf8");
  await git(repository, ["add", "--all"]);
  await git(repository, [
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--no-gpg-sign",
    "-m",
    "fixture baseline",
  ]);
  return repository;
}

async function stagedPaths(repository: string): Promise<string[]> {
  const output = await git(repository, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
  ]);
  return output.split("\0").filter((path) => path.length > 0);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_ATTR_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "Trusted Test",
      GIT_AUTHOR_EMAIL: "trusted-test@invalid",
      GIT_COMMITTER_NAME: "Trusted Test",
      GIT_COMMITTER_EMAIL: "trusted-test@invalid",
    },
  });
  return result.stdout.trim();
}

function codingResponder(
  turn: ModelTurnRequest,
  _actorId: string,
  callIndex: number,
): ModelTurnResponse {
  if (callIndex === 0) {
    assert.equal(turn.kind, "prompt");
    return {
      kind: "tool_calls",
      calls: [
        {
          id: "read-transport",
          name: "workspace_read",
          arguments: { path: "math.js" },
        },
      ],
    };
  }
  assert.equal(turn.kind, "tool_results");
  assert.equal(turn.results[0]?.isError, false);
  if (callIndex === 1) {
    return {
      kind: "tool_calls",
      calls: [
        {
          id: "edit-transport",
          name: "workspace_edit",
          arguments: {
            path: "math.js",
            edits: [
              {
                oldText: "return left - right;",
                newText: "return left + right;",
              },
            ],
          },
        },
      ],
    };
  }
  if (callIndex === 2) {
    return {
      kind: "tool_calls",
      calls: [
        {
          id: "test-transport",
          name: "workspace_test",
          arguments: { command: "npm test" },
        },
      ],
    };
  }
  return {
    kind: "assistant",
    content: "Fixed the addition function and verified the tests.",
  };
}
