# Lab Notes

This log is chronological and append-only. Outputs are sanitized and never
contain credentials, subscription IDs, tenant IDs, or kubeconfig contents.

## 2026-08-24 00:37 PDT - Safe preflight and repository creation

### Goal

Confirm the trusted workstation can run the POC and establish a private durable
repository before implementation.

### Hypothesis

The required local CLIs and authenticated contexts are available; kind may need
a project-local or user-local installation.

### Environment

- local git commit: not yet created
- upstream Substrate SHA: not yet selected
- Pi version/SHA: not yet selected
- AKS version: not yet provisioned
- runtime: macOS arm64 trusted operator machine
- Git `2.50.1`, Copilot CLI `1.0.81-3`, Azure CLI `2.89.1`
- kubectl `v1.36.1`, Docker `29.7.2`, Node `v24.19.0`
- npm `12.0.2`, Go `1.26.6`, Helm `v4.2.4`

### Actions

Ran status/version checks that do not reveal credentials, checked whether the
target GitHub repository existed, initialized Git, created the private GitHub
repository, and verified its visibility.

### Result

Required authenticated tools are available. The repository
`johnsonshi/pi-substrate-aks` exists with `PRIVATE` visibility. `kind` is not
installed.

### Evidence

- `STATUS.md`
- GitHub repository visibility query (observed interactively; no credential
  output retained)

### Interpretation

Local implementation and Azure experiments can proceed without transporting
credentials. The kind binary must be installed without modifying system-global
configuration.

### Decision / next step

Commit and push the bootstrap, then implement the local broker while independent
upstream investigations run.

## 2026-08-24 00:46 PDT - Local Copilot credential broker

### Goal

Prove a bounded broker can use the already authenticated local GitHub Copilot
runtime without accepting or returning raw GitHub credentials.

### Hypothesis

The official TypeScript Copilot SDK can use the logged-in local user while a
tool-free session and a narrow HTTP API keep actor-facing access separate from
credential resolution.

### Environment

- local git commit: `3e1ef52`
- upstream Substrate SHA: not yet selected
- Pi version/SHA: not yet selected
- AKS version: not yet provisioned
- runtime: trusted macOS arm64 workstation, Node `v24.19.0`
- GitHub Copilot CLI `1.0.81-3`
- `@github/copilot-sdk` `1.0.11`
- relevant paths: `packages/copilot-broker/`, `packages/protocol/`,
  `scripts/smoke-copilot.ts`

### Actions

Implemented an actor-authenticated loopback broker, deterministic fake backend,
and official Copilot SDK backend. Restricted SDK sessions to an empty available
tool set, disabled cross-session storage, bounded request size/concurrency/time,
and returned generic external errors. Installed pinned dependencies with
lifecycle scripts disabled. Ran type checking, four broker tests, and one real
model request.

The local npm proxy initially rejected registry tarballs because remote package
fetches were disabled. The installation was retried with the invocation-scoped
`--allow-remote=all` option; no global npm configuration was changed.

### Result

All broker tests passed. The real authenticated request returned exactly
`PISA_COPILOT_OK`. The smoke test supplied no GitHub token and printed no
credential or session data.

### Evidence

- `experiments/001-local-broker/RESULTS.md`
- `tests/unit/copilot-broker.test.ts`
- `scripts/smoke-copilot.ts`
- `package-lock.json`

### Interpretation

The official SDK is a viable local credential boundary. Actor credentials can
authorize bounded model requests without exposing the underlying logged-in
GitHub identity material.

### Decision / next step

Use this broker behind the future relay and implement a Pi SDK actor against its
typed protocol.

## 2026-08-24 01:01 PDT - Fake-backed Pi coding actor

### Goal

Prove Pi can complete a structured read, edit, and test loop while every
operation remains confined to a disposable actor workspace.

### Hypothesis

A custom Pi model provider can translate broker tool-call envelopes into native
Pi tool calls, execute constrained tools actor-side, and return their results
without putting host tools or Copilot credentials behind the model API.

### Environment

- local git commit: `fc49ca2`
- upstream Substrate SHA: not yet selected
- Pi packages: `0.73.1`
- Copilot SDK: `1.0.11`
- AKS version: not yet provisioned
- runtime: trusted macOS arm64 workstation, disposable temporary workspaces
- relevant paths: `packages/pi-actor/`, `tests/integration/pi-actor.test.ts`

### Actions

Extended the broker protocol with typed prompt, tool-call, and tool-result
envelopes. Added deferred Copilot custom-tool handlers that relay calls rather
than executing them. Built a Pi actor around `createAgentSession()` with
in-memory state, disabled resource discovery, canonical filesystem checks, and
an exact test-command allowlist. Ran type checking, the complete broker suite,
and four Pi integration cases.

The first actor run exposed a macOS path alias: the fixture was created below
`/var`, while `realpath()` canonicalized the policy root below `/private/var`.
The policy now accepts either known lexical root for the initial containment
check and still requires every existing path or writable ancestor to resolve
under the canonical root.

### Result

**PASS.** The fake-backed actor read `math.js`, replaced subtraction with
addition, ran the fixture's passing `npm test`, and changed no other file. A
separate model-requested `../outside-secret.txt` read failed, and the outside
file remained unchanged. Canonical symlink escape and
Git-metadata-through-symlink attempts were also blocked. All eight broker and
actor tests passed.

