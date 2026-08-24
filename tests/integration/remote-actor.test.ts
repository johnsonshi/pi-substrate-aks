import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import {
  SourceTransport,
  type SourceArchiveArtifact,
} from "@pisa/orchestrator";
import type { ActorRunResult } from "@pisa/pi-actor";
import {
  RemoteActorServer,
  type RemoteActorRunResponse,
} from "@pisa/remote-actor";

const execFileAsync = promisify(execFile);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const scratchParent = join(projectRoot, ".state", "tests");
const scratchRoots: string[] = [];
const servers: RemoteActorServer[] = [];

afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map(async (server) => server.close()));
  await Promise.all(
    scratchRoots.splice(0).map(async (root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

test("remote actor accepts a manifest archive and returns a replayable patch", async () => {
  const root = await scratchRoot();
  const repository = await createRepository(root);
  const transport = new SourceTransport();
  const archive = await transport.createSourceArchive(
    repository,
    "HEAD",
    join(root, "artifacts", "source.tar"),
  );
  const jobToken = token();
  const server = new RemoteActorServer({
    actorId: "remote-test-actor",
    actorToken: token(),
    jobTokenSha256: sha256(jobToken),
    brokerUrl: new URL("http://relay.invalid"),
    workRoot: join(root, "remote"),
    actorFactory: ({ workspace }) => ({
      async run(): Promise<ActorRunResult> {
        await writeFile(
          join(workspace, "math.js"),
          "export const add = (left, right) => left + right;\n",
          "utf8",
        );
        return {
          finalText: "untrusted actor response",
          events: [
            {
              type: "tool_end",
              toolName: "workspace_test",
              isError: false,
            },
          ],
          changedFiles: [{ path: "math.js", status: "modified" }],
        };
      },
    }),
  });
  const serverUrl = await server.listen();
  servers.push(server);

  const response = await fetch(new URL("/v1/run", serverUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${jobToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      task: "Fix the add function.",
      source: await remoteSource(archive),
    }),
  });
  assert.equal(response.status, 200);
  const result = (await response.json()) as RemoteActorRunResponse;
  assert.equal(result.actorId, "remote-test-actor");
  assert.deepEqual(result.changedFiles, [
    { path: "math.js", status: "modified" },
  ]);
  assert.deepEqual(result.patch.changedPaths, ["math.js"]);
  assert.equal("finalText" in result, false);

  const patchPath = join(root, "artifacts", "returned.patch");
  await writeFile(
    patchPath,
    Buffer.from(result.patch.contentBase64, "base64"),
    { mode: 0o600 },
  );
  assert.deepEqual(
    await transport.applyValidatedPatch(repository, archive, {
      path: patchPath,
      sourceRevision: result.patch.sourceRevision,
      sha256: result.patch.sha256,
      bytes: result.patch.bytes,
      changedPaths: result.patch.changedPaths,
    }),
    ["math.js"],
  );
  assert.match(
    await readFile(join(repository, "math.js"), "utf8"),
    /left \+ right/,
  );
});

test("remote actor rejects unauthenticated jobs", async () => {
  const root = await scratchRoot();
  const jobToken = token();
  const server = new RemoteActorServer({
    actorId: "remote-test-actor",
    actorToken: token(),
    jobTokenSha256: sha256(jobToken),
    brokerUrl: new URL("http://relay.invalid"),
    workRoot: join(root, "remote"),
  });
  const serverUrl = await server.listen();
  servers.push(server);

  const response = await fetch(new URL("/v1/run", serverUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token()}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(response.status, 401);

  const digestResponse = await fetch(new URL("/v1/run", serverUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${sha256(jobToken)}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(digestResponse.status, 401);
});

test("remote actor refuses to export an untested patch", async () => {
  const root = await scratchRoot();
  const repository = await createRepository(root);
  const transport = new SourceTransport();
  const archive = await transport.createSourceArchive(
    repository,
    "HEAD",
    join(root, "artifacts", "source.tar"),
  );
  const jobToken = token();
  const server = new RemoteActorServer({
    actorId: "remote-test-actor",
    actorToken: token(),
    jobTokenSha256: sha256(jobToken),
    brokerUrl: new URL("http://relay.invalid"),
    workRoot: join(root, "remote"),
    actorFactory: ({ workspace }) => ({
      async run(): Promise<ActorRunResult> {
        await writeFile(
          join(workspace, "math.js"),
          "export const add = (left, right) => left + right;\n",
          "utf8",
        );
        return {
          finalText: "stopped before tests passed",
          events: [
            {
              type: "tool_end",
              toolName: "workspace_test",
              isError: true,
            },
          ],
          changedFiles: [{ path: "math.js", status: "modified" }],
        };
      },
    }),
  });
  const serverUrl = await server.listen();
  servers.push(server);

  const response = await fetch(new URL("/v1/run", serverUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${jobToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      task: "Fix and test.",
      source: await remoteSource(archive),
    }),
  });
  assert.equal(response.status, 422);
  const body = (await response.json()) as {
    error: { code: string };
  };
  assert.equal(body.error.code, "actor_acceptance_failed");
});

test("remote actor retests the final patch instead of trusting a stale test event", async () => {
  const root = await scratchRoot();
  const repository = await createRepository(root);
  const transport = new SourceTransport();
  const archive = await transport.createSourceArchive(
    repository,
    "HEAD",
    join(root, "artifacts", "source.tar"),
  );
  const jobToken = token();
  const server = new RemoteActorServer({
    actorId: "remote-test-actor",
    actorToken: token(),
    jobTokenSha256: sha256(jobToken),
    brokerUrl: new URL("http://relay.invalid"),
    workRoot: join(root, "remote"),
    actorFactory: ({ workspace }) => ({
      async run(): Promise<ActorRunResult> {
        await writeFile(
          join(workspace, "math.js"),
          "export const add = (left, right) => left - right - 1;\n",
          "utf8",
        );
        return {
          finalText: "changed files after an earlier passing test",
          events: [
            {
              type: "tool_end",
              toolName: "workspace_test",
              isError: false,
            },
          ],
          changedFiles: [{ path: "math.js", status: "modified" }],
        };
      },
    }),
  });
  const serverUrl = await server.listen();
  servers.push(server);

  const response = await fetch(new URL("/v1/run", serverUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${jobToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      task: "Claim a stale test result.",
      source: await remoteSource(archive),
    }),
  });
  assert.equal(response.status, 422);
  const body = (await response.json()) as {
    error: { code: string };
  };
  assert.equal(body.error.code, "actor_acceptance_failed");
});

test("remote actor invokes the fatal timeout hook for an unresponsive run", async () => {
  const root = await scratchRoot();
  const repository = await createRepository(root);
  const transport = new SourceTransport();
  const archive = await transport.createSourceArchive(
    repository,
    "HEAD",
    join(root, "artifacts", "source.tar"),
  );
  const jobToken = token();
  let timedOut = false;
  const server = new RemoteActorServer({
    actorId: "remote-test-actor",
    actorToken: token(),
    jobTokenSha256: sha256(jobToken),
    brokerUrl: new URL("http://relay.invalid"),
    workRoot: join(root, "remote"),
    runTimeoutMs: 20,
    shutdownGraceMs: 20,
    onUnresponsiveRun: () => {
      timedOut = true;
    },
    actorFactory: () => ({
      async run(): Promise<ActorRunResult> {
        return await new Promise<ActorRunResult>(() => undefined);
      },
    }),
  });
  const serverUrl = await server.listen();
  servers.push(server);

  const response = await fetch(new URL("/v1/run", serverUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${jobToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      task: "Never finish.",
      source: await remoteSource(archive),
    }),
  });
  assert.equal(response.status, 504);
  assert.equal(timedOut, true);
  const body = (await response.json()) as {
    error: { code: string };
  };
  assert.equal(body.error.code, "actor_timeout");
});

async function remoteSource(
  artifact: SourceArchiveArtifact,
): Promise<Record<string, unknown>> {
  return {
    revision: artifact.revision,
    sha256: artifact.sha256,
    bytes: artifact.bytes,
    entries: artifact.entries,
    contentBase64: (await readFile(artifact.path)).toString("base64"),
  };
}

async function scratchRoot(): Promise<string> {
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(scratchParent, "remote-actor-"));
  scratchRoots.push(root);
  return root;
}

async function createRepository(root: string): Promise<string> {
  const repository = join(root, "repository");
  await mkdir(repository, { mode: 0o700 });
  await writeFile(join(repository, ".gitignore"), ".state/\n", "utf8");
  await writeFile(
    join(repository, "math.js"),
    "export const add = (left, right) => left - right;\n",
    "utf8",
  );
  await writeFile(
    join(repository, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      scripts: { test: "node test.js" },
    }),
    "utf8",
  );
  await writeFile(
    join(repository, "test.js"),
    "import { strict as assert } from 'node:assert';\nimport { add } from './math.js';\nassert.equal(add(2, 3), 5);\n",
    "utf8",
  );
  await git(repository, ["init", "--initial-branch=main"]);
  await git(repository, ["add", "--all"]);
  await git(repository, [
    "-c",
    "user.name=PISA Test",
    "-c",
    "user.email=pisa-test@invalid",
    "commit",
    "-m",
    "fixture",
  ]);
  return repository;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: join(cwd, ".test-home"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return result.stdout.trim();
}

function token(): string {
  return randomBytes(32).toString("base64url");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
