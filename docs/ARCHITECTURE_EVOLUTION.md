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

## v2 - Local Pi actor with actor-side tool execution

```text
Pi createAgentSession()
  | actor-scoped token + structured turn
  v
Loopback broker
  | explicit custom-tool declarations
  v
Model backend
  | structured tool call
  v
Pi constrained tool registry
  | canonical workspace operation / allowlisted test
  `-- structured result resumes the same model turn
```

### Reason for change

A coding actor needs structured read, edit, write, and test calls. Plain model
text cannot safely or reliably drive Pi tools.

### Components added

- custom Pi model provider backed by the broker protocol;
- in-memory Pi session with resource discovery disabled;
- canonical workspace policy with `.git` and traversal denial;
- exact test-command allowlist using direct process spawning;
- deterministic coding-loop and path-escape integration tests.

### Security implications

Copilot SDK handlers only relay structured calls and wait. They do not execute
actor tools on the trusted host. The actor token is not a GitHub credential, and
Pi cannot discover repository instructions, host tools, or arbitrary commands.
The local path policy is defense in depth, not a replacement for the pending
container/Kata runtime boundary.

### Remaining unknowns

- Archive-in and patch-out validation for untrusted source transport.
- Remote process, network, and kernel isolation.

## v3 - Real local Pi-to-Copilot coding loop

```text
Disposable fixture workspace
  ^ constrained Pi tools
  |
Pi actor --actor token--> loopback broker
                            |
                            v
                     Copilot SDK custom tools
                            |
                            v
                  authenticated local Copilot CLI
```

### Reason for change

The deterministic backend proved protocol mechanics but not compatibility with
real Copilot custom-tool events and deferred handler continuation.

### Result

The real model requested actor tools, Pi fixed the broken addition function,
`npm test` passed, and only `math.js` changed. The smoke client and actor supplied
no GitHub/Copilot credential.

### Security implications

Authentication resolution remains inside the trusted broker process. The actor
knows only its ephemeral broker token, and SDK tool handlers still execute no
filesystem or shell operation locally.

### Remaining unknowns

- Validated archive-in and patch-out source transport.
- Relay behavior across a private tunnel and disconnect.
- Remote process, network, and kernel isolation.

## v4 - Snapshot-in and validated patch-out

```text
Trusted clean Git repository
  | git archive of exact commit + SHA-256 manifest
  v
New private actor workspace
  | actor-local credential-free Git baseline
  v
Pi read / edit / test
  | full-index binary patch + changed-path manifest
  v
Disposable trusted validation repository
  | path, mode, file, credential, and policy checks
  v
Trusted repository staging --> local review / commit / push
```

### Reason for change

The actor must edit real source without receiving the trusted repository,
history, credentials, or host filesystem.

### Security implications

The snapshot contains only committed regular files from one revision. Integrity
metadata detects transport mutation. The returned patch is untrusted until it
replays cleanly in a disposable repository and passes final-tree checks.
Protected policy changes fail closed unless the trusted caller explicitly
allows them.

### Result

A fake-backed Pi actor received an archive, fixed and tested the fixture,
returned one binary patch, and the trusted side validated, staged, and committed
only `math.js`. Negative cases rejected credential paths, source and actor
symlinks, protected policy changes, and post-export patch tampering.

### Remaining unknowns

- Relay and artifact transport across the AKS boundary.
- Remote process, network, and kernel isolation.

## v5 - Pinned local Substrate actor lifecycle

```text
Trusted workstation
  | kubectl on explicit kind-pisa-substrate context
  | loopback port-forward only
  v
Dedicated kind node (arm64 Docker VM, no /dev/kvm)
  +-- Agent Substrate control plane
  +-- Valkey + RustFS snapshot storage
  +-- atenet router
  `-- three-worker gVisor pool
        |
        +-- counter actor: onPause Full / onCommit Data
        `-- counter-full actor: onPause Full / onCommit Full
```

### Reason for change

AKS should not become the first place where upstream control-plane and lifecycle
semantics are understood. The local baseline isolates Substrate behavior from
Azure node, networking, and managed-control-plane variables.

### Lifecycle result

```text
Pause + Full
  node-local snapshot -> worker released -> memory and DurableDir restored

Suspend + Data
  object snapshot -> worker released -> DurableDir restored, process cold-boots

Suspend + Full
  object snapshot -> worker released -> memory and DurableDir restored
```

### Security implications

The router was reachable only through a loopback port-forward. No actor or
broker service was published. The actors received no GitHub, Copilot, Azure,
kubeconfig, or workstation credential. gVisor is useful local isolation
evidence but is not accepted as a substitute for the pending AKS sandbox
boundary.

### Remaining unknowns

- Whether the pinned control plane installs on managed AKS with its required
  certificate integration.
- Which standard nested-virtualization AKS placement can safely expose KVM to a
  Substrate worker.
- Whether AKS Kata can host the direct Pi actor fallback while enforcing
  service-account, IMDS, Kubernetes API, and egress denial.