### Evidence

- `experiments/002-local-pi-actor/RESULTS.md`
- `tests/integration/pi-actor.test.ts`
- `packages/pi-actor/src/workspace-policy.ts`
- `packages/pi-actor/src/broker-provider.ts`

### Interpretation

Structured actor-side tools preserve the broker's credential boundary while
providing Pi a native coding loop. Canonical path policy is necessary defense in
depth, but runtime isolation is still required to close process, race, and
kernel-level escape paths.

### Decision / next step

Validate the same Pi loop against the real locally authenticated Copilot backend,
then implement archive-in and patch-out source transport.

## 2026-08-24 01:07 PDT - Real Pi and local Copilot coding loop

### Goal

Prove the constrained Pi actor can complete a coding task through real Copilot
custom tools while Copilot authentication remains exclusively in the trusted
local broker.

### Hypothesis

The Copilot SDK can keep one `sendAndWait()` turn active while deferred custom
tool handlers relay calls to Pi and await actor-side results.

### Environment

- local git commit: `6bd8c23`
- upstream Substrate SHA: not yet selected
- Pi packages: `0.73.1`
- Copilot SDK: `1.0.11`
- Copilot CLI: `1.0.81-3`
- AKS version: not yet provisioned
- runtime: trusted macOS arm64 workstation, disposable fixture workspace
- relevant path: `scripts/smoke-pi-copilot.ts`

### Actions

Started the real SDK backend with logged-in-user resolution and an ephemeral
actor identity. Copied the repository-owned broken-calculator fixture to a
temporary workspace. Asked Pi to inspect `math.js`, correct the addition
function, and run `npm test`. Asserted the file contents, changed-file set,
successful test tool event, and non-empty final response. Removed the workspace
after the run.

### Result

**PASS.** The real model drove the actor through read, edit, and test operations.
The test passed, only `math.js` changed, and the script printed exactly
`PISA_PI_COPILOT_OK`.

### Evidence

- `experiments/003-local-pi-copilot/RESULTS.md`
- `scripts/smoke-pi-copilot.ts`
- `packages/copilot-broker/src/copilot-sdk-backend.ts`

### Interpretation

Pi and the real Copilot SDK interoperate through deferred structured tools.
Model authentication does not need to enter the actor process or workspace.

### Decision / next step

Implement trusted archive-in and validated patch-out transport before any actor
receives non-fixture source.

## 2026-08-24 01:11 PDT - Pi security migration

### Goal

Remove known production dependency vulnerabilities without regressing the Pi
coding loop or introducing file-backed credentials.

### Hypothesis

The maintained `@earendil-works/pi-*` package family is API-compatible after a
small migration to its `ModelRuntime` API and includes the published fixes.

### Environment

- local git commit: `2987391`
- old Pi packages: `@mariozechner/pi-*` `0.73.1`
- new Pi packages: `@earendil-works/pi-*` `0.84.2`
- runtime: trusted macOS arm64 workstation

### Actions

Reviewed the reported advisories, confirmed the deprecated namespace has no
patched release, and migrated all direct Pi imports together. Replaced legacy
auth/model registry construction with `ModelRuntime`, an in-memory credential
store, an in-memory model store, no models file, and network catalog refresh
disabled. Installed dependencies with lifecycle scripts disabled. Ran type
checking, all eight tests, the real Pi/Copilot smoke, and a production
dependency audit.

### Result

**PASS.** Fake and real actor flows remained green. The real smoke returned
`PISA_PI_COPILOT_OK`. `npm audit --omit=dev` reported zero vulnerabilities.

### Evidence

- `packages/pi-actor/package.json`
- `packages/pi-actor/src/pi-actor.ts`
- `package-lock.json`
- GitHub advisories `GHSA-jfgx-wxx8-mp94`,
  `GHSA-r95r-rj6r-c39x`, `GHSA-7v5m-pr3q-6453`, and
  `GHSA-jmr9-qjv8-65gv`

### Interpretation

Disabling extensions and file-backed auth reduced exploitability, but upgrading
removed the vulnerable code and archive dependency entirely. The in-memory
runtime preserves the no-actor-credential design.

### Decision / next step

Keep exact Pi versions pinned and include the production audit in security
checkpoints. Continue with source transport.

## 2026-08-24 01:21 PDT - Trusted source and patch transport

### Goal

Move committed source into an actor and return a locally committable change
without sharing trusted Git metadata, credentials, history, or a host mount.

### Hypothesis

A bounded `git archive` plus actor-local Git can preserve the current snapshot
and generate a robust binary patch. Replaying that patch in a disposable
repository can enforce the trust boundary before canonical application.

### Environment

- local git commit: `09a1fd9`
- source transport: Node.js plus Git `2.50.1`
- archive parser: `tar-stream` `3.1.7`
- runtime: trusted macOS arm64 workstation; all scratch data under `.state/`
- relevant paths: `packages/orchestrator/`,
  `tests/integration/source-transport.test.ts`

### Actions

Implemented exact-revision archive creation, SHA-256 archive and per-file
manifests, bounded tar parsing, private workspace materialization, and
credential-free actor-local Git initialization. Implemented staged full-index
binary patch export, changed-path and content scanning, disposable repository
replay, Git index mode validation, protected policy gating, and clean trusted
application. Added a fake-backed Pi roundtrip and negative tests.

