# Architecture Evolution

## v0 - Trusted local bootstrap

```text
Trusted macOS workspace
  +-- Git / GitHub CLI
  +-- Azure CLI / kubectl
  +-- authenticated Copilot CLI
  `-- private GitHub repository
```

### Reason for this iteration

Establish durable source control and verify tool availability before adding an
untrusted process or remote workload.

### Security implications

No credentials have been copied, serialized, mounted, or sent to a remote
workload. All authenticated actions remain local.

### Remaining unknowns

- Supported Copilot programmatic interface in the installed CLI.
- Pi custom provider API and exact package version.
- Agent Substrate baseline compatibility with macOS arm64 kind.
- AKS Kata and direct-KVM compatibility with Substrate workers.

## v1 - Local broker with authenticated Copilot SDK

```text
Untrusted local test client
  | ephemeral actor bearer token
  v
Loopback-only Copilot broker
  | typed, bounded request
  v
Official Copilot SDK (tool-free session)
  | logged-in-user resolution
  v
Local Copilot runtime / credential store
```

### Reason for change

The POC needs a model boundary before Pi or remote execution is introduced.

### Components added

- typed protocol package;
- actor-token authorizer retaining only SHA-256 token digests;
- HTTP session/message API;
- fake and real model backends;
- SDK smoke test using the local logged-in user.

### Security implications

The SDK runtime is trusted and local. Actor-facing callers can request model
text but cannot access SDK tools, raw authentication, local files, or backend
error details. The future relay must preserve actor identity rather than sharing
one undifferentiated token.

### Remaining unknowns

- Exact Pi adapter contract and whether Pi can use a custom model object without
  storing credentials.
- Tunnel and relay behavior under disconnect/reconnect.
- Remote actor isolation and runtime lifecycle.
