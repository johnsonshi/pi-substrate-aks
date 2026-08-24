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
| Local Pi + Copilot CLI auth | PENDING | |
| Copilot credential stays local | PENDING | |
| AKS isolated actor runtime | PENDING | |
| Agent Substrate control plane on AKS | PENDING | |
| Remote Pi actor | PENDING | |
| Two concurrent Pi actors | PENDING | |
| Workspace isolation | PENDING | |
| Substrate suspend/resume | PENDING | |
| Prompt-injection fixture contained | PENDING | |
| Repo private and pushed | IN PROGRESS | Private repository verified; first push pending |