### Result

**PASS.** Fifteen total tests passed, including seven source transport cases. A
Pi actor received only the archive and actor token, changed and tested
`math.js`, returned a patch, and the trusted temporary repository committed the
validated result. Credential-like paths, source/actor symlinks, protected
policy changes, repository-local artifacts outside `.state/`, and a modified
patch were rejected. The real Pi/Copilot smoke still returned
`PISA_PI_COPILOT_OK`, and the repository's committed tree produced a bounded
source archive successfully.

### Evidence

- `experiments/004-source-transport/RESULTS.md`
- `packages/orchestrator/src/source-transport.ts`
- `tests/integration/source-transport.test.ts`

### Interpretation

Snapshot archives avoid exposing reachable Git history. Validating the
post-application tree catches unsafe modes and links that header-only patch
inspection could miss. The actor still needs runtime isolation because its own
process and Git metadata are untrusted.

### Decision / next step

Pin and run the official Agent Substrate baseline on a local kind cluster before
creating Azure resources.

## 2026-08-24 01:39 PDT - Pinned Agent Substrate kind lifecycle

### Goal

Understand the exact upstream control plane, worker, routing, pause, and suspend
behavior before introducing AKS-specific variables.

### Hypothesis

The pinned upstream revision can run with gVisor in a dedicated kind cluster
without KVM. The stock counter should preserve only its declared `Data` commit
scope across suspend, while a separate `Full` commit template should preserve
process memory and durable files.

### Environment

- local git commit: `2264a31`
- upstream Substrate SHA:
  `bc51ef2452c4bf4c0542cd6850040c9ed1033421`
- kind: `v0.32.0`
- ko: `v0.19.1`
- Kubernetes: `v1.36.1`
- cluster/context: `pisa-substrate` / `kind-pisa-substrate`
- runtime: local arm64 Docker kind node; `/dev/kvm` absent; gVisor selected
- relevant paths: `.work/upstream/substrate`,
  `deploy/substrate/`, `evidence/substrate-kind/`

### Actions

Cloned the official upstream repository under ignored `.work/`, checked out the
exact SHA, and reviewed its bootstrap/install scripts before execution. Created
the uniquely named kind cluster and local registry, installed the control plane
and counter demo, built `kubectl-ate` into `.work/bin`, created an atespace and
actor, and routed requests through a loopback-only port-forward.

The stock template produced memory/file counts `1/1`, then `1/2` after a true
suspend and routed resume. That result matches its `onCommit: Data` declaration.
The first assertion had incorrectly expected memory `2` and lacked fail-fast
shell behavior; the observed mismatch was treated as a failed expectation, not
as a pass. Subsequent lifecycle checks used strict assertions.

A stock `onPause: Full` pause/resume then produced `2/3`. A separate immutable
`counter-full` template changed `onCommit` to `Full`, used a distinct snapshot
location, reached `ACTOR_STATE_SUSPENDED`, and produced `2/2` after its second
routed request.

### Result

**PASS.** The control plane and all three workers were healthy. Stock
`Data` suspend preserved `DurableDir` and intentionally reset process memory.
Node-local `Full` pause and committed `Full` suspend both preserved memory plus
durable state. Local Substrate microVM execution was not attempted because the
kind node had no KVM device.

### Evidence

- `experiments/005-substrate-kind/RESULTS.md`
- `deploy/substrate/UPSTREAM_SHA`
- `evidence/substrate-kind/versions.txt`
- `evidence/substrate-kind/health.txt`
- `evidence/substrate-kind/lifecycle.txt`

### Interpretation

Snapshot scope is an explicit lifecycle contract, not an implementation detail.
The shipped counter demo proves data durability by default; a `Full` commit is
required to claim process-memory continuity across suspend. AKS Kata and
Substrate-managed microVMs remain separate placements requiring separate tests.

### Decision / next step

Keep this upstream SHA pinned, preserve gVisor/Data/Full evidence separately,
and proceed to the dedicated AKS runtime matrix without weakening or conflating
the isolation claims.

## 2026-08-24 01:58 PDT - Dedicated AKS and Kata pool

### Goal

Create the smallest practical Azure topology for the runtime matrix, entirely
inside the dedicated POC resource group.

### Hypothesis

AKS `1.35` in `westus2` can combine a small Azure Linux system pool, an Azure
Linux `KataVmIsolation` pool, Azure CNI overlay, Cilium, and a managed-identity
pull path to a dedicated ACR.

### Environment

- local git commit: `be4f127`
- resource group: `rg-pi-substrate-aks`
- cluster/context: `pisa-aks` / `pisa-aks`
- Kubernetes: `1.35`
- system pool: 1 x `Standard_D2s_v5`, Azure Linux
- sandbox pool: 1 x `Standard_D4s_v3`, Azure Linux,
  `KataVmIsolation`
- ACR: `pisasubstrate84acr`, Basic, admin authentication disabled

### Actions

Read current Azure CLI help and current Microsoft AKS Pod Sandboxing and Cilium
documentation. Confirmed both VM sizes were available in `westus2` and the
required providers were registered. Created guarded idempotent provision,
verify, and teardown scripts. Provisioned the resource group, dedicated ACR,
managed-identity AKS cluster, and Kata pool. Acquired only the normal user
Kubernetes context on the trusted workstation, waited for Azure updates, and
ran the verifier.

