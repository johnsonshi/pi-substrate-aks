import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ActorTokenAuthorizer } from "../packages/copilot-broker/src/actor-token-authorizer.js";
import { CopilotSdkBackend } from "../packages/copilot-broker/src/copilot-sdk-backend.js";
import { BrokerServer } from "../packages/copilot-broker/src/http-server.js";
import { TrustedBridge } from "../packages/model-relay/src/trusted-bridge.js";
import {
  SourceTransport,
  type PatchArtifact,
} from "../packages/orchestrator/src/source-transport.js";
import type {
  RemoteActorErrorResponse,
  RemoteActorRunRequest,
  RemoteActorRunResponse,
} from "../packages/remote-actor/src/protocol.js";

const execFileAsync = promisify(execFile);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = join(
  projectRoot,
  "tests/fixtures/simple-calculator",
);
const stateRoot = join(projectRoot, ".state", "remote-smoke");
const evidencePath = join(
  projectRoot,
  "evidence/remote-actor/remote-smoke.txt",
);
const imageFile = join(projectRoot, ".state/aks/harness-image.txt");
const manifestPath = join(projectRoot, "deploy/aks/remote-actor.yaml");
const kubeContext = "pisa-aks";
const namespace = "pi-substrate";
const actorId = "remote-actor-1";
const relayActorCapability = capability();
const tunnelCapability = capability();
const jobClientCapability = capability();
const actorJobCapability = capability();
const brokerActorCapability = capability();
const portForwards: ChildProcess[] = [];
let bridge: TrustedBridge | undefined;
let broker: BrokerServer | undefined;

await mkdir(stateRoot, { recursive: true, mode: 0o700 });
const scratch = await mkdtemp(join(stateRoot, "run-"));

