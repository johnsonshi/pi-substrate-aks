# Decisions

## D-001: Keep model credentials behind a local broker

**Status:** accepted

### Context

Remote actors need model access, but copying the operator's GitHub Copilot
credential into AKS would collapse the actor isolation boundary.

### Options considered

- Copy a Copilot or GitHub token into each actor.
- Store a Copilot credential in a Kubernetes Secret.
- Keep authentication local and proxy bounded model requests through an
  authenticated relay.

### Decision

Use the existing authenticated local GitHub Copilot CLI behind a local broker.
Remote actors authenticate to a credential-free in-cluster relay using
short-lived actor-scoped credentials.

### Rationale

Stopping the local broker immediately revokes model access, and compromised
actors cannot read or reuse the underlying GitHub credential.

### Consequences

Remote runs require the trusted workstation and a private tunnel. Relay identity,
request limits, redaction, and fail-closed behavior become security-critical.

### Evidence

- `DESIGN.md` sections 3-5
- Security tests to be added under `tests/security/`

## D-002: Keep canonical Git operations local

**Status:** accepted

### Context

Actors must edit code without receiving repository credentials.

### Options considered

- Give actors GitHub credentials.
- Mount the trusted local repository into actor workloads.
- Transfer a source archive and return a validated binary patch.

### Decision

The local orchestrator exports source snapshots and validates returned patches.
Only the trusted local workspace commits and pushes.

### Rationale

This preserves the GitHub credential and filesystem boundaries while retaining a
reviewable coding workflow.

### Consequences

The orchestrator must reject traversal, symlink escapes, hooks, credential-like
files, and safety-policy changes before applying actor output.

### Evidence

- `DESIGN.md` sections 4 and 8

## D-003: Use the official Copilot SDK with explicit tool allowlists

**Status:** accepted

### Context

The broker needs a supported programmatic interface to the authenticated local
Copilot runtime. Parsing interactive CLI text would be brittle, and passing a
token explicitly would violate the credential boundary.

### Options considered

- Spawn `copilot -p` and parse text output.
- Use a private or reverse-engineered protocol.
- Use the official `@github/copilot-sdk` package and logged-in-user resolution.

### Decision

Use `@github/copilot-sdk` `1.0.11` with `useLoggedInUser: true`, no token
argument, disabled cross-session storage, and a replaced system message.
Text-only sessions use `availableTools: []`. Actor sessions expose only
explicitly declared `custom:*` relay tools and disable tool search.

### Rationale

The SDK is the supported typed JSON-RPC interface and has explicit session,
timeout, tool, and lifecycle APIs. Explicit allowlisting prevents the model
runtime from discovering or executing local shell, file, network, or
credential-access tools.

### Consequences

The broker process remains trusted and must run locally. SDK version changes need
contract tests. Actor-facing errors and logs must remain redacted.

### Evidence

- `packages/copilot-broker/src/copilot-sdk-backend.ts`
- `experiments/001-local-broker/RESULTS.md`

## D-004: Declare tools at the broker and execute them only in the actor

**Status:** accepted

### Context

Pi needs structured tool calls to run a coding loop. Returning tool instructions
as model text is ambiguous, while executing SDK custom-tool handlers in the
trusted broker would expose the local host to untrusted model actions.

### Options considered

- Parse tool requests from assistant text.
- Execute Copilot SDK custom tools inside the trusted broker.
- Declare bounded tools to Copilot, defer their handlers, execute calls through
  Pi in the actor workspace, and return structured results.

### Decision

Use typed prompt, tool-call, and tool-result envelopes. SDK handlers publish a
call and wait on a deferred result. Pi executes only its registered constrained
tools, then the broker resolves the handler so the original Copilot turn can
continue.

### Rationale

This preserves native structured tool calling without giving the trusted broker
filesystem or command-execution responsibilities. Actor runtime policy remains
the enforcement point even when repository content or model output is hostile.

### Consequences

The broker must bind each pending call to its session and reject unmatched
results. Actor tools need canonical path checks, exact command allowlists, and
stronger process/runtime isolation before remote use.

### Evidence

- `packages/copilot-broker/src/copilot-sdk-backend.ts`
- `packages/pi-actor/src/broker-provider.ts`
- `experiments/002-local-pi-actor/RESULTS.md`

## D-005: Migrate Pi to the patched package namespace

**Status:** accepted

### Context

GitHub reported high-severity advisories after the initial Pi integration. The
deprecated `@mariozechner/pi-coding-agent` line ends at `0.73.1` and has no
patched release. The maintained package moved to `@earendil-works`.

### Options considered

