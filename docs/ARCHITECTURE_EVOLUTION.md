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