try {
  const image = (await readFile(imageFile, "utf8")).trim();
  assert.match(
    image,
    /^pisasubstrate84acr\.azurecr\.io\/pisa-harness@sha256:[0-9a-f]{64}$/,
  );
  await deployNamespace();
  await deployCapabilities();
  await deployWorkloads(image);

  const relayPort = await freePort();
  portForwards.push(
    await startPortForward("service/pisa-model-relay", relayPort),
  );

  broker = new BrokerServer({
    backend: new CopilotSdkBackend(),
    authorizer: new ActorTokenAuthorizer({
      [actorId]: brokerActorCapability,
    }),
    requestTimeoutMs: 300_000,
  });
  const brokerUrl = await broker.listen();
  const relayTunnelUrl = new URL(
    "/v1/tunnel",
    `ws://127.0.0.1:${relayPort}`,
  );
  bridge = new TrustedBridge({
    relayUrl: relayTunnelUrl,
    tunnelToken: tunnelCapability,
    brokerUrl,
    actorTokens: { [actorId]: brokerActorCapability },
  });
  await bridge.connect();
  await waitForRelayBridge(relayPort, true);

  const repository = await createFixtureRepository(scratch);
  const transport = new SourceTransport();
  const source = await transport.createSourceArchive(
    repository,
    "HEAD",
    join(repository, ".state", "source.tar"),
  );
  const runRequest: RemoteActorRunRequest = {
    task:
      "Open math.js. Fix the exported add function by replacing subtraction with addition. Run `npm test` and stop only after the tests pass.",
    source: {
      revision: source.revision,
      sha256: source.sha256,
      bytes: source.bytes,
      entries: source.entries,
      contentBase64: (await readFile(source.path)).toString("base64"),
    },
  };
  const actorUrl = new URL(
    "/v1/actor/run",
    `http://127.0.0.1:${relayPort}`,
  );
  const { result, attempts } = await runAcceptedActorTask(
    actorUrl,
    runRequest,
  );
  assert.equal(result.actorId, actorId);
  assert.deepEqual(result.patch.changedPaths, ["math.js"]);
  assert.deepEqual(result.changedFiles, [
    { path: "math.js", status: "modified" },
  ]);
  assert.equal(
    result.events.some(
      (event) =>
        event.type === "tool_end" &&
        event.toolName === "workspace_test" &&
        event.isError === false,
    ),
    true,
  );

  const returnedPatchPath = join(
    repository,
    ".state",
    "remote-returned.patch",
  );
  await writeFile(
    returnedPatchPath,
    Buffer.from(result.patch.contentBase64, "base64"),
    { flag: "wx", mode: 0o600 },
  );
  const returnedPatch: PatchArtifact = {
    path: returnedPatchPath,
    sourceRevision: result.patch.sourceRevision,
    sha256: result.patch.sha256,
    bytes: result.patch.bytes,
    changedPaths: result.patch.changedPaths,
  };
  const trustedTestWorkspace = join(scratch, "trusted-test-workspace");
  await transport.materializeValidatedPatch(
    source,
    returnedPatch,
    trustedTestWorkspace,
  );
  await rm(join(trustedTestWorkspace, ".git"), {
    recursive: true,
    force: true,
  });
  await rm(join(trustedTestWorkspace, ".state"), {
    recursive: true,
    force: true,
  });
  await runSandboxedTest(image, trustedTestWorkspace);
  assert.deepEqual(
    await transport.applyValidatedPatch(
      repository,
      source,
      returnedPatch,
    ),
    ["math.js"],
  );
  await git(repository, [
    "-c",
    "user.name=PISA Trusted Orchestrator",
    "-c",
    "user.email=pisa-orchestrator@invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--no-gpg-sign",
    "-m",
    "apply remote actor patch",
  ]);
  assert.equal(await git(repository, ["status", "--porcelain"]), "");
  assert.match(
    await readFile(join(repository, "math.js"), "utf8"),
    /left \+ right/,
  );

  await bridge.close();
  bridge = undefined;
  await waitForRelayBridge(relayPort, false);
  const closedActorState = await actorContainerState();
  const closedResponse = await fetch(actorUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jobClientCapability}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(runRequest),
    signal: AbortSignal.timeout(120_000),
  });
  assert.equal(closedResponse.status, 422);
  const closedBody =
    (await closedResponse.json()) as RemoteActorErrorResponse;
  assert.equal(closedBody.error.code, "actor_acceptance_failed");
  await waitForActorRestart(closedActorState);

  const runtimeClass = await kubectl([
    "get",
    "pod",
    "--namespace",
    namespace,
    "--selector",
    "app.kubernetes.io/name=pisa-remote-actor",
    "-o",
    "jsonpath={.items[0].spec.runtimeClassName}",
  ]);
  assert.equal(runtimeClass, "kata-vm-isolation");
  const actorTokenMount = await kubectl([
    "get",
    "pod",
    "--namespace",
    namespace,
    "--selector",
    "app.kubernetes.io/name=pisa-remote-actor",
    "-o",
    "jsonpath={.items[0].spec.automountServiceAccountToken}",
  ]);
  assert.equal(actorTokenMount, "false");
  const serviceTypes = (
    await kubectl([
      "get",
      "service",
      "--namespace",
      namespace,
      "pisa-model-relay",
      "pisa-remote-actor",
      "-o",
      "jsonpath={range .items[*]}{.metadata.name}={.spec.type}{\"\\n\"}{end}",
    ])
  )
    .split("\n")
    .filter(Boolean)
    .sort();
  assert.deepEqual(serviceTypes, [
    "pisa-model-relay=ClusterIP",
    "pisa-remote-actor=ClusterIP",
  ]);

  await mkdir(dirname(evidencePath), { recursive: true, mode: 0o700 });
  await writeFile(
    evidencePath,
    [
      `image=${image}`,
      `actor_id=${actorId}`,
      `runtime_class=${runtimeClass}`,
      "service_exposure=ClusterIP-only",
      "service_account_token=false",
      "archive_integrity=verified",
      `source_revision=${source.revision}`,
      `patch_sha256=${result.patch.sha256}`,
      "changed_paths=math.js",
      `actor_attempts=${attempts}`,
      "actor_test_gate=PASS",
      "trusted_replay=PASS",
      "trusted_sandboxed_test=PASS",
      "trusted_local_commit=PASS",
      "job_capability_split=PASS",
      "actor_single_job_lifetime=PASS",
      "bridge_disconnect_fail_closed=PASS",
      "github_copilot_azure_credentials_in_actor=NONE",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  console.log("PISA_REMOTE_ACTOR_OK");
} finally {
  if (bridge !== undefined) {
    await bridge.close().catch(() => undefined);
  }
  if (broker !== undefined) {
    await broker.close().catch(() => undefined);
  }
  for (const child of portForwards.reverse()) {
    await stopChild(child);
  }
  await rm(scratch, { recursive: true, force: true });
}

async function runAcceptedActorTask(
  actorUrl: URL,
  request: RemoteActorRunRequest,
): Promise<{ result: RemoteActorRunResponse; attempts: number }> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const actorState = await actorContainerState();
    const response = await fetch(actorUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${jobClientCapability}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(600_000),
    });
    if (response.status === 200) {
      await waitForActorRestart(actorState);
      return {
        result: (await response.json()) as RemoteActorRunResponse,
        attempts: attempt,
      };
    }
    const body = (await response.json()) as RemoteActorErrorResponse;
    if (
      response.status !== 422 ||
      body.error.code !== "actor_acceptance_failed"
    ) {
      throw new Error(`Remote actor request failed: ${body.error.code}`);
    }
    await waitForActorRestart(actorState);
  }
  throw new Error("Remote actor did not satisfy the test gate");
}

