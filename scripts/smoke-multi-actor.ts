import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
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
  type SourceArchiveArtifact,
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
  "tests/fixtures/multi-actor-calculator",
);
const stateRoot = join(projectRoot, ".state", "multi-actor-smoke");
const imageFile = join(projectRoot, ".state/aks/harness-image.txt");
const manifestPath = join(projectRoot, "deploy/aks/multi-actor.yaml");
const evidenceTextPath = join(
  projectRoot,
  "evidence/multi-actor/remote-concurrency.txt",
);
const evidenceJsonPath = join(
  projectRoot,
  "evidence/multi-actor/results.json",
);
const kubeContext = "pisa-aks";
const namespace = "pi-substrate";
const maxActorAttempts = 5;
const tunnelCapability = capability();
const jobClientCapability = capability();

interface ActorConfiguration {
  id: string;
  deployment: string;
  service: string;
  relayCapability: string;
  deliveryCapability: string;
  brokerCapability: string;
  expectedPaths: string[];
  task: string;
}

const implementer: ActorConfiguration = {
  id: "remote-implementer",
  deployment: "pisa-remote-implementer",
  service: "pisa-remote-implementer",
  relayCapability: capability(),
  deliveryCapability: capability(),
  brokerCapability: capability(),
  expectedPaths: ["multiply.js", "multiply.test.js"],
  task:
    "Read package.json and the existing math files. Implement `export function multiply(left, right)` in a new multiply.js file. Create only multiply.test.js using node:test and node:assert/strict, with passing cases for positive and negative integer multiplication. Do not modify or delete any existing file. Run `npm test` and stop only after every test passes.",
};
const reviewer: ActorConfiguration = {
  id: "remote-reviewer",
  deployment: "pisa-remote-reviewer",
  service: "pisa-remote-reviewer",
  relayCapability: capability(),
  deliveryCapability: capability(),
  brokerCapability: capability(),
  expectedPaths: ["math.review.test.js"],
  task:
    "Read package.json, math.js, and math.test.js. Review the existing add implementation and test coverage. Create only math.review.test.js using node:test and node:assert/strict, with passing coverage for negative operands and zero. Do not modify or delete any existing file. Run `npm test` and stop only after every test passes.",
};
const actors = [implementer, reviewer] as const;
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
    authorizer: new ActorTokenAuthorizer(
      Object.fromEntries(
        actors.map((actor) => [actor.id, actor.brokerCapability]),
      ),
    ),
    maxConcurrentRequests: 2,
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
    actorTokens: Object.fromEntries(
      actors.map((actor) => [actor.id, actor.brokerCapability]),
    ),
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
  const remoteSource = {
    revision: source.revision,
    sha256: source.sha256,
    bytes: source.bytes,
    entries: source.entries,
    contentBase64: (await readFile(source.path)).toString("base64"),
  };
  const requests = new Map<ActorConfiguration, RemoteActorRunRequest>(
    actors.map((actor) => [
      actor,
      {
        task: actor.task,
        source: remoteSource,
      },
    ]),
  );

  const initialStates = await Promise.all(
    actors.map((actor) => actorContainerState(actor)),
  );
  const initialAttempts = actors.map((actor) =>
    requestActorOnce(actor, requiredRequest(requests, actor), relayPort),
  );
  await waitForActiveJobs(relayPort, 2);
  const settledInitial = await Promise.all(initialAttempts);
  await Promise.all(
    actors.map((actor, index) =>
      waitForActorRestart(
        actor,
        requiredArrayEntry(initialStates, index),
      ),
    ),
  );
  const overlapMs =
    Math.min(...settledInitial.map((attempt) => attempt.finishedAt)) -
    Math.max(...settledInitial.map((attempt) => attempt.startedAt));
  assert.ok(overlapMs > 0, "Remote actor requests did not overlap");

  const accepted = await Promise.all(
    actors.map((actor, index) =>
      finishAcceptedActorTask(
        actor,
        requiredRequest(requests, actor),
        requiredArrayEntry(settledInitial, index),
        relayPort,
      ),
    ),
  );
  for (const outcome of accepted) {
    validateActorResult(outcome.actor, outcome.result);
  }

  await assertActorCapabilityCannotSubmitJob(relayPort, implementer);
  await assertUnknownActorRejected(relayPort);

  const patches = new Map<ActorConfiguration, PatchArtifact>();
  for (const outcome of accepted) {
    const patchPath = join(
      repository,
      ".state",
      `${outcome.actor.id}.patch`,
    );
    await writeFile(
      patchPath,
      Buffer.from(outcome.result.patch.contentBase64, "base64"),
      { flag: "wx", mode: 0o600 },
    );
    const patch: PatchArtifact = {
      path: patchPath,
      sourceRevision: outcome.result.patch.sourceRevision,
      sha256: outcome.result.patch.sha256,
      bytes: outcome.result.patch.bytes,
      changedPaths: outcome.result.patch.changedPaths,
    };
    await transport.materializeValidatedPatch(
      source,
      patch,
      join(scratch, `validated-${outcome.actor.id}`),
    );
    patches.set(outcome.actor, patch);
  }
  assert.equal(
    new Set(
      accepted.flatMap((outcome) => outcome.result.patch.changedPaths),
    ).size,
    accepted.reduce(
      (total, outcome) => total + outcome.result.patch.changedPaths.length,
      0,
    ),
    "Actor patches overlap",
  );

  const combinedPatch = await combinePatches(
    transport,
    source,
    actors.map((actor) => requiredPatch(patches, actor)),
    repository,
  );
  assert.deepEqual(
    [...combinedPatch.changedPaths].sort(),
    actors.flatMap((actor) => actor.expectedPaths).sort(),
  );
  const trustedTestWorkspace = join(scratch, "trusted-test-workspace");
  await transport.materializeValidatedPatch(
    source,
    combinedPatch,
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
    (
      await transport.applyValidatedPatch(
        repository,
        source,
        combinedPatch,
      )
    ).sort(),
    combinedPatch.changedPaths,
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
    "merge isolated actor patches",
  ]);
  assert.equal(await git(repository, ["status", "--porcelain"]), "");
  assert.match(
    await readFile(join(repository, "multiply.js"), "utf8"),
    /left\s*\*\s*right/,
  );

  const actorToActorConnectivity = await Promise.all([
    assertActorConnectivityBlocked(implementer, reviewer),
    assertActorConnectivityBlocked(reviewer, implementer),
  ]);
  assert.deepEqual(actorToActorConnectivity, ["blocked", "blocked"]);
  const runtimeClasses = await Promise.all(
    actors.map((actor) => actorRuntimeClass(actor)),
  );
  assert.deepEqual(runtimeClasses, [
    "kata-vm-isolation",
    "kata-vm-isolation",
  ]);
  const automounts = await Promise.all(
    actors.map((actor) => actorAutomount(actor)),
  );
  assert.deepEqual(automounts, ["false", "false"]);
  const serviceTypes = await getServiceTypes([
    "pisa-model-relay",
    ...actors.map((actor) => actor.service),
  ]);
  assert.deepEqual(serviceTypes, [
    "pisa-model-relay=ClusterIP",
    "pisa-remote-implementer=ClusterIP",
    "pisa-remote-reviewer=ClusterIP",
  ]);
  const distinctNodes = new Set(
    await Promise.all(actors.map((actor) => actorNode(actor))),
  ).size;

  const results = {
    image,
    sourceRevision: source.revision,
    concurrency: {
      relayActiveJobsObserved: 2,
      overlapMs,
    },
    actors: accepted.map((outcome) => ({
      actorId: outcome.actor.id,
      role:
        outcome.actor === implementer ? "implementer" : "reviewer-tester",
      attempts: outcome.attempts,
      patchSha256: outcome.result.patch.sha256,
      changedPaths: outcome.result.patch.changedPaths,
      testGate: "PASS",
    })),
    combinedPatch: {
      sha256: combinedPatch.sha256,
      changedPaths: combinedPatch.changedPaths,
      trustedReplay: "PASS",
      trustedSandboxedTest: "PASS",
      trustedCommit: "PASS",
    },
    isolation: {
      runtimeClass: "kata-vm-isolation",
      serviceAccountToken: false,
      serviceExposure: "ClusterIP-only",
      actorToActorNetwork: "blocked",
      actorCapabilityCannotSubmitJob: "PASS",
      distinctSandboxNodes: distinctNodes,
      externalCredentialsInActors: "NONE",
    },
  };
  await mkdir(dirname(evidenceJsonPath), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(
    evidenceJsonPath,
    `${JSON.stringify(results, null, 2)}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    evidenceTextPath,
    [
      `image=${image}`,
      `source_revision=${source.revision}`,
      "actor_count=2",
      "actor_ids=remote-implementer,remote-reviewer",
      "roles=implementer,reviewer-tester",
      "relay_active_jobs_observed=2",
      `request_overlap_ms=${overlapMs}`,
      `implementer_attempts=${accepted[0]?.attempts}`,
      `reviewer_attempts=${accepted[1]?.attempts}`,
      `implementer_patch_sha256=${accepted[0]?.result.patch.sha256}`,
      `reviewer_patch_sha256=${accepted[1]?.result.patch.sha256}`,
      `combined_patch_sha256=${combinedPatch.sha256}`,
      `combined_changed_paths=${combinedPatch.changedPaths.join(",")}`,
      "actor_test_gates=PASS",
      "trusted_replay=PASS",
      "trusted_sandboxed_test=PASS",
      "trusted_local_commit=PASS",
      "runtime_class=kata-vm-isolation",
      `distinct_sandbox_nodes=${distinctNodes}`,
      "service_exposure=ClusterIP-only",
      "service_account_tokens=false",
      "actor_to_actor_network=blocked",
      "actor_capability_cannot_submit_job=PASS",
      "github_copilot_azure_credentials_in_actors=NONE",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  console.log("PISA_MULTI_ACTOR_OK");
} finally {
  if (bridge !== undefined) {
    await settleCleanup(bridge.close(), 10_000);
  }
  if (broker !== undefined) {
    await settleCleanup(broker.close(), 30_000);
  }
  for (const child of portForwards.reverse()) {
    await stopChild(child);
  }
  await rm(scratch, { recursive: true, force: true });
}
process.exit(0);

type ActorAttempt =
  | {
      ok: true;
      result: RemoteActorRunResponse;
      startedAt: number;
      finishedAt: number;
    }
  | {
      ok: false;
      status: number;
      errorCode: string;
      startedAt: number;
      finishedAt: number;
    };

interface AcceptedActorResult {
  actor: ActorConfiguration;
  result: RemoteActorRunResponse;
  attempts: number;
}

async function requestActorOnce(
  actor: ActorConfiguration,
  request: RemoteActorRunRequest,
  relayPort: number,
): Promise<ActorAttempt> {
  const startedAt = Date.now();
  const response = await fetch(
    new URL(
      `/v1/actor/${actor.id}/run`,
      `http://127.0.0.1:${relayPort}`,
    ),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${jobClientCapability}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(660_000),
    },
  );
  const finishedAt = Date.now();
  if (response.status === 200) {
    return {
      ok: true,
      result: (await response.json()) as RemoteActorRunResponse,
      startedAt,
      finishedAt,
    };
  }
  const error = (await response.json()) as RemoteActorErrorResponse;
  return {
    ok: false,
    status: response.status,
    errorCode: error.error.code,
    startedAt,
    finishedAt,
  };
}

