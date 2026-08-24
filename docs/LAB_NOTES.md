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