async function deployCapabilities(): Promise<void> {
  await kubectl([
    "delete",
    "deployment",
    "--namespace",
    namespace,
    "pisa-model-relay",
    "pisa-remote-actor",
    "--ignore-not-found",
    "--wait=true",
  ]);
  await kubectl([
    "delete",
    "secret",
    "--namespace",
    namespace,
    "pisa-relay-capabilities",
    "pisa-actor-capabilities",
    "--ignore-not-found",
    "--wait=true",
  ]);
  const secretList = {
    apiVersion: "v1",
    kind: "List",
    items: [
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
          name: "pisa-relay-capabilities",
          namespace,
        },
        type: "Opaque",
        stringData: {
          "actor-token": relayActorCapability,
          "tunnel-token": tunnelCapability,
          "job-client-token": jobClientCapability,
          "actor-job-token": actorJobCapability,
        },
      },
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
          name: "pisa-actor-capabilities",
          namespace,
        },
        type: "Opaque",
        stringData: {
          "actor-token": relayActorCapability,
          "actor-job-token-sha256": sha256(actorJobCapability),
        },
      },
    ],
  };
  await kubectlInput(["apply", "-f", "-"], JSON.stringify(secretList));
}

async function deployNamespace(): Promise<void> {
  await kubectlInput(
    ["apply", "-f", "-"],
    JSON.stringify({
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: namespace,
        labels: {
          "pod-security.kubernetes.io/enforce": "restricted",
          "pod-security.kubernetes.io/enforce-version": "latest",
        },
      },
    }),
  );
}

async function deployWorkloads(image: string): Promise<void> {
  await kubectl([
    "delete",
    "pod",
    "--namespace",
    namespace,
    "pisa-probe-runc",
    "pisa-probe-kata",
    "--ignore-not-found",
    "--wait=true",
  ]);
  await kubectl([
    "delete",
    "networkpolicy",
    "--namespace",
    namespace,
    "pisa-model-relay-no-egress",
    "--ignore-not-found",
  ]);
  const template = await readFile(manifestPath, "utf8");
  const manifest = template
    .replaceAll("__PISA_HARNESS_IMAGE__", image)
    .replaceAll("__PISA_DEPLOY_REVISION__", randomUUID());
  assert.equal(manifest.includes("__PISA_"), false);
  await kubectlInput(["apply", "-f", "-"], manifest);
  for (const deployment of ["pisa-model-relay", "pisa-remote-actor"]) {
    await kubectl([
      "rollout",
      "status",
      `deployment/${deployment}`,
      "--namespace",
      namespace,
      "--timeout=600s",
    ]);
  }
}

async function startPortForward(
  resource: string,
  localPort: number,
): Promise<ChildProcess> {
  const child = spawn(
    "kubectl",
    [
      "--context",
      kubeContext,
      "port-forward",
      "--namespace",
      namespace,
      "--address=127.0.0.1",
      resource,
      `${localPort}:8080`,
    ],
    {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  await new Promise<void>((resolveReady, reject) => {
    const deadline = setTimeout(() => {
      reject(new Error(`Port-forward for ${resource} did not become ready`));
    }, 30_000);
    const interval = setInterval(() => {
      if (output.includes(`Forwarding from 127.0.0.1:${localPort}`)) {
        clearInterval(interval);
        clearTimeout(deadline);
        resolveReady();
      }
    }, 50);
    child.once("exit", () => {
      clearInterval(interval);
      clearTimeout(deadline);
      reject(new Error(`Port-forward for ${resource} exited early`));
    });
  });
  return child;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) {
    return;
  }
  await new Promise<void>((resolveStopped) => {
    const timer = setTimeout(resolveStopped, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveStopped();
    });
    child.kill("SIGTERM");
  });
}