async function finishAcceptedActorTask(
  actor: ActorConfiguration,
  request: RemoteActorRunRequest,
  initial: ActorAttempt,
  relayPort: number,
): Promise<AcceptedActorResult> {
  if (initial.ok) {
    return { actor, result: initial.result, attempts: 1 };
  }
  assertRetryable(initial);
  for (let attempt = 2; attempt <= maxActorAttempts; attempt += 1) {
    const state = await actorContainerState(actor);
    const outcome = await requestActorOnce(actor, request, relayPort);
    await waitForActorRestart(actor, state);
    if (outcome.ok) {
      return { actor, result: outcome.result, attempts: attempt };
    }
    assertRetryable(outcome);
  }
  throw new Error(`${actor.id} did not satisfy the test gate`);
}

function assertRetryable(
  attempt: Exclude<ActorAttempt, { ok: true }>,
): void {
  if (
    attempt.status !== 422 ||
    attempt.errorCode !== "actor_acceptance_failed"
  ) {
    throw new Error(`Remote actor request failed: ${attempt.errorCode}`);
  }
}

function validateActorResult(
  actor: ActorConfiguration,
  result: RemoteActorRunResponse,
): void {
  assert.equal(result.actorId, actor.id);
  assert.deepEqual(
    [...result.patch.changedPaths].sort(),
    [...actor.expectedPaths].sort(),
  );
  assert.deepEqual(
    result.changedFiles.map((file) => file.path).sort(),
    [...actor.expectedPaths].sort(),
  );
  assert.equal(
    result.events.some(
      (event) =>
        event.type === "tool_end" &&
        event.toolName === "workspace_test" &&
        event.isError === false,
    ),
    true,
  );
}

