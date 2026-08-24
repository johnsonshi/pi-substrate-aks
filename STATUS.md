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
| kind available | BLOCKED | Not installed at preflight; use project/user-local install |

## Capability matrix

| Capability | Status | Evidence |
|---|---|---|
| Local Pi + Copilot CLI auth | PASS | `experiments/003-local-pi-copilot/RESULTS.md` |
| Copilot credential stays local | PASS | Actor receives only an actor-scoped broker token; `experiments/001-local-broker/RESULTS.md` |
| AKS isolated actor runtime | PENDING | |
| Agent Substrate control plane on AKS | PENDING | |
| Remote Pi actor | PENDING | |
| Two concurrent Pi actors | PENDING | |
| Workspace isolation | PASS (local policy) | Canonical-path and escape tests in `tests/integration/pi-actor.test.ts`; runtime isolation remains pending |
| Substrate suspend/resume | PENDING | |
| Prompt-injection fixture contained | PENDING | |
| Local Copilot broker with fake backend | PASS | Four unit/integration cases in `tests/unit/copilot-broker.test.ts` |
| Real Copilot SDK request using local login | PASS | `experiments/001-local-broker/RESULTS.md` |
| Pi SDK actor with fake broker | PASS | `experiments/002-local-pi-actor/RESULTS.md` |
| Real Pi coding task through local Copilot | PASS | Exact `PISA_PI_COPILOT_OK` smoke marker; `experiments/003-local-pi-copilot/RESULTS.md` |
| Production dependency audit | PASS | Patched `@earendil-works/pi-*` `0.84.2`; `npm audit --omit=dev` reports zero advisories |
| Trusted archive-in / binary patch-out transport | PASS | `experiments/004-source-transport/RESULTS.md`; seven transport integration cases |
| Repo private and pushed | PASS | Bootstrap commit `3e1ef52` pushed; visibility reverified |