async function waitForRelayBridge(
  port: number,
  expected: boolean,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body = (await response.json()) as {
      bridgeConnected: boolean;
    };
    if (body.bridgeConnected === expected) {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Relay bridge state did not converge");
}

interface ActorContainerState {
  podName: string;
  restartCount: number;
  ready: boolean;
}

async function actorContainerState(): Promise<ActorContainerState> {
  const output = await kubectl([
    "get",
    "pod",
    "--namespace",
    namespace,
    "--selector",
    "app.kubernetes.io/name=pisa-remote-actor",
    "-o",
    "jsonpath={.items[0].metadata.name}{\"\\t\"}{.items[0].status.containerStatuses[0].restartCount}{\"\\t\"}{.items[0].status.containerStatuses[0].ready}",
  ]);
  const [podName, restartCount, ready] = output.split("\t");
  if (
    podName === undefined ||
    podName.length === 0 ||
    restartCount === undefined ||
    !Number.isInteger(Number(restartCount)) ||
    ready === undefined
  ) {
    throw new Error("Remote actor container state is unavailable");
  }
  return {
    podName,
    restartCount: Number(restartCount),
    ready: ready === "true",
  };
}

async function waitForActorRestart(
  before: ActorContainerState,
): Promise<void> {
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    const current = await actorContainerState();
    if (
      current.ready &&
      (current.podName !== before.podName ||
        current.restartCount > before.restartCount)
    ) {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error("Remote actor did not restart after its single job");
}

async function runSandboxedTest(
  image: string,
  workspace: string,
): Promise<void> {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid === undefined || gid === undefined || uid === 0) {
    throw new Error("Sandboxed trusted tests require a non-root local user");
  }
  await execFileAsync(
    "docker",
    [
      "run",
      "--rm",
      "--platform=linux/amd64",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--pids-limit=128",
      "--memory=512m",
      "--cpus=1",
      `--user=${uid}:${gid}`,
      "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m",
      "--mount",
      `type=bind,source=${workspace},target=/workspace,readonly`,
      "--workdir=/workspace",
      "--env=HOME=/tmp",
      "--env=CI=1",
      "--env=npm_config_audit=false",
      "--env=npm_config_fund=false",
      "--env=npm_config_update_notifier=false",
      image,
      "npm",
      "test",
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 1024 * 1024,
      env: process.env,
    },
  );
}

async function createFixtureRepository(root: string): Promise<string> {
  const repository = join(root, "trusted-fixture");
  await cp(fixturePath, repository, { recursive: true });
  await writeFile(join(repository, ".gitignore"), ".state/\n", "utf8");
  await git(repository, ["init", "--initial-branch=main"]);
  await git(repository, ["add", "--all"]);
  await git(repository, [
    "-c",
    "user.name=PISA Fixture",
    "-c",
    "user.email=pisa-fixture@invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--no-gpg-sign",
    "-m",
    "remote fixture",
  ]);
  return repository;
}

async function git(cwd: string, args: string[]): Promise<string> {
  return runCommand("git", args, cwd, 30_000);
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeout: number,
): Promise<string> {
  const commandHome = join(scratch, "command-home");
  await mkdir(commandHome, { recursive: true, mode: 0o700 });
  const result = await execFileAsync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 1024 * 1024,
    env: {
      PATH: process.env.PATH,
      HOME: commandHome,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      NPM_CONFIG_CACHE: join(commandHome, "npm-cache"),
      NPM_CONFIG_USERCONFIG: "/dev/null",
    },
  });
  return result.stdout.trim();
}

async function kubectl(args: string[]): Promise<string> {
  const result = await execFileAsync(
    "kubectl",
    ["--context", kubeContext, ...args],
    {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 620_000,
      maxBuffer: 1024 * 1024,
    },
  );
  return result.stdout.trim();
}

async function kubectlInput(
  args: string[],
  input: string,
): Promise<void> {
  const child = spawn(
    "kubectl",
    ["--context", kubeContext, ...args],
    {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    },
  );
  let outputBytes = 0;
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 1024 * 1024 && child.pid !== undefined) {
        child.kill("SIGTERM");
      }
    });
  }
  child.stdin?.end(input);
  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  if (exitCode !== 0) {
    throw new Error("kubectl manifest application failed");
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Unable to allocate a local TCP port");
  }
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolveClose();
      } else {
        reject(error);
      }
    });
  });
  return port;
}

function capability(): string {
  return randomBytes(32).toString("base64url");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
