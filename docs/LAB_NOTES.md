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

