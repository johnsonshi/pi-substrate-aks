import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const context = "pisa-aks";
const namespace = "pi-substrate";

interface ActorRuntime {
  actorId: string;
  podName: string;
  serviceName: string;
  secretName: string;
}

const multiActorLines = (
  await kubectl([
    "get",
    "pod",
    "--namespace",
    namespace,
    "--selector",
    "pisa.runtime/role=actor",
    "-o",
    "jsonpath={range .items[*]}{.metadata.name}{\"\\t\"}{.metadata.labels.pisa\\.runtime/actor-id}{\"\\n\"}{end}",
  ])
)
  .split("\n")
  .filter(Boolean);
const actors: ActorRuntime[] =
  multiActorLines.length === 0
    ? [
        {
          actorId: "remote-actor-1",
          podName: await kubectl([
            "get",
            "pod",
            "--namespace",
            namespace,
            "--selector",
            "app.kubernetes.io/name=pisa-remote-actor",
            "-o",
            "jsonpath={.items[0].metadata.name}",
          ]),
          serviceName: "pisa-remote-actor",
          secretName: "pisa-actor-capabilities",
        },
      ]
    : multiActorLines.map((line) => {
        const [podName, actorId] = line.split("\t");
        assert.notEqual(podName, undefined);
        assert.notEqual(actorId, undefined);
        if (podName === undefined || actorId === undefined) {
          throw new Error("Multi-actor pod identity is unavailable");
        }
        const suffix =
          actorId === "remote-implementer"
            ? "implementer"
            : actorId === "remote-reviewer"
              ? "reviewer"
              : undefined;
        if (suffix === undefined) {
          throw new Error("Unexpected remote actor identity");
        }
        return {
          actorId,
          podName,
          serviceName: `pisa-remote-${suffix}`,
          secretName: `pisa-actor-${suffix}-capabilities`,
        };
      });
assert.ok(actors.length > 0, "Remote actor pods are unavailable");
if (multiActorLines.length > 0) {
  assert.deepEqual(
    actors.map((actor) => actor.actorId).sort(),
    ["remote-implementer", "remote-reviewer"],
  );
}

for (const actor of actors) {
  const runtimeClass = await kubectl([
    "get",
    "pod",
    "--namespace",
    namespace,
    actor.podName,
    "-o",
    "jsonpath={.spec.runtimeClassName}",
  ]);
  assert.equal(runtimeClass, "kata-vm-isolation");

  const automount = await kubectl([
    "get",
    "pod",
    "--namespace",
    namespace,
    actor.podName,
    "-o",
    "jsonpath={.spec.automountServiceAccountToken}",
  ]);
  assert.equal(automount, "false");
}

for (const service of [
  "pisa-model-relay",
  ...actors.map((actor) => actor.serviceName),
]) {
  const type = await kubectl([
    "get",
    "service",
    "--namespace",
    namespace,
    service,
    "-o",
    "jsonpath={.spec.type}",
  ]);
  assert.equal(type, "ClusterIP");
}

for (const actor of actors) {
  const actorSecretKeys = (
    await kubectl([
      "get",
      "secret",
      "--namespace",
      namespace,
      actor.secretName,
      "-o",
      "go-template={{range $k, $_ := .data}}{{$k}} {{end}}",
    ])
  )
    .split(/\s+/)
    .filter(Boolean)
    .sort();
  assert.deepEqual(actorSecretKeys, [
    "actor-job-token-sha256",
    "actor-token",
  ]);
}

const relaySecretKeys = (
  await kubectl([
    "get",
    "secret",
    "--namespace",
    namespace,
    "pisa-relay-capabilities",
    "-o",
    "go-template={{range $k, $_ := .data}}{{$k}} {{end}}",
  ])
)
  .split(/\s+/)
  .filter(Boolean)
  .sort();
assert.deepEqual(
  relaySecretKeys,
  actors.length === 1
    ? [
        "actor-job-token",
        "actor-token",
        "job-client-token",
        "tunnel-token",
      ]
    : [
        "implementer-actor-token",
        "implementer-job-token",
        "job-client-token",
        "reviewer-actor-token",
        "reviewer-job-token",
        "tunnel-token",
      ],
);

const actorHostDenyPolicy = JSON.parse(
  await kubectl([
    "get",
    "ciliumnetworkpolicy",
    "--namespace",
    namespace,
    "pisa-remote-actor-host-deny",
    "-o",
    "json",
  ]),
) as CiliumNetworkPolicyDocument;
assert.equal(
  actorHostDenyPolicy.status?.conditions?.some(
    (condition) =>
      condition.type === "Valid" && condition.status === "True",
  ),
  true,
);
assert.equal(
  actorHostDenyPolicy.spec?.endpointSelector?.matchLabels?.[
    "k8s:pisa.runtime/role"
  ],
  "actor",
);
assert.deepEqual(
  [
    ...new Set(
      actorHostDenyPolicy.spec?.egressDeny?.flatMap(
        (rule) => rule.toEntities ?? [],
      ) ?? [],
    ),
  ].sort(),
  ["host", "kube-apiserver", "remote-node"],
);

