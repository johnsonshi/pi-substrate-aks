# Evidence index

All files in this directory are sanitized experiment outputs. They contain
versions, digests, booleans, timings, and conclusions, but no credential
values, kubeconfig contents, subscription or tenant identifiers, or full
environment dumps.

| Capability | Result | Evidence |
|---|---|---|
| Pinned Agent Substrate kind health and lifecycle | PASS | `substrate-kind/versions.txt`, `substrate-kind/health.txt`, `substrate-kind/lifecycle.txt` |
| Dedicated AKS/ACR topology | PASS | `aks-provisioning/topology.txt` |
| runc/Kata runtime and KVM matrix | PASS/BLOCKED by placement | `aks-runtime/runtime-probes.txt` |
| First remote Kata Pi actor | PASS | `remote-actor/remote-smoke.txt` |
| Pinned Substrate control plane/worker on AKS | BLOCKED, no mutation | `substrate-aks/preflight.txt` |
| Deterministic and live security acceptance | PASS | `security/acceptance.txt` |
| Agent Sandbox workspace suspend/resume | PASS; process state not preserved | `agent-sandbox/lifecycle.txt` |
| Two concurrent isolated Kata actors | PASS | `multi-actor/remote-concurrency.txt`, `multi-actor/results.json` |

Narrative interpretation, limitations, and exact reproduction steps are in the
matching `experiments/*/RESULTS.md` files and `STATUS.md`.