- Retain `0.73.1` because extensions and file-backed auth are disabled.
- Downgrade according to npm's incomplete automatic fix suggestion.
- Migrate the complete Pi package family to a current patched release.

### Decision

Pin `@earendil-works/pi-agent-core`, `pi-ai`, and `pi-coding-agent` to `0.84.2`.
Use in-memory credential and model stores with model-network refresh disabled.

### Rationale

Avoiding vulnerable code paths is defense in depth, not a substitute for taking
available security patches. Migrating the complete family avoids mixed-scope
type/runtime duplication and resolves the vulnerable transitive archive
dependency.

### Consequences

The actor uses the newer `ModelRuntime` API instead of the legacy in-memory
`AuthStorage`/`ModelRegistry` factories. Future updates require both fake and
real coding-loop validation.

### Evidence

- `packages/pi-actor/package.json`
- `packages/pi-actor/src/pi-actor.ts`
- zero findings from `npm audit --omit=dev` on 2026-08-24
- successful `npm run smoke:pi-copilot`

## D-006: Transport a snapshot archive, then validate a binary patch locally

**Status:** accepted

### Context

Actors need source and must return changes without GitHub credentials, host
mounts, or access to canonical Git metadata. A Git bundle includes reachable
history and could expose credentials deleted from the current tree.

### Options considered

- Mount the trusted working tree into the actor.
- Send a Git bundle with history and refs.
- Send a committed `git archive`, initialize actor-local Git metadata, and
  return a full-index binary patch.

### Decision

Create a bounded archive for one resolved commit, attach a SHA-256 content
manifest, and allow only regular files. Initialize a credential-free baseline
repository after materialization. Export a bounded binary patch, apply it to a
fresh validation workspace, inspect resulting paths/files/index modes, then
stage it in a clean trusted repository.

### Rationale

An archive exposes only the selected snapshot. Actor-local Git enables robust
binary diffs without carrying trusted history or configuration. Reapplying in a
disposable repository validates the final filesystem, not only patch text.

### Consequences

Symlinked files and submodules are rejected for this POC. Credential-like paths
or content fail closed. Authoritative prompts, security policy, workflows, and
enforcement code require an explicit `allowProtectedPaths` override. The final
commit remains a trusted local action.

### Evidence

- `packages/orchestrator/src/source-transport.ts`
- `tests/integration/source-transport.test.ts`
- `experiments/004-source-transport/RESULTS.md`

## D-007: Pin Substrate and keep runtime placements distinct

**Status:** accepted

### Context

Agent Substrate supports gVisor workers and a KVM-dependent microVM backend.
AKS Pod Sandboxing also uses Kata, but it wraps a Kubernetes pod and does not
automatically provide the same placement or nested KVM access as a
Substrate-managed microVM.

### Options considered

- Treat any Kata-branded runtime as equivalent evidence.
- Skip the local baseline and debug only on AKS.
- Pin upstream, prove its lifecycle locally, and test every AKS placement as a
  distinct compatibility case.

### Decision

Pin `agent-substrate/substrate` at
`bc51ef2452c4bf4c0542cd6850040c9ed1033421`. Use upstream gVisor for the kind
baseline when `/dev/kvm` is absent. Evaluate Substrate microVM on a normal
nested-virtualization-capable AKS node separately from an AKS
`kata-vm-isolation` actor-pod fallback. Never report one as evidence for the
other.

### Rationale

Pinning makes control-plane and lifecycle behavior reproducible. Keeping the
placements separate prevents a shared Kata implementation lineage from hiding
different trust boundaries, device visibility, and control ownership.

### Consequences

The AKS matrix must record node pool, RuntimeClass, `/dev/kvm` visibility,
worker placement, and effective isolation for each case. A blocked combination
is an architectural result rather than a reason to weaken the actor credential
or sandbox boundary.

### Evidence

- `experiments/005-substrate-kind/RESULTS.md`
- `deploy/substrate/UPSTREAM_SHA`
- `evidence/substrate-kind/health.txt`

## D-008: Use a minimal two-pool Cilium AKS topology

**Status:** accepted

### Context

The POC needs ordinary system capacity plus an AKS-managed Kata placement. It
also needs enforceable Kubernetes egress policy without creating a custom
virtual network or granting broad network roles.

### Options considered

- Reuse an existing cluster.
- Create one all-purpose node pool.
- Create a dedicated cluster with separate system and Kata-capable pools.

### Decision

Create `pisa-aks` only in `rg-pi-substrate-aks`, with one small Azure Linux
system node and one Azure Linux `KataVmIsolation` user node. Use Azure CNI
overlay with the Cilium dataplane. Use a system-assigned identity and a
dedicated Basic ACR with admin authentication disabled.

### Rationale