for (const actor of actors) {
  const hostIp = await kubectl([
    "get",
    "pod",
    "--namespace",
    namespace,
    actor.podName,
    "-o",
    "jsonpath={.status.hostIP}",
  ]);
  const probeText = await kubectl([
    "exec",
    "--namespace",
    namespace,
    actor.podName,
    "--",
    "node",
    "-e",
    remoteProbeSource(hostIp),
  ]);
  const probe = JSON.parse(probeText) as RemoteSecurityProbe;

  assert.deepEqual(probe.credentialEnvironmentNames, []);
  assert.equal(probe.prohibitedPaths.serviceAccountToken, false);
  assert.equal(probe.prohibitedPaths.rootCopilot, false);
  assert.equal(probe.prohibitedPaths.rootAzure, false);
  assert.equal(probe.prohibitedPaths.nodeCopilot, false);
  assert.equal(probe.prohibitedPaths.nodeAzure, false);
  assert.equal(probe.prohibitedPaths.hostMount, false);
  assert.equal(probe.prohibitedPaths.kvm, false);
  assert.deepEqual(probe.connectivity, {
    kubernetesApi: "blocked",
    imds: "blocked",
    nodeKubelet: "blocked",
    publicInternet: "blocked",
  });
}

if (actors.length === 2) {
  for (const [source, destination] of [
    [actors[0], actors[1]],
    [actors[1], actors[0]],
  ] as const) {
    if (source === undefined || destination === undefined) {
      throw new Error("Expected multi-actor topology is unavailable");
    }
    const connectivity = await kubectl([
      "exec",
      "--namespace",
      namespace,
      source.podName,
      "--",
      "node",
      "-e",
      connectivityProbe(
        `${destination.serviceName}.${namespace}.svc.cluster.local`,
      ),
    ]);
    assert.equal(connectivity, "blocked");
  }
}

console.log(`actor_count=${actors.length}`);
console.log(
  `actor_ids=${actors.map((actor) => actor.actorId).sort().join(",")}`,
);
console.log("runtime_class=kata-vm-isolation");
console.log("service_account_token=false");
console.log("credential_environment_names=NONE");
console.log("kubernetes_api=blocked");
console.log("imds=blocked");
console.log("node_local=blocked");
console.log("public_internet=blocked");
if (actors.length === 2) {
  console.log("actor_to_actor_network=blocked");
}
console.log("service_exposure=ClusterIP-only");
console.log("capability_secret_keys=expected");
console.log("cilium_host_entity_deny=valid");
console.log("PISA_REMOTE_SECURITY_OK");

interface CiliumNetworkPolicyDocument {
  status?: {
    conditions?: Array<{
      type?: string;
      status?: string;
    }>;
  };
  spec?: {
    endpointSelector?: {
      matchLabels?: Record<string, string>;
    };
    egressDeny?: Array<{
      toEntities?: string[];
    }>;
  };
}

async function kubectl(args: string[]): Promise<string> {
  const result = await execFileAsync(
    "kubectl",
    ["--context", context, ...args],
    {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    },
  );
  return result.stdout.trim();
}

interface RemoteSecurityProbe {
  credentialEnvironmentNames: string[];
  prohibitedPaths: {
    serviceAccountToken: boolean;
    rootCopilot: boolean;
    rootAzure: boolean;
    nodeCopilot: boolean;
    nodeAzure: boolean;
    hostMount: boolean;
    kvm: boolean;
  };
  connectivity: {
    kubernetesApi: "blocked" | "reachable";
    imds: "blocked" | "reachable";
    nodeKubelet: "blocked" | "reachable";
    publicInternet: "blocked" | "reachable";
  };
}

function remoteProbeSource(hostIp: string): string {
  return String.raw`
const { existsSync } = require("node:fs");
const net = require("node:net");

function connect(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let complete = false;
    const finish = (result) => {
      if (complete) return;
      complete = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(1500);
    socket.once("connect", () => finish("reachable"));
    socket.once("error", () => finish("blocked"));
    socket.once("timeout", () => finish("blocked"));
  });
}

Promise.all([
  connect("kubernetes.default.svc", 443),
  connect("169.254.169.254", 80),
  connect(${JSON.stringify(hostIp)}, 10250),
  connect("1.1.1.1", 443),
]).then(([kubernetesApi, imds, nodeKubelet, publicInternet]) => {
  const credentialEnvironmentNames = Object.keys(process.env)
    .filter((name) =>
      /^(GITHUB|GH_|COPILOT|AZURE|ARM_|KUBECONFIG|MSI_|IDENTITY_)/i.test(name)
    )
    .sort();
  console.log(JSON.stringify({
    credentialEnvironmentNames,
    prohibitedPaths: {
      serviceAccountToken: existsSync(
        "/var/run/secrets/kubernetes.io/serviceaccount/token"
      ),
      rootCopilot: existsSync("/root/.copilot"),
      rootAzure: existsSync("/root/.azure"),
      nodeCopilot: existsSync("/home/node/.copilot"),
      nodeAzure: existsSync("/home/node/.azure"),
      hostMount: existsSync("/host"),
      kvm: existsSync("/dev/kvm"),
    },
    connectivity: { kubernetesApi, imds, nodeKubelet, publicInternet },
  }));
});
`;
}

function connectivityProbe(host: string): string {
  return String.raw`
const net = require("node:net");
const socket = net.createConnection({
  host: ${JSON.stringify(host)},
  port: 8080,
});
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
