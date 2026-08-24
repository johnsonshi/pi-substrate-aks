# Status

Last updated: 2026-08-24

## Preflight

| Item | Status | Evidence |
|---|---|---|
| Workspace restricted to `~/repos/pi-substrate-aks` | PASS | Safe preflight |
| GitHub repository is private | PASS | `gh repo view` returned `PRIVATE` |
| GitHub CLI authenticated | PASS | Safe status check; no token value captured |
| GitHub Copilot CLI available | PASS | Version `1.0.81-3` |
| Azure CLI authenticated | PASS | CLI `2.89.1`; account state `Enabled` |
| Kubernetes client available | PASS | `kubectl` `v1.36.1` |
| Docker available | PASS | Client/server `29.7.2` |
| Node/npm available | PASS | Node `v24.19.0`; npm `12.0.2` |
| Go available | PASS | Go `1.26.6` |
| Helm available | PASS | Helm `v4.2.4` |
| kind available | PASS | Upstream-managed kind `v0.32.0`; dedicated `pisa-substrate` cluster |

## Capability matrix

| Capability | Status | Evidence |
|---|---|---|
| Local Pi + Copilot CLI auth | PASS | `experiments/003-local-pi-copilot/RESULTS.md` |
| Copilot credential stays local | PASS | Local and remote actors receive only POC-scoped capabilities; the trusted bridge alone reaches the loopback Copilot broker |
| Pinned Agent Substrate control plane on kind | PASS | Exact SHA and healthy control plane in `experiments/005-substrate-kind/RESULTS.md` |
| Substrate gVisor WorkerPool on kind | PASS | Three of three workers ready; no KVM device exposed |
| Substrate microVM on local kind | BLOCKED | Docker kind node has no `/dev/kvm`; gVisor baseline used |
| Dedicated AKS and ACR provisioning | PASS | `experiments/006-aks-provisioning/RESULTS.md`; idempotent provision and independent verify |
| Azure CNI overlay with Cilium | PASS | `evidence/aks-provisioning/topology.txt` |
| AKS Kata-capable node pool | PASS | Azure Linux `KataVmIsolation` pool, RuntimeClass, and restricted runtime probe ready |
| AKS isolated actor runtime | PASS | Real Pi edit/test task ran in `kata-vm-isolation`; `experiments/008-remote-actor/RESULTS.md` |
| Actor credential and service-account absence on AKS | PASS | Remote actor has no GitHub, Copilot, Azure, kubeconfig, or service-account credential; direct probes corroborate runtime state |
| Actor Kubernetes API, IMDS, node-local, and public egress denial | PASS (policy + probe) | NetworkPolicy allows relay/DNS only; valid Cilium deny covers host, remote-node, and kube-apiserver entities; direct Kata probes were blocked |
| Substrate microVM on AKS sandbox node (runc) | BLOCKED | `/dev/kvm` is not a usable character device; KVM API version `0` |
| Substrate microVM inside AKS Kata | BLOCKED | No guest KVM; host-device placement could not create the Kata sandbox |
| Agent Substrate control plane on AKS | BLOCKED | Managed API omits required PodCertificateRequest and ClusterTrustBundle resources; `experiments/009-substrate-aks/RESULTS.md` |
| Substrate gVisor WorkerPool on AKS | BLOCKED | Control-plane identity cannot bootstrap; upstream worker also requires node host paths, mount propagation, AppArmor unconfined, and broad capabilities |
| OSS Agent Sandbox controller on AKS | PASS | Pinned `v0.5.6` controller runs under Restricted Pod Security; cluster-wide authority accepted only on the dedicated POC cluster |
| OSS Agent Sandbox + AKS Kata | PASS | Controller created and managed a credential-free, deny-all `kata-vm-isolation` Sandbox |
| Remote Pi actor | PASS | Digest-pinned Kata actor accepted a manifest archive, edited and tested `math.js`, and returned a locally validated patch |
| Two concurrent Pi actors | PASS | Relay observed two active jobs with 19.887 s overlap; isolated implementer and reviewer/tester patches were independently accepted and safely merged; `experiments/012-multi-actor/RESULTS.md` |
| Final source-matched harness image | PASS | `pisasubstrate84acr.azurecr.io/pisa-harness@sha256:437eef6199f18fc3b30e4a972e38156315f0cd53e31de5c9607bbc2aa64e48c9` |
| Actor-to-actor network isolation | PASS | Bidirectional actor Service connectivity was blocked while both actors retained relay/DNS access |
| Workspace isolation | PASS | Canonical-path/tool policy plus a private Kata `emptyDir`; no trusted filesystem mount |
| Substrate pause/resume | PASS (local kind) | Stock `onPause: Full` restored memory and DurableDir |
| Substrate suspend/resume | PASS (local kind) | `onCommit: Data` and `onCommit: Full` semantics proven; `evidence/substrate-kind/lifecycle.txt` |
| Remote Agent Sandbox workspace suspend/resume | PASS | `Suspended=True` released the Kata pod; a new pod/process restored the PVC marker |
| Remote process/Pi session resume | NOT PRESERVED | Agent Sandbox resume cold-starts the process; Substrate-managed full-state resume on AKS remains blocked |
| Prompt-injection fixture contained | PASS | Adversarial fake model attempted outside/Git reads, outside write, and destructive command; all failed with no canary disclosure or mutation |
| Consolidated security acceptance | PASS | `make security` ran 18 local identity/containment cases and live two-actor Kata token/path/network/service/policy probes; `experiments/010-security-acceptance/RESULTS.md` |
| Local Copilot broker with fake backend | PASS | Four unit/integration cases in `tests/unit/copilot-broker.test.ts` |
| Real Copilot SDK request using local login | PASS | `experiments/001-local-broker/RESULTS.md` |
| Pi SDK actor with fake broker | PASS | `experiments/002-local-pi-actor/RESULTS.md` |
| Real Pi coding task through local Copilot | PASS | Exact `PISA_PI_COPILOT_OK` smoke marker; `experiments/003-local-pi-copilot/RESULTS.md` |
| Full local test and typecheck | PASS | 30 tests passed; `tsc --noEmit` passed after relay and multi-actor hardening |
| Production dependency audit | PASS | Patched `@earendil-works/pi-*` `0.84.2`; `npm audit --omit=dev` reports zero advisories |
| Trusted archive-in / binary patch-out transport | PASS | `experiments/004-source-transport/RESULTS.md`; seven transport integration cases |
| In-cluster relay and trusted local bridge | PASS | Actor-keyed target allowlist, redirect refusal, per-actor model/job-delivery/broker capabilities, shared tunnel/job-client capabilities, ClusterIP-only services, bounded proxying, and disconnect failure |
| Remote patch acceptance gate | PASS | Remote service independently replays and tests the exact final patch; trusted tests run in a no-network container before commit |
| Repo private and pushed | PASS | Multi-actor milestone `0f0e517` pushed to `main`; visibility reverified as `PRIVATE` |