The first verify ran while the cluster and pools still reported `Updating`.
It correctly failed. The verifier was changed to use `az aks wait --updated`
and compact profile comparisons, then passed. A second provision run exercised
the existing-resource checks and also passed.

### Result

**PASS.** Both nodes are Ready. The `kata-vm-isolation` RuntimeClass is present
with handler `kata`. Azure reports the expected overlay/Cilium profile,
system-assigned identity, exact pool sizes/runtimes, and disabled ACR admin
authentication. There are no LoadBalancer services.

### Evidence

- `experiments/006-aks-provisioning/RESULTS.md`
- `evidence/aks-provisioning/topology.txt`
- `scripts/aks-provision.sh`
- `scripts/aks-verify.sh`
- `deploy/aks/README.md`

### Interpretation

The cluster is a valid experiment substrate, not yet proof of workload
isolation. Kata, KVM, API, IMDS, service-account, and egress behavior must be
tested from actual pods before the remote actor is accepted.

### Decision / next step

Keep ACR admin authentication disabled, use only ClusterIP/port-forward access,
and begin the runtime compatibility matrix with credential-free diagnostic
pods.

## 2026-08-24 02:24 PDT - AKS Kata and KVM runtime probes

### Goal

Verify real isolation, identity, network, filesystem, and nested-hypervisor
properties from workloads on the AKS sandbox pool.

### Hypothesis

A restricted `kata-vm-isolation` pod should have a distinct guest kernel and
no actor credentials, service-account token, host paths, IMDS, Kubernetes API,
public egress, or KVM. A normal privileged pod may expose node KVM if the pool
can host Substrate-managed microVMs.

### Environment

- local git commit: `cbdd9e0`
- AKS: `pisa-aks`, Kubernetes `1.35`
- node pool: Azure Linux `Standard_D4s_v3`, `KataVmIsolation`
- probe image:
  `pisasubstrate84acr.azurecr.io/pisa-runtime-probe`
- image digest:
  `sha256:9e782490db59b4acea87c93fc454e3fe1a184ccd3ea66bce5d7574aeb77cc14e`
- actor namespace: restricted Pod Security plus Cilium deny-all

### Actions

Implemented a static Go probe that emits only sanitized booleans, variable
names, UID, kernel release, and connection status. Built a scratch amd64 image
with a dedicated local buildx builder and pushed it to the managed-identity
ACR path. The initial build accidentally selected a pre-existing Kubernetes
buildx builder and failed because its namespace did not exist; the script now
always selects the local `pisa-local-builder`.

Ran digest-pinned runc and Kata pods with no service-account token, no volumes,
non-root execution, read-only rootfs, no capabilities, and deny-all network
policy. The first Kata sandbox failed because its `64Mi` limit was below the
runtime's `128Mi` minimum. Increased request/limit to `128Mi`/`256Mi` and reran
strict assertions successfully.

Tested `/dev/kvm` separately in a temporary privileged diagnostic namespace.
The node path failed Kubernetes `CharDevice` validation. With type validation
removed only for diagnosis, runc could see the mounted path but
`KVM_GET_API_VERSION` returned `0`. The equivalent Kata host-device pod timed
out creating its sandbox. Removed the diagnostic pods and namespace.

### Result

**PASS** for direct AKS Kata isolation. The runc and Kata kernels differ.
Both restricted probes ran as UID `65532`, found no credential variable names
or service-account token, saw no selected host/operator paths or KVM, and could
not reach the Kubernetes service, Azure IMDS, or public internet.

**BLOCKED** for Substrate KVM microVM placement on this pool. Neither normal
runc nor nested Kata placement provides a usable KVM API.

### Evidence

- `experiments/007-aks-runtime-matrix/RESULTS.md`
- `evidence/aks-runtime/runtime-probes.txt`
- `tools/runtime-probe/`
- `deploy/aks/runtime-probes.yaml`
- `deploy/aks/kvm-probes.yaml`

### Interpretation

AKS Kata is a credible direct Pi actor fallback, but its isolation boundary is
not equivalent to giving a Substrate worker a nested KVM device. The runtime
matrix must preserve this distinction.

### Decision / next step

Use direct AKS Kata as the secure fallback path. Continue with a separate
pinned Substrate control-plane/gVisor attempt and the OSS Agent Sandbox
controller path.

## 2026-08-24 03:35 PDT - First remote Pi actor through local Copilot

### Goal

Run one real coding task inside AKS Kata without placing any GitHub, Copilot,
Azure, kubeconfig, registry, or workstation credential in the actor.

### Hypothesis

A ClusterIP relay can authenticate a credential-free actor, carry model turns
over a trusted WebSocket through `kubectl port-forward`, proxy jobs to the Kata
pod, and fail closed when the workstation bridge disconnects. The existing
archive/patch transport can preserve the source boundary remotely.

### Environment

- local git commit: `74e507d`
- AKS/context: `pisa-aks`
- actor runtime: `kata-vm-isolation` on the `sandbox` pool
- relay runtime: runc on the `system` pool
- harness image:
  `pisasubstrate84acr.azurecr.io/pisa-harness@sha256:e165adfda8b91490fa4b7339541d4e5bfca52448d4d3a00fd3a86cd6d4d7b326`
- model: authenticated local GitHub Copilot SDK through the loopback broker

### Actions