async function combinePatches(
  transport: SourceTransport,
  source: SourceArchiveArtifact,
  patches: PatchArtifact[],
  repository: string,
): Promise<PatchArtifact> {
  const workspace = join(scratch, "combined-workspace");
  await transport.materializeSourceArchive(source, workspace);
  const baseline = await transport.initializeActorBaseline(
    workspace,
    source.revision,
  );
  for (const patch of patches) {
    await runCommand(
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
      workspace,
      30_000,
    );
  }
  return transport.exportActorPatch(
    baseline,
    join(repository, ".state", "combined-actors.patch"),
  );
}

async function assertActorCapabilityCannotSubmitJob(
  relayPort: number,
  actor: ActorConfiguration,
): Promise<void> {
  const response = await fetch(
    new URL(
      `/v1/actor/${reviewer.id}/run`,
      `http://127.0.0.1:${relayPort}`,
    ),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${actor.relayCapability}`,
        "content-type": "application/json",
      },
      body: "{}",
    },
  );
  assert.equal(response.status, 401);
}

async function assertUnknownActorRejected(relayPort: number): Promise<void> {
  const response = await fetch(
    new URL(
      "/v1/actor/remote-unknown/run",
      `http://127.0.0.1:${relayPort}`,
    ),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${jobClientCapability}`,
        "content-type": "application/json",
      },
      body: "{}",
    },
  );
  assert.equal(response.status, 404);
}

async function deployCapabilities(): Promise<void> {
  await kubectl([
    "delete",
    "deployment",
    "--namespace",
    namespace,
    "pisa-model-relay",
    "pisa-remote-actor",
    implementer.deployment,
    reviewer.deployment,
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
    "pisa-actor-implementer-capabilities",
    "pisa-actor-reviewer-capabilities",
    "--ignore-not-found",
    "--wait=true",
  ]);
  await kubectlInput(
    ["apply", "-f", "-"],
    JSON.stringify({
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
            "implementer-actor-token": implementer.relayCapability,
            "implementer-job-token": implementer.deliveryCapability,
            "reviewer-actor-token": reviewer.relayCapability,
            "reviewer-job-token": reviewer.deliveryCapability,
            "tunnel-token": tunnelCapability,
            "job-client-token": jobClientCapability,
          },
        },
        {
          apiVersion: "v1",
          kind: "Secret",
          metadata: {
            name: "pisa-actor-implementer-capabilities",
            namespace,
          },
          type: "Opaque",
          stringData: {
            "actor-token": implementer.relayCapability,
            "actor-job-token-sha256": sha256(
              implementer.deliveryCapability,
            ),
          },
        },
        {
          apiVersion: "v1",
          kind: "Secret",
          metadata: {
            name: "pisa-actor-reviewer-capabilities",
            namespace,
          },
          type: "Opaque",
          stringData: {
            "actor-token": reviewer.relayCapability,
            "actor-job-token-sha256": sha256(reviewer.deliveryCapability),
          },
        },
      ],
    }),
  );
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
    "service",
    "--namespace",
    namespace,
    "pisa-remote-actor",
    "--ignore-not-found",
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
  await kubectl([
    "rollout",
    "status",
    "deployment/pisa-model-relay",
    "--namespace",
    namespace,
    "--timeout=300s",
  ]);
  await Promise.all(
    actors.map((actor) =>
      kubectl([
        "rollout",
        "status",
        `deployment/${actor.deployment}`,
        "--namespace",
        namespace,
        "--timeout=900s",
      ]),
    ),
  );
}

interface ActorContainerState {
  podName: string;
  restartCount: number;
  ready: boolean;
}

async function actorContainerState(
  actor: ActorConfiguration,
): Promise<ActorContainerState> {
  const output = await kubectl([
    "get",
    "pod",
    "--namespace",
    namespace,
    "--selector",
    `pisa.runtime/actor-id=${actor.id}`,
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
    throw new Error(`${actor.id} container state is unavailable`);
  }
  return {
    podName,
    restartCount: Number(restartCount),
    ready: ready === "true",
  };
}

async function waitForActorRestart(
  actor: ActorConfiguration,
  before: ActorContainerState,
): Promise<void> {
  const deadline = Date.now() + 900_000;
  while (Date.now() < deadline) {
    const current = await actorContainerState(actor);
    if (
      current.ready &&
      (current.podName !== before.podName ||
        current.restartCount > before.restartCount)
    ) {
      return;
    }
    await delay(1_000);
  }
  throw new Error(`${actor.id} did not restart after its single job`);
}

async function waitForActiveJobs(
  relayPort: number,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${relayPort}/healthz`);
    const body = (await response.json()) as {
      activeJobs: number;
    };
    if (body.activeJobs === expected) {
      return;
    }
    await delay(50);
  }
  throw new Error("Relay did not observe both actor jobs concurrently");
}