A dedicated cluster preserves the blast-radius boundary. Separate pools expose
runtime placement explicitly while keeping cost bounded. Cilium supplies the
network-policy dataplane needed for actor egress denial. Managed ACR pull avoids
registry credentials in workloads.

### Consequences

The single-node pools are not highly available and are suitable only for this
POC. The public AKS control-plane endpoint remains a trusted operator surface;
actor and relay services must stay ClusterIP-only. Provisioning does not itself
prove Kata isolation or network denial.

### Evidence

- `scripts/aks-provision.sh`
- `experiments/006-aks-provisioning/RESULTS.md`
- `evidence/aks-provisioning/topology.txt`

## D-009: Accept direct AKS Kata and reject nested KVM on this pool

**Status:** accepted

### Context

The sandbox node pool advertises `KataVmIsolation`, but Substrate's microVM
worker expects a usable `/dev/kvm`. Marketing or RuntimeClass labels cannot
establish actual device or isolation behavior.

### Options considered

- Assume nested KVM from the VM SKU and workload runtime.
- Pass broad host devices into the actor.
- Probe restricted direct Kata and a separate temporary KVM diagnostic
  placement.

### Decision

Accept `kata-vm-isolation` as the direct isolated actor fallback after
credential, token, filesystem, kernel, API, IMDS, and egress probes pass. Mark
Substrate KVM microVM placement on this pool blocked: the node path is not a
usable KVM character device, its API version is unavailable, and the
Kata-host-device placement cannot create a sandbox.

### Rationale

Runtime effects are stronger evidence than configuration intent. A separate
guest kernel plus fail-closed identity/network controls meets the direct actor
boundary. Pretending an unusable KVM path satisfies Substrate would produce a
false architecture claim.

### Consequences

Remote Pi work can proceed in direct AKS Kata even if Substrate's KVM backend
remains unavailable. Pinned Substrate gVisor and control-plane compatibility
still require their own tests. Privileged diagnostic resources must remain
separate from actors and be removed after each probe.

### Evidence

- `experiments/007-aks-runtime-matrix/RESULTS.md`
- `evidence/aks-runtime/runtime-probes.txt`

## D-010: Keep model credentials local behind a private relay

**Status:** accepted

### Context

The AKS actor needs model completions and task input, but cannot receive
Copilot/GitHub credentials, a kubeconfig, or a trusted filesystem mount. Direct
port-forward to the Kata guest also fails because kubelet targets pod-netns
loopback rather than the guest-backed pod IP.

### Options considered

- Put Copilot authentication in the actor.
- Publish the local broker or actor through a public service.
- Use a ClusterIP relay, a trusted outbound WebSocket bridge over loopback
  port-forward, and a relay-to-actor job proxy.

### Decision

Keep the authenticated Copilot SDK in a loopback broker on the workstation.
The actor authenticates to the relay with a POC capability. A separately
authenticated bridge receives only actor identity and maps it to a distinct
local broker capability. Job archives enter the same port-forward through a
trusted-client capability; the relay swaps it for a different actor-delivery
bearer. The actor receives only the delivery bearer's SHA-256 verifier.

### Rationale

No GitHub/Copilot/Azure credential crosses the workstation boundary. ClusterIP
services and port-forwarding avoid public exposure. Separate capabilities and
the one-way actor verifier prevent an actor from impersonating the bridge or
trusted job client. The relay path also works around Kata's direct
port-forward limitation without opening actor ingress broadly.

### Consequences

The workstation bridge must remain connected for model access. Disconnect is
an immediate revocation boundary: model work fails and the actor test gate
exports no patch. The relay becomes a narrow POC component that can see task
and model payloads but has no cloud/model credential and tightly restricted
egress. Each actor pod serves one job and exits so untrusted test descendants
cannot persist. Actor state is ephemeral; multi-actor and lifecycle work
remains.

### Evidence

- `packages/model-relay/`
- `packages/remote-actor/`
- `deploy/aks/remote-actor.yaml`
- `experiments/008-remote-actor/RESULTS.md`
- `evidence/remote-actor/remote-smoke.txt`

## D-011: Stop the AKS Substrate install at the certificate API gate

**Status:** accepted

### Context

The pinned Substrate control plane bootstraps workload identity through
Kubernetes `PodCertificateRequest` and `ClusterTrustBundle` APIs. The managed
AKS API server exposes neither resource and removes the corresponding projected
volume fields during server-side decoding. The upstream gVisor worker also
requires node host paths, mount propagation, AppArmor unconfined, and broad
capabilities.

### Options considered

- Apply the upstream bundle until it fails, leaving partial cluster-scoped
  resources.
