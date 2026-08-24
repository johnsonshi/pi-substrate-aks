# Pi Substrate AKS

Private proof of concept for running credential-free Pi coding actors on isolated
AKS workloads while keeping GitHub Copilot authentication on a trusted local
machine.

The local credential broker is proven against the authenticated GitHub Copilot
SDK, and constrained Pi SDK actors have completed real read, edit, and test
tasks both locally and in an AKS Kata guest. Trusted archive/patch transport and
the pinned upstream Agent Substrate lifecycle are also proven. Multi-actor and
remaining runtime-matrix work remains in progress. See [STATUS.md](STATUS.md) for verified capabilities,
[DESIGN.md](DESIGN.md) for the authoritative design, and
[docs/LAB_NOTES.md](docs/LAB_NOTES.md) for the append-only experiment record.

## Security boundary

- Remote actors never receive GitHub, Copilot, Azure, SSH, or kubeconfig
  credentials.
- GitHub and Azure writes run only from the trusted local workspace.
- Model requests cross an authenticated relay to the local Copilot broker; raw
  credentials never cross the broker API.
- Azure resources are limited to `rg-pi-substrate-aks`.

## Bootstrap

```bash
./scripts/preflight.sh
npm ci --ignore-scripts
npm run typecheck
npm test
```

The real broker smoke test consumes one Copilot model request:

```bash
npm run smoke:copilot
```

It starts a loopback-only broker with an ephemeral actor token, creates a
tool-free SDK session using the already logged-in local user, and requires the
model to return `PISA_COPILOT_OK`. No GitHub token is accepted by the broker API
or printed by the test.

AKS commands will be added only after they are proven against the dedicated POC
resource group.

## Local broker

`packages/copilot-broker` provides:

- actor-token authentication with only token digests retained;
- actor/session ownership enforcement;
- bounded JSON bodies, messages, concurrency, and request duration;
- a deterministic fake backend for tests;
- a GitHub Copilot SDK backend with no available tools or session store;
- generic external errors that do not echo prompts, tokens, or backend details.

The standalone CLI binds only to loopback and requires local environment
variables:

```bash
PISA_ACTOR_ID=local-actor \
PISA_BROKER_TOKEN='<ephemeral-token-at-least-32-characters>' \
npx tsx packages/copilot-broker/src/cli.ts
```

Do not persist the token in this repository.

## Local Pi actor

`packages/pi-actor` wraps Pi's `createAgentSession()` with in-memory session and
settings stores, disabled resource discovery, and four constrained tools:

- `workspace_read`
- `workspace_edit`
- `workspace_write`
- `workspace_test`

The actor receives an ephemeral actor-scoped broker token, never a GitHub or
Copilot credential. Filesystem operations reject `.git`, traversal, and
canonical symlink escapes. Test execution uses exact command allowlisting and
`spawn()` without a shell. The deterministic integration proof copies a broken
calculator fixture, edits only `math.js`, runs `npm test`, and verifies an
out-of-workspace read is blocked:

```bash
node --import tsx --test tests/integration/pi-actor.test.ts
```

The real end-to-end smoke consumes Copilot model requests and operates only on
the repository-owned disposable fixture:

```bash
npm run smoke:pi-copilot
```

It must print exactly `PISA_PI_COPILOT_OK`. The actor receives only an ephemeral
broker token; the SDK resolves the existing logged-in user inside the trusted
local broker.

## Trusted source transport

`packages/orchestrator` moves a committed snapshot across the actor boundary
without GitHub credentials or local mounts:

1. resolve an exact local commit and reject links, submodules, credential-like
   paths, and credential-like content;
2. create a bounded `git archive` tar with a SHA-256 file manifest;
3. parse and materialize regular files into a new private actor workspace;
4. initialize credential-free actor-local Git metadata;
5. export a bounded full-index binary patch after scanning actor output;
6. apply the patch first to a disposable validation repository;
7. reject path/manifest changes, links, unsupported modes, credentials, and
   protected policy edits unless the trusted caller explicitly opts in;
8. stage the validated patch in the clean trusted repository for local commit.

The local roundtrip—including a fake-backed Pi edit/test task and trusted local
commit—is reproducible with:

```bash
npm run smoke:transport:local
```

## Pinned Agent Substrate kind baseline

The official upstream repository is pinned to
`bc51ef2452c4bf4c0542cd6850040c9ed1033421`. The ignored checkout runs in a
dedicated `pisa-substrate` kind cluster with all Kubernetes commands forced to
the `kind-pisa-substrate` context.

The local Docker node exposed no `/dev/kvm`, so this baseline used upstream
gVisor workers. It proved:

- a healthy control plane and three-worker counter pool;
- routed actor creation and activation;
- node-local `Full` pause/resume preserving memory and durable files;
- committed `Data` suspend/resume preserving durable files and cold-booting
  memory as declared;
- committed `Full` suspend/resume preserving both memory and durable files.

Use the exact commands in
[deploy/substrate/README.md](deploy/substrate/README.md). Sanitized results are
in [experiments/005-substrate-kind/RESULTS.md](experiments/005-substrate-kind/RESULTS.md).
This proof does not claim Substrate microVM or AKS compatibility.

## Dedicated AKS POC

The Azure baseline is provisioned only inside `rg-pi-substrate-aks`:

```bash
make aks-provision
make aks-verify
```

It uses a one-node Azure Linux system pool, a one-node
`KataVmIsolation` pool, Azure CNI overlay with Cilium, and a dedicated Basic
ACR with admin authentication disabled. The cluster currently has no
LoadBalancer services. See [deploy/aks/README.md](deploy/aks/README.md) and
[experiments/006-aks-provisioning/RESULTS.md](experiments/006-aks-provisioning/RESULTS.md).

