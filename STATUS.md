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
| Actor Kubernetes API, IMDS, and public egress denial | PASS (policy + probe) | Actor egress allows only relay and DNS; direct Kata probe blocked API, IMDS, and public internet |
| Substrate microVM on AKS sandbox node (runc) | BLOCKED | `/dev/kvm` is not a usable character device; KVM API version `0` |
| Substrate microVM inside AKS Kata | BLOCKED | No guest KVM; host-device placement could not create the Kata sandbox |
| Agent Substrate control plane on AKS | PENDING | |
| Remote Pi actor | PASS | Digest-pinned Kata actor accepted a manifest archive, edited and tested `math.js`, and returned a locally validated patch |
| Two concurrent Pi actors | PENDING | |
| Workspace isolation | PASS | Canonical-path/tool policy plus a private Kata `emptyDir`; no trusted filesystem mount |
| Substrate pause/resume | PASS (local kind) | Stock `onPause: Full` restored memory and DurableDir |
| Substrate suspend/resume | PASS (local kind) | `onCommit: Data` and `onCommit: Full` semantics proven; `evidence/substrate-kind/lifecycle.txt` |
| Prompt-injection fixture contained | PENDING | |
| Local Copilot broker with fake backend | PASS | Four unit/integration cases in `tests/unit/copilot-broker.test.ts` |
| Real Copilot SDK request using local login | PASS | `experiments/001-local-broker/RESULTS.md` |
| Pi SDK actor with fake broker | PASS | `experiments/002-local-pi-actor/RESULTS.md` |
| Real Pi coding task through local Copilot | PASS | Exact `PISA_PI_COPILOT_OK` smoke marker; `experiments/003-local-pi-copilot/RESULTS.md` |
| Full local test and typecheck | PASS | 27 tests passed; `tsc --noEmit` passed after remote hardening |
| Production dependency audit | PASS | Patched `@earendil-works/pi-*` `0.84.2`; `npm audit --omit=dev` reports zero advisories |
| Trusted archive-in / binary patch-out transport | PASS | `experiments/004-source-transport/RESULTS.md`; seven transport integration cases |
| In-cluster relay and trusted local bridge | PASS | Separate model/tunnel/job-client/job-delivery/broker capabilities, ClusterIP-only services, bounded proxying, and disconnect failure |
| Remote patch acceptance gate | PASS | Remote service independently replays and tests the exact final patch; trusted tests run in a no-network container before commit |
| Repo private and pushed | PASS | Bootstrap commit `3e1ef52` pushed; visibility reverified |
