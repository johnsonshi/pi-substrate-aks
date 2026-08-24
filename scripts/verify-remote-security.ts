import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const context = "pisa-aks";
const namespace = "pi-substrate";

const podName = await kubectl([
  "get",
  "pod",
  "--namespace",
  namespace,
  "--selector",
  "app.kubernetes.io/name=pisa-remote-actor",
  "-o",
  "jsonpath={.items[0].metadata.name}",
]);
assert.notEqual(podName, "", "Remote actor pod is unavailable");

const runtimeClass = await kubectl([
  "get",
  "pod",
  "--namespace",
  namespace,
  podName,
  "-o",
  "jsonpath={.spec.runtimeClassName}",
]);
assert.equal(runtimeClass, "kata-vm-isolation");

const automount = await kubectl([
  "get",
  "pod",
  "--namespace",
  namespace,
  podName,
  "-o",
  "jsonpath={.spec.automountServiceAccountToken}",
]);
assert.equal(automount, "false");

for (const service of ["pisa-model-relay", "pisa-remote-actor"]) {
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

const actorSecretKeys = (
  await kubectl([
    "get",
    "secret",
    "--namespace",
    namespace,
    "pisa-actor-capabilities",
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
assert.deepEqual(relaySecretKeys, [
  "actor-job-token",
  "actor-token",
  "job-client-token",
  "tunnel-token",
]);

const probeText = await kubectl([
  "exec",
  "--namespace",
  namespace,
  podName,
  "--",
  "node",
  "-e",
  remoteProbeSource(),
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
  publicInternet: "blocked",
});

console.log(`actor_pod=${podName}`);
console.log(`runtime_class=${runtimeClass}`);
console.log(`service_account_token=${probe.prohibitedPaths.serviceAccountToken}`);
console.log("credential_environment_names=NONE");
console.log("kubernetes_api=blocked");
console.log("imds=blocked");
console.log("public_internet=blocked");
console.log("service_exposure=ClusterIP-only");
console.log("capability_secret_keys=expected");
console.log("PISA_REMOTE_SECURITY_OK");

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
    publicInternet: "blocked" | "reachable";
  };
}

function remoteProbeSource(): string {
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
  connect("1.1.1.1", 443),
]).then(([kubernetesApi, imds, publicInternet]) => {
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
    connectivity: { kubernetesApi, imds, publicInternet },
  }));
});
`;
}