Provisioning alone is not accepted as actor-isolation proof. Credential,
service-account, Kubernetes API, IMDS, egress, KVM, and runtime placement probes
remain part of the AKS compatibility matrix.

The first matrix checkpoint is complete:

```bash
make aks-runtime-probes
```

Restricted runc and `kata-vm-isolation` pods ran the same digest-pinned scratch
probe. Both had no prohibited credential variables, service-account token,
host/operator paths, or KVM access; Cilium blocked Kubernetes API, IMDS, and
public egress. Kata reported a distinct guest kernel. See
[experiments/007-aks-runtime-matrix/RESULTS.md](experiments/007-aks-runtime-matrix/RESULTS.md).

The same node does not expose a usable KVM API to a runc pod, and KVM
passthrough into Kata could not create a sandbox. Therefore this pool is
accepted for direct Kata actor isolation but blocked for nested Substrate
microVM placement.

## Pinned Substrate on AKS

The pinned upstream control plane and gVisor WorkerPool are blocked on this
managed AKS control plane:

```bash
make aks-substrate-preflight
```

AKS does not expose the `PodCertificateRequest` or `ClusterTrustBundle`
resources required by the upstream identity bootstrap. A server-side dry run
also removes both projected certificate-volume sources. The preflight stops
without mutating the cluster rather than leaving partial cluster-scoped CRDs
and RBAC.

The upstream gVisor worker independently requires a node host path, mount
propagation, AppArmor unconfined, and broad Linux capabilities. It is not
accepted as equivalent to this POC's restricted direct Kata actor. Exact
evidence is in
[experiments/009-substrate-aks/RESULTS.md](experiments/009-substrate-aks/RESULTS.md).

## OSS Agent Sandbox on AKS Kata

The official Kubernetes SIG Apps Agent Sandbox controller is pinned to release
`v0.5.6`, resolved commit
`211b7579cabed9460c1a692eb687084ff4c5879d`, and a verified release-manifest
digest. The tracked overlay runs the trusted controller under Restricted Pod
Security. Its cluster-wide Pod/PVC/Service/CRD authority is accepted only on
this dedicated disposable cluster; release `v0.5.6` has no namespace-scoped
watch flag.

Run the controller plus Kata lifecycle experiment:

```bash
make aks-agent-sandbox
```

The credential-free Sandbox has no service-account token or external
credential-related environment names and a deny-all network policy. The
experiment writes a marker to its workspace PVC, suspends until the Kata pod is
deleted, resumes into a new pod/process, and verifies that the marker survived.
It then leaves the probe suspended and restores the original remote actor.

This is genuine worker-releasing workspace suspend/resume, but it is a cold
process restart: Pi in-memory session state is not preserved. It is not called
Agent Substrate full-state resume. See
[experiments/011-agent-sandbox-aks/RESULTS.md](experiments/011-agent-sandbox-aks/RESULTS.md)
and [deploy/agent-sandbox/README.md](deploy/agent-sandbox/README.md).

## Remote AKS Pi actor

The remote path keeps authenticated Copilot entirely on the trusted
workstation:

```text
trusted source archive + job
  -> loopback kubectl port-forward
  -> private relay ClusterIP
  -> AKS Kata Pi actor
  -> integrity-tagged binary patch
  -> trusted disposable replay + test + local commit

AKS actor model request
  -> private relay
  -> authenticated WebSocket over the same port-forward
  -> trusted loopback broker
  -> existing local Copilot login
```

The path uses separate high-entropy capabilities for actor model access,
bridge tunneling, trusted job submission, and relay-to-actor delivery. The
actor receives only a one-way digest of the delivery capability. The relay
sends only the authenticated actor identity over the tunnel; the trusted
bridge maps that identity to a fifth, local-only broker capability. No GitHub,
Copilot, Azure, kubeconfig, registry, or workstation credential enters the
cluster.

Build and push the harness image, then run the real remote proof:

```bash
make aks-harness-image
npm run smoke:remote-actor
```

The smoke rotates in-memory-generated Kubernetes capabilities without printing
them, deploys only ClusterIP services, starts loopback port-forwards, sends the
fixture as a manifest-backed archive, requires a successful actor-side
`workspace_test`, independently replays and retests the exact final patch in
the Kata actor, validates the returned patch locally, reruns tests in a
no-network, read-only-mount Docker sandbox, and commits only the prevalidated
index in a disposable trusted repository. The actor pod is recycled after
every job. The smoke then disconnects the local bridge and verifies the actor
cannot return an accepted patch. Success prints:

```text
PISA_REMOTE_ACTOR_OK
```

The digest and sanitized result are in
[experiments/008-remote-actor/RESULTS.md](experiments/008-remote-actor/RESULTS.md).
The deployed actor remains fail closed after the smoke exits because the local
bridge and broker are gone.

## Security acceptance

The security gate combines deterministic policy tests with a direct live-actor
probe:

```bash
make security
```

The local suite makes an adversarial fake model follow prompt-injection text
that requests outside/Git reads, an outside write, and a destructive command.
All actions must be rejected without disclosing the operator canary or changing
protected files. The same suite covers actor/session identity, relay
authentication, path/symlink confinement, request bounds, and process-group
termination.

The live probe verifies the deployed workload still uses Kata, has no
service-account token or external credential-related environment names, cannot
reach the Kubernetes API, Azure IMDS, or public internet, and remains behind
ClusterIP-only Services with the expected split capability key names. It
inspects names and booleans only, never capability values or environment
values. See
[experiments/010-security-acceptance/RESULTS.md](experiments/010-security-acceptance/RESULTS.md).

Run the local portion without AKS:

```bash
npm run security:local
```
