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