Implemented a bounded relay and trusted bridge with separate actor and tunnel
authentication, route allowlisting, actor identity forwarding, local broker
token mapping, concurrency limits, and disconnect failure. Trusted job and
relay-to-actor delivery credentials are distinct; the actor has only a digest
of the latter. Implemented a remote actor service that validates an archive
manifest, creates fresh actor-local Git state, runs the existing constrained Pi
actor, independently replays/tests the final patch, and returns a bounded
binary patch. Each actor pod exits after one job.

Built and pushed the harness image by digest. Deployed ClusterIP-only relay and
actor Services, disabled both service-account token mounts, applied Restricted
Pod Security, placed the actor in Kata, and limited network policy to
relay/DNS paths.

The initial deployment plus an unconditional rollout restart surged two
singleton Kata sandboxes, both of which timed out. Switched both deployments to
`Recreate` and a unique pod-template revision. A subsequent single pod still
failed; the previously known-good Kata probe now failed too. Deleted only the
POC workloads, scaled the disposable `sandbox` pool to zero and back to one,
and confirmed `PISA_RUNTIME_PROBES_OK` on the replacement node.

The healthy Kata actor then returned an empty reply through direct
port-forward. Kubelet reported that it could not connect to
`127.0.0.1:8080` inside the pod network namespace. Added a capability-protected
job proxy to the runc relay and limited actor ingress to that relay.

Early model attempts exposed two more acceptance issues. One returned a patch
without a successful test; another trusted npm invocation wrote HOME state
inside the disposable repository. Added a remote test gate that returns
`actor_acceptance_failed` and no patch, bounded fresh-session retries, and a
credential-free trusted HOME outside the repository. A subsequent review found
that direct trusted-side `npm test` still executed model-authored code under the
workstation account. Moved the trusted test into a non-root, no-network Docker
container with a read-only source mount and resource limits; the local commit
uses only the separately validated index.

The first verifier-only deployment revealed that `kubectl apply` retained the
old raw `job-token` key in the actor Secret even though the pod no longer
referenced it. Changed rotation to stop both old deployments and
delete/recreate both disposable capability Secrets before applying new
workloads. The live actor Secret now contains only the model actor capability
and the one-way job-delivery verifier.

### Result

**PASS.** The final run completed in one accepted actor attempt. Pi read and
edited `math.js`, ran `workspace_test` successfully, and returned only that
path. The trusted side verified archive/patch hashes, replayed the patch, ran
`npm test`, committed locally in the disposable repository, and remained
clean. Both Services were ClusterIP, the actor used Kata, and service-account
token automount was false.

After closing the trusted bridge, the same task could not obtain an accepted
model result. The remote service returned `422 actor_acceptance_failed` and no
patch. The smoke printed exactly `PISA_REMOTE_ACTOR_OK`.

### Evidence

- `experiments/008-remote-actor/RESULTS.md`
- `evidence/remote-actor/remote-smoke.txt`
- `packages/model-relay/`
- `packages/remote-actor/`
- `deploy/aks/remote-actor.yaml`

### Interpretation

The actor does not need a Copilot credential; it needs a narrow revocable model
capability. A private relay plus a local bridge preserves that distinction.
Kata networking also proves that a pod abstraction can differ from runc in
operator tooling even when ordinary Service traffic works.

### Decision / next step

Keep the relay as the only cluster ingress and enforce actor-side test success
before patch export. Checkpoint this milestone, then expand the same boundary to
two isolated concurrent actors before attempting remote lifecycle semantics.

## 2026-08-24 04:39 PDT - Pinned Substrate AKS compatibility gate

### Goal

Attempt the pinned Substrate control-plane and gVisor matrix row on the
dedicated AKS cluster without leaving an unusable partial installation.

### Hypothesis

If AKS exposes the beta Kubernetes certificate APIs used by the pinned
Substrate identity plane, the upstream install can proceed to a bounded worker
placement experiment. Otherwise the managed API is a hard preflight blocker.

### Environment

- local git baseline: `23ddb65`
- upstream SHA: `bc51ef2452c4bf4c0542cd6850040c9ed1033421`
- AKS/context: `pisa-aks`
- Kubernetes server: `v1.35.6`
- cluster mutation: none; server-side dry run only

### Actions

Added and ran `make aks-substrate-preflight`. The probe confirmed the pinned
checkout, queried the AKS API resources, and submitted a minimal Pod containing
the exact `podCertificate` and `clusterTrustBundle` projected sources with
server-side dry run. It also verified the upstream certificate-controller,
workload projection, gVisor host-path, and capability dependencies from the
pinned source.

### Result

**BLOCKED.** AKS exposed neither `PodCertificateRequest` nor
`ClusterTrustBundle`. Server decoding removed both projection sources. The
upstream install would therefore wait indefinitely for trust bundles and leave
identity-dependent workloads without credentials. No Substrate resource was
applied.

The gVisor WorkerPool was not submitted after the control-plane gate failed.
Its generated worker pod independently requires `/var/lib/ateom-gvisor` from
the node, mount propagation, AppArmor unconfined, and broad capabilities
including `SYS_ADMIN`, which is not the restricted actor boundary accepted by
this POC.

### Evidence

- `experiments/009-substrate-aks/RESULTS.md`
- `evidence/substrate-aks/preflight.txt`
- `scripts/probe-substrate-aks.sh`