- Fork the identity plane or inject static signing material.
- Treat a privileged upstream gVisor worker as equivalent to the restricted
  direct Kata actor.
- Stop before mutation, preserve the kind proof, and use direct AKS Kata.

### Decision

Make the required API surface a reproducible preflight gate. Do not install the
control plane when the identity APIs are unavailable. Do not fork around the
gate or weaken the accepted actor boundary.

### Rationale

The missing APIs are a managed-control-plane incompatibility, not an
application rollout bug. A partial install cannot become healthy and creates
unnecessary cluster-wide state. Static identity material would weaken the
security model, while the direct Kata actor already proves the required remote
coding path without cloud/model credentials.

### Consequences

Substrate pause/suspend semantics remain proven only on the pinned kind gVisor
baseline. AKS Substrate control-plane, gVisor, and Substrate-managed lifecycle
rows are blocked until the managed API changes or a separate self-managed
Kubernetes control plane is deliberately evaluated. Direct AKS Kata remains
the accepted remote actor runtime.

### Evidence

- `scripts/probe-substrate-aks.sh`
- `experiments/009-substrate-aks/RESULTS.md`
- `evidence/substrate-aks/preflight.txt`

## D-012: Treat model compliance as irrelevant to containment

**Status:** accepted

### Context

Repository text can instruct the model to ignore policy, read operator data,
modify paths outside the workspace, or run destructive commands. A cooperative
model refusing those instructions would not prove the actor boundary.

### Options considered

- Test only that the system prompt tells the model to ignore repository
  instructions.
- Use a real model and accept probabilistic refusal as evidence.
- Use a deterministic adversarial fake model that deliberately requests every
  prohibited action, then assert the enforcement layer blocks each one.

### Decision

Make prompt-injection acceptance deterministic and adversarial. The model reads
the malicious fixture and requests an outside read, `.git` read, outside write,
and non-allowlisted destructive command. Security passes only when all requests
fail, protected data remains unchanged, and no canary content reaches events or
output. Combine this with live actor probes in `make security`.

### Rationale

The model is inside the untrusted boundary. Testing deliberate policy
violations proves the controls remain effective even when prompt guidance
fails completely.

### Consequences

The fake backend is now a security test instrument as well as a functional test
double. Prompt changes alone cannot satisfy acceptance. Live runtime state must
also continue to pass token, environment-name, path, network, service exposure,
and capability-key checks.

### Evidence

- `tests/security/prompt-injection.test.ts`
- `experiments/010-security-acceptance/RESULTS.md`
- `evidence/security/acceptance.txt`

## D-013: Accept Agent Sandbox only as a dedicated-cluster Kata lifecycle layer

**Status:** accepted

### Context

Pinned Agent Substrate cannot bootstrap its certificate identity plane on the
managed AKS API. The official Agent Sandbox controller supports arbitrary Pod
templates, including the already proven `kata-vm-isolation` RuntimeClass, and
defines an administrative `Suspended` operating mode.

Release `v0.5.6` also installs cluster-wide CRDs, conversion webhooks, and RBAC
that can reconcile Pods, PVCs, Services, extension resources, and
NetworkPolicies across namespaces. It has no namespace-scoped watch flag.

### Options considered

- Reject all controller-based fallback because its RBAC is broader than an
  actor namespace.
- Fork the controller to add namespace-scoped reconciliation.
- Accept the pinned upstream controller only on the dedicated disposable POC
  cluster, harden its pod, and keep actor controls independent.

### Decision

Accept upstream Agent Sandbox `v0.5.6` as the AKS Kata lifecycle layer only on
`pisa-aks`. Verify the release-manifest digest, apply a Restricted Pod Security
overlay to the controller, and run actors without service-account tokens,
credentials, host paths, or egress. Treat `Suspended` as workspace
suspend/resume only: it releases the pod and preserves PVCs but does not restore
process memory or Pi in-memory sessions.

### Rationale

The cluster is POC-only and contains no unrelated tenant workload, so the
controller's required cluster authority has a bounded blast radius. The direct
experiment proved Kata placement, worker release, PVC state continuity, and a
fresh process on resume. Describing the observed semantics narrowly avoids
equating cold workspace restore with Substrate full-state restore.

### Consequences

The Agent Sandbox controller remains trusted infrastructure with Kubernetes API
credentials. Production use would require a separate RBAC/watch-scope design
review. The suspended probe retains a small PVC but no Kata VM. Agent Substrate
full-state lifecycle remains proven only on kind and blocked on AKS.

### Evidence

- `experiments/011-agent-sandbox-aks/RESULTS.md`
- `evidence/agent-sandbox/lifecycle.txt`
- `deploy/agent-sandbox/`
