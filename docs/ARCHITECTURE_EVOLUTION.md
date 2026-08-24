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

## v6 - Dedicated AKS experiment substrate

```text
rg-pi-substrate-aks
  +-- ACR: pisasubstrate84acr
  |     `-- Basic, admin auth disabled
  `-- AKS: pisa-aks
        +-- Azure CNI overlay + Cilium
        +-- system pool
        |     `-- 1 x Standard_D2s_v5 / Azure Linux
        `-- sandbox pool
              `-- 1 x Standard_D4s_v3 / Azure Linux
                  + KataVmIsolation

Trusted workstation
  `-- user kubectl context -> AKS API

Actor/broker network surfaces
  `-- none deployed; LoadBalancer service count = 0
```

### Reason for change

The upstream lifecycle is understood locally. A dedicated Azure substrate is
now required to separate managed-control-plane, node, Kata, and networking
compatibility from actor application behavior.

### Security implications

The AKS managed identity can pull only from the dedicated ACR; no registry
credential enters a pod. ACR admin authentication is disabled. No SSH key was
created. Kubernetes credentials remain only in the trusted workstation's
normal configuration. Cilium is available for fail-closed actor policies.

### Remaining unknowns

- Actual Kata pod kernel/device/network behavior.
- KVM visibility from normal and Kata placements.
- Substrate control-plane and worker compatibility with AKS.
- Remote actor relay and artifact transport.

## v7 - Measured AKS isolation boundary

```text
AKS sandbox node (Azure Linux, Hyper-V based host kernel)
  |
  +-- restricted runc probe
  |     +-- host kernel
  |     +-- no SA token / credentials / KVM
  |     `-- Cilium deny-all
  |
  `-- restricted kata-vm-isolation probe
        +-- separate guest kernel
        +-- no SA token / credentials / host paths / KVM
        `-- Cilium deny-all

Substrate microVM candidates
  +-- runc + host /dev/kvm -> path visible, KVM API unavailable
  `-- Kata + host /dev/kvm -> pod sandbox creation blocked
```

### Reason for change

Provisioned runtime intent is insufficient for untrusted coding agents. The
POC now measures the controls from inside digest-pinned workloads.

### Security implications

The accepted actor fallback is the restricted Kata pod with no host volumes,
no token automount, no capabilities, non-root UID, read-only rootfs, and
deny-all network policy. The privileged KVM probe is not part of this
architecture and its temporary namespace was deleted.

### Result

Direct AKS Kata satisfies the initial sandbox boundary. This pool cannot host a
Substrate KVM microVM either outside or inside Kata. The gVisor/control-plane
rows remain open.

## v8 - Remote Pi actor with local Copilot trust

```text
Trusted workstation
  +-- committed fixture repository
  +-- SourceTransport: archive + manifest
  +-- loopback Copilot broker (existing local login)
  +-- trusted bridge
  |     `-- actor ID -> distinct local broker capability
  `-- kubectl port-forward -> relay ClusterIP
          |
          +-- authenticated job proxy
          |     `-- actor ClusterIP /v1/run
          |
          `-- authenticated WebSocket model tunnel
                ^
                |
AKS pi-substrate namespace
  +-- system pool: runc model relay
  |     +-- no cloud/model credential
  |     `-- egress only actor + DNS
  `-- sandbox pool: Kata Pi actor
        +-- archive -> isolated emptyDir -> actor-local Git
        +-- constrained Pi read/edit/write/test tools
        +-- model calls only to relay
        +-- ingress only relay; egress only relay + DNS
        +-- successful test -> fresh replay/test of exact patch
        `-- one job -> pod exit -> integrity-tagged binary patch

Trusted workstation
  `-- disposable replay -> policy scan
        -> no-network container test -> prevalidated local commit
```

### Reason for change

The runtime baseline proved direct Kata isolation, but a useful actor also
needed credential-free model access and source transport. Direct port-forward
to the Kata guest failed at pod-netns loopback, so the runc relay became the
single private ingress for both model tunneling and authenticated jobs.

### Security implications

Five POC capabilities remain distinct: actor-to-relay model access, bridge
tunnel, trusted job client, relay-to-actor job delivery, and
bridge-to-local-broker. The actor gets only the delivery bearer's digest. None
is a GitHub, Copilot, Azure, registry, or kubeconfig credential. No trusted
directory is mounted. Actor patches require a successful test event plus an
independent exact-patch test. Trusted tests run in a no-network container before
application.

### Result

The digest-pinned Kata actor edited and tested one fixture, returned only
`math.js`, and the trusted side replayed, tested, and committed it. Removing
the bridge caused `actor_acceptance_failed` and no patch. Two-actor
orchestration and remote lifecycle remain open.

## v9 - Managed-control-plane compatibility gate

```text
Pinned Substrate install
  |
  +-- requires PodCertificateRequest ---------+
  +-- requires ClusterTrustBundle ------------+--> AKS API: unavailable
  +-- requires projected certificate sources -+        |
  |                                                     v
  `-- gVisor worker: hostPath + broad caps       stop before mutation

Accepted remote path
  `-- private relay -> restricted AKS Kata Pi actor
```

### Reason for change

The local Substrate lifecycle proof did not establish whether the pinned
identity plane could bootstrap on a managed AKS API server. A reproducible
preflight now decides that before cluster-scoped installation.

### Security implications

The POC does not replace missing certificate APIs with static signing material
and does not reinterpret a host-mounted, broadly capable gVisor worker as a
restricted actor. No partial Substrate resources were installed on AKS.

### Result

Both required certificate resources were absent, and server-side dry run
removed both projected certificate sources. Substrate on AKS is blocked at the
control-plane boundary. The direct credential-free Kata architecture remains
unchanged.