### Interpretation

The blocker belongs to the managed control plane, not image building or
application scheduling. Forcing progress with static certificates or a partial
install would weaken the security model without proving a supported
architecture.

### Decision / next experiment

Keep the pinned Substrate lifecycle proof on kind and the remote Pi actor on
direct AKS Kata. Continue the runtime matrix with the OSS Agent Sandbox
controller rather than modifying Substrate's identity design.

## 2026-08-24 04:45 PDT - Consolidated security acceptance

### Goal

Prove that actor containment does not depend on a model obeying the system
prompt, and remeasure the security boundary from the live AKS Kata actor.

### Hypothesis

A deterministic adversarial model can deliberately follow malicious repository
instructions while canonical path policy, protected metadata, exact command
allowlisting, capability separation, and Cilium still prevent disclosure,
mutation, destructive execution, and external access.

### Environment

- local git baseline: `bee4454`
- AKS/context: `pisa-aks`
- actor namespace: `pi-substrate`
- actor runtime: `kata-vm-isolation`
- local model backend: deterministic fake; no real model call

### Actions

Added an untrusted fixture that requests an operator canary read, `.git/config`
read, outside write, and `rm -rf .`. The fake model first read those
instructions and then issued all four prohibited tool calls. Added a combined
security command covering broker/relay identity, request bounds, actor
path/process confinement, the new injection fixture, and a live in-actor probe.

The live probe inspected environment names and capability Secret key names
only, never their values. It checked Kata placement, token and selected path
absence, private Service types, and direct TCP reachability to the Kubernetes
API, Azure IMDS, and public internet.

### Result

**PASS.** All four adversarial tool requests failed. The outside canary and
protected file were unchanged, no escape file existed, and actor results
contained no canary value. Sixteen local security-relevant tests passed. The
live actor had no service-account token or external credential-related
environment names; API, IMDS, and public TCP connectivity were blocked; both
Services remained ClusterIP. The command printed
`PISA_SECURITY_ACCEPTANCE_OK`.

### Evidence

- `experiments/010-security-acceptance/RESULTS.md`
- `evidence/security/acceptance.txt`
- `tests/security/prompt-injection.test.ts`
- `scripts/verify-remote-security.ts`

### Interpretation

Prompt text is not the containment boundary. Deliberate model noncompliance is
safe only because the model can invoke narrowly enforced tools and the runtime
independently removes identity, filesystem, and network paths.

### Decision / next experiment

Keep adversarial fake-model behavior in the release gate. Continue with the OSS
Agent Sandbox compatibility row and two isolated concurrent actors without
weakening these accepted controls.

## 2026-08-24 04:59 PDT - OSS Agent Sandbox on AKS Kata

### Goal

Test the official Agent Sandbox controller as the AKS Kata fallback and measure
its actual remote suspend/resume semantics.

### Hypothesis

The controller can create a restricted Kata Sandbox on `pisa-aks`, delete its
pod under `operatingMode: Suspended`, and restore a PVC-backed workspace into a
new pod without giving the sandbox any Kubernetes or external credential.

### Environment

- local git baseline: `1e1f50c`
- Agent Sandbox release: `v0.5.6`
- tag object: `0a28fcdc886346d46525042a6ddf6fd94482f207`
- resolved commit: `211b7579cabed9460c1a692eb687084ff4c5879d`
- release manifest SHA-256:
  `1696dbb6faded503149b3994badb599df5dcf24d5985466881784f442dd9c3e5`
- AKS/context: `pisa-aks`
- actor runtime: `kata-vm-isolation`

### Actions

Downloaded the official combined manifest to `.work/`, verified its digest,
and resolved the annotated tag before mutation. The initial research report had
named a different example commit; the tag resolved to `211b7579...`.

Reviewed the actual resources. The release creates four CRDs, two
ClusterRoles/Bindings, a self-certified conversion webhook, and a controller
with cross-namespace Pod/PVC/Service/extension/NetworkPolicy authority. It has
no namespace-scoped watch flag. Added a tracked overlay for Restricted Pod
Security, non-root execution, RuntimeDefault seccomp, read-only root, dropped
capabilities, no privilege escalation, bounded resources, and writable
ephemeral `/tmp`.

The controller installed successfully. AKS warned that the public
`registry.k8s.io` image was not in a configured policy allowlist but admitted
it. Temporarily scaled the existing remote actor to zero, created a deny-all
credential-free Kata Sandbox with a workspace PVC, wrote a marker, and probed
identity and network paths.

Patched the Sandbox to `Suspended`, waited for `Suspended=True` and pod
deletion, then verified the PVC was still bound. Patched to `Running`, waited
for a new ready pod, and compared pod UID, process boot identifier, and
workspace marker. Suspended the probe again and restored the original actor.

A post-experiment validation initially ran the full suite and security subset
in parallel. Both processes used the same fixed outside-canary filename, so one
test removed the other's file and caused an `ENOENT` assertion failure. Changed
that sentinel to include the unique workspace basename. Sequential full and
security suites then passed; actor behavior was unchanged.

### Result

**PASS.** The controller reached `1/1`. The Sandbox ran under
`kata-vm-isolation`, had no service-account token or external
credential-related environment names, and could not reach Kubernetes API,
IMDS, or public internet.