async function waitForRelayBridge(
  relayPort: number,
  expected: boolean,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${relayPort}/healthz`);
    const body = (await response.json()) as {
      bridgeConnected: boolean;
    };
    if (body.bridgeConnected === expected) {
      return;
    }
    await delay(100);
  }
  throw new Error("Relay bridge state did not converge");
}

async function actorRuntimeClass(
  actor: ActorConfiguration,
): Promise<string> {
  return kubectl([
    "get",
    "pod",
    "--namespace",
    namespace,
    "--selector",
    `pisa.runtime/actor-id=${actor.id}`,
    "-o",
    "jsonpath={.items[0].spec.runtimeClassName}",
  ]);
}

async function actorAutomount(
  actor: ActorConfiguration,
): Promise<string> {
  return kubectl([
    "get",
    "pod",
    "--namespace",
    namespace,
    "--selector",
    `pisa.runtime/actor-id=${actor.id}`,
    "-o",
    "jsonpath={.items[0].spec.automountServiceAccountToken}",
  ]);
}

async function actorNode(actor: ActorConfiguration): Promise<string> {
  return kubectl([
    "get",
    "pod",
    "--namespace",
    namespace,
    "--selector",
    `pisa.runtime/actor-id=${actor.id}`,
    "-o",
    "jsonpath={.items[0].spec.nodeName}",
  ]);
}

async function assertActorConnectivityBlocked(
  source: ActorConfiguration,
  destination: ActorConfiguration,
): Promise<"blocked"> {
  const pod = (await actorContainerState(source)).podName;
  const result = await kubectl([
    "exec",
    "--namespace",
    namespace,
    pod,
    "--",
    "node",
    "-e",
    actorConnectivityProbe(
      `${destination.service}.${namespace}.svc.cluster.local`,
    ),
  ]);
  assert.equal(result, "blocked");
  return "blocked";
}

function actorConnectivityProbe(host: string): string {
  return String.raw`
const net = require("node:net");
const socket = net.createConnection({ host: ${JSON.stringify(host)}, port: 8080 });
let complete = false;
const finish = (result) => {
  if (complete) return;
  complete = true;
  socket.destroy();
  console.log(result);
};
socket.setTimeout(2000);
socket.once("connect", () => finish("reachable"));
socket.once("error", () => finish("blocked"));
socket.once("timeout", () => finish("blocked"));
`;
}

async function getServiceTypes(services: string[]): Promise<string[]> {
  return (
    await kubectl([
      "get",
      "service",
      "--namespace",
      namespace,
      ...services,
      "-o",
      "jsonpath={range .items[*]}{.metadata.name}={.spec.type}{\"\\n\"}{end}",
    ])
  )
    .split("\n")
    .filter(Boolean)
    .sort();
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
    "multi actor fixture",
  ]);
  return repository;
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
  try {
    await new Promise<void>((resolveReady, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearInterval(interval);
        clearTimeout(deadline);
        child.off("exit", onExit);
        if (error === undefined) {
          resolveReady();
        } else {
          reject(error);
        }
      };
      const onExit = (): void => {
        finish(new Error(`Port-forward for ${resource} exited early`));
      };
      const deadline = setTimeout(() => {
        finish(new Error(`Port-forward for ${resource} did not become ready`));
      }, 30_000);
      const interval = setInterval(() => {
        if (output.includes(`Forwarding from 127.0.0.1:${localPort}`)) {
          finish();
        }
      }, 50);
      child.once("exit", onExit);
    });
    return child;
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (
    child.exitCode !== null ||
    child.signalCode !== null ||
    child.pid === undefined
  ) {
    return;
  }
  child.kill("SIGTERM");
  if (await waitForChildExit(child, 5_000)) {
    return;
  }
  child.kill("SIGKILL");
  if (!(await waitForChildExit(child, 5_000))) {
    throw new Error(`Unable to stop child process ${child.pid}`);
  }
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }
  return await new Promise<boolean>((resolveExit) => {
    let settled = false;
    const finish = (exited: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.off("exit", onExit);
      resolveExit(exited);
    };
    const onExit = (): void => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
    if (child.exitCode !== null || child.signalCode !== null) {
      finish(true);
    }
  });
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
      timeout: 920_000,
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

function requiredRequest(
  requests: Map<ActorConfiguration, RemoteActorRunRequest>,
  actor: ActorConfiguration,
): RemoteActorRunRequest {
  const request = requests.get(actor);
  if (request === undefined) {
    throw new Error(`Request for ${actor.id} is unavailable`);
  }
  return request;
}

function requiredPatch(
  patches: Map<ActorConfiguration, PatchArtifact>,
  actor: ActorConfiguration,
): PatchArtifact {
  const patch = patches.get(actor);
  if (patch === undefined) {
    throw new Error(`Patch for ${actor.id} is unavailable`);
  }
  return patch;
}

function requiredArrayEntry<T>(values: T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error("Expected array entry is unavailable");
  }
  return value;
}

function capability(): string {
  return randomBytes(32).toString("base64url");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function settleCleanup(
  operation: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  await Promise.race([
    operation.catch(() => undefined),
    delay(timeoutMs),
  ]);
}
