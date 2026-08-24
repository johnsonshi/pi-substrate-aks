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