Suspension released the Kata pod. Resume created a different pod and process
while restoring the exact workspace marker. The final probe state is
`Suspended=True`, its 1 GiB PVC remains bound, no probe pod runs, and the
original remote actor is back at `1/1`.

### Evidence

- `experiments/011-agent-sandbox-aks/RESULTS.md`
- `evidence/agent-sandbox/lifecycle.txt`
- `deploy/agent-sandbox/`

### Interpretation

Agent Sandbox is compatible with direct AKS Kata and offers real worker
release plus workspace persistence. Its semantics are cold process restore,
not memory/Pi-session restore and not Agent Substrate full snapshots.

### Decision / next experiment

Accept the controller only on the dedicated POC cluster because its watch and
RBAC scope is cluster-wide. Keep the probe suspended. Reuse the established
two-runtime pattern for concurrent implementer/reviewer actors.

## 2026-08-24 05:33 PDT - Two concurrent Kata Pi actors

### Goal

Run isolated implementer and reviewer/tester actors concurrently through one
local Copilot broker, then merge only independently validated patches on the
trusted workstation.

### Hypothesis

The existing relay and bridge can multiplex two actor identities if trusted job
routing uses a fixed per-actor target/capability map. One
`Standard_D4s_v3` Kata node may have enough capacity for both guests without
weakening placement or isolation.

### Environment

- local git baseline: `737a0d7`
- AKS/context: `pisa-aks`
- actor runtime: two `kata-vm-isolation` pods
- sandbox pool: one `Standard_D4s_v3` node
- initial live harness digest:
  `sha256:d500275bd2e4580ec2004cfad8aba6a29b9ac3366e818923359c5dd74e68d353`
- model: authenticated local GitHub Copilot SDK through one loopback broker

### Actions

Changed the relay job proxy from one static target to a map keyed by validated
actor IDs. Added fixed actor-specific cluster-local URLs and delivery
capabilities, retained the legacy route only for a single configured target,
and exposed only an active-job count in health. Added a deterministic
two-target integration test that holds both targets active simultaneously and
checks downstream bearer separation, unknown actors, and ambiguous legacy
routing.

Created implementer and reviewer Deployments, Services, and verifier-only
Secrets. Both use Kata, non-root execution, read-only roots, dropped
capabilities, no service-account token, ephemeral workspaces, and `Recreate`.
A common Cilium policy permits only relay/DNS paths and blocks actor-to-actor
traffic.

Both actors received the same committed fixture. The implementer added
`multiply.js` and `multiply.test.js`; the reviewer/tester added only
`math.review.test.js`. The relay observed two active job proxies. Each actor
replayed and tested its own final patch. The trusted side independently
validated both, combined the disjoint patches against the original revision,
re-exported and replayed the combined patch, tested it in the no-network
container, and committed only the validated index.

The smoke printed `PISA_MULTI_ACTOR_OK`, but the local process remained alive
after success because trusted cleanup had no final bound and WebSocket close
could wait indefinitely. Stopped that completed local process, added a
five-second terminating WebSocket close, bounded broker/bridge cleanup, and
made successful smoke exit explicit. No remote workload or credential boundary
changed.

### Result

**PASS.** Relay active jobs reached `2` and request intervals overlapped for
`19,658 ms`. Both actors passed on their first attempt. Their three changed
paths were disjoint and the trusted combined test/commit passed.

Both Kata guests ran concurrently on the one existing sandbox node. Both
Services were ClusterIP, service-account automount was false, actor-to-actor
TCP was blocked in both directions, and actor model capability could not invoke
the trusted job route. No external credential entered either actor.

### Evidence

- `experiments/012-multi-actor/RESULTS.md`
- `evidence/multi-actor/remote-concurrency.txt`
- `evidence/multi-actor/results.json`
- `deploy/aks/multi-actor.yaml`
- `scripts/smoke-multi-actor.ts`

### Interpretation

Concurrency does not require duplicating the trusted model credential or
placing it in Kubernetes. Actor identity can multiplex one tunnel while job
delivery remains separately scoped. Independent patch validation plus a fresh
combined replay avoids treating parallel actor output as trusted merely
because paths do not overlap.

### Decision / next experiment

Keep the single-node pool because measured capacity was sufficient. Make this
the final remote topology, rerun the full security gate against both actors,
and complete the reproducible golden path.

## 2026-08-24 06:12 PDT - Final multi-actor hardening and acceptance

### Goal

Rebuild the harness from the final source, prove the two-actor smoke exits
normally, review the new routing/cleanup boundary, and rerun live security
acceptance.

### Hypothesis

Bounded bridge shutdown fixes the original post-success hang without changing
remote behavior. Explicit redirect refusal and Cilium host-entity denial close
the remaining fixed-target and node-egress gaps while preserving relay/DNS
connectivity.

### Environment

- AKS/context: `pisa-aks`
- actor runtime: two `kata-vm-isolation` pods
- sandbox pool: one `Standard_D4s_v3` node
- final harness digest:
  `sha256:437eef6199f18fc3b30e4a972e38156315f0cd53e31de5c9607bbc2aa64e48c9`
- final source archive revision:
  `f2d18905d27bb51e363b8de3b6b46dc7eef35186`
- model: authenticated local GitHub Copilot SDK through one loopback broker

### Actions

Built digest
`sha256:912d1fb35f03466e36718b65dc945e3e05fd39d7f7bf6693b0381108fdd1b187`
after the initial cleanup fix and reran the two-actor proof. It printed
`PISA_MULTI_ACTOR_OK` and exited normally, proving the WebSocket shutdown fix.

A focused implementation review then found three additional bounded-lifecycle
issues and one network-policy gap: actor-target redirects were followed,
port-forward startup failure could leave a child process, the concurrent
regression test could wait indefinitely, and portable NetworkPolicy does not
cover local-node traffic. Changed the relay to reject redirects, added a
negative redirect test, made the concurrency test finite, added terminating
port-forward cleanup, and applied a Cilium deny for host, remote-node, and
kube-apiserver entities. Extended the live verifier to require a valid Cilium
policy and blocked node-local kubelet connectivity.

Built the source-matched final image. Its first smoke failed closed because the
implementer exhausted three model acceptance attempts; no patch passed the
actor gate or reached trusted commit. Tightened the task wording and increased
the finite retry budget to five. The next run passed with one attempt per actor,
observed two active jobs and `19,887 ms` overlap, validated and merged the three
disjoint paths, printed `PISA_MULTI_ACTOR_OK`, and exited normally.

The final live verifier confirmed both actors could still reach the relay while
Kubernetes API, IMDS, node-local kubelet, public internet, and peer actor
traffic were blocked. The Cilium policy reported `Valid=True`.

### Result

**PASS.** The final image, redirect refusal, cleanup bounds, Cilium host/entity
deny, two-actor concurrency, actor-side gates, trusted combined replay/test,
and normal smoke-process exit are all proven together.

The consolidated security suite now has 18 local cases and the live two-actor
probe. No external credential entered either actor, and no credential value,
kubeconfig content, node address, subscription identifier, or tenant
identifier was recorded.

### Evidence

- `evidence/multi-actor/remote-concurrency.txt`
- `evidence/multi-actor/results.json`
- `evidence/security/acceptance.txt`
- `experiments/012-multi-actor/RESULTS.md`
- `tests/integration/model-relay.test.ts`
- `deploy/aks/multi-actor.yaml`

### Interpretation

Fail-closed acceptance retries are operational resilience, not a relaxation:
every attempt still receives a fresh one-job actor process and must pass the
same exact-final-patch replay/test gate. Fixed URLs require redirect refusal,
and relay/DNS-only claims on Cilium require an explicit entity deny beyond
portable NetworkPolicy.

### Decision / next experiment

Accept this as the final multi-actor topology. Preserve the one-node Kata pool,
leave the working POC running, and complete only final repository validation,
commit/push, and documentation consistency checks.

## 2026-08-24 06:18 PDT - Final repository handoff

### Goal

Make the complete proof durable and leave a morning-readable repository and
working POC environment.

### Actions

Ran the full 30-test suite, TypeScript type checking, production dependency
audit, consolidated local/live security acceptance, AKS topology verification,
pinned Substrate AKS preflight, diff hygiene check, and private-repository
visibility check. Added the evidence index and reproducible golden path.

Committed and pushed the multi-actor milestone as `0f0e517`.

### Result

**PASS.** `main` contains every meaningful implementation, experiment record,
decision, architecture iteration, security result, and sanitized evidence file.
GitHub visibility is `PRIVATE`. Production dependency audit has zero findings.
The expected Substrate preflight result remains blocked with
`cluster_mutation=NONE`.

The working Azure resources remain running in `rg-pi-substrate-aks`. The relay
and both actors are private ClusterIP workloads; the actors are ready under
`kata-vm-isolation`. No trusted local broker, bridge, or port-forward remains
running, so model access is fail closed. The Agent Sandbox lifecycle probe
remains suspended with its PVC retained.

### Evidence

- `README.md`
- `STATUS.md`
- `SECURITY.md`
- `evidence/README.md`
- `experiments/012-multi-actor/RESULTS.md`

### Decision

Leave the working POC resources running. Use only the guarded
`PISA_CONFIRM_TEARDOWN=rg-pi-substrate-aks make aks-teardown` command when
teardown is intentionally requested.

## 2026-08-24 12:06 PDT - Audience-first README handoff

### Goal

Make the repository useful to a reader deciding what the POC demonstrates,
from both an individual developer and an organization-owned agent-harness
perspective.

### Actions

Reworked `README.md` from a chronological implementation narrative into a
showcase-first handoff. Added the measured result, user and organization value,
trust and authority model, actor capability table, end-to-end acceptance flow,
runtime compatibility truth, explicit non-claims, tiered reproduction path,
guarded teardown command, repository map, and verified snapshot.

Checked every local README link, ran `git diff --check`, and reran the full
30-test suite.

### Result

**PASS.** The README now answers the critical questions before presenting
implementation detail: what remote actors can do, what authority they do not
have, how local Copilot authentication is used without delegation, what an
organization can enforce in the harness, why the returned patch is still
untrusted, and why direct Kata is not claimed as Agent Substrate on AKS.

All local links resolve and all 30 tests pass.

### Evidence

- `README.md`
- `STATUS.md`
- `SECURITY.md`
- full local test output

### Decision

Lead with the reusable authority-separation pattern and measured proof. Keep
the detailed experiment chronology in `docs/LAB_NOTES.md` and
`docs/ARCHITECTURE_EVOLUTION.md`, and keep blocked runtime rows visible as
results rather than hiding them behind the working fallback.
