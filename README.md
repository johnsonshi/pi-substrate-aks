# Pi Substrate AKS

> **Research POC:** Run Pi coding actors in isolated AKS Kata guests while
> GitHub Copilot authentication, source-control authority, and final change
> acceptance remain on a trusted workstation.

This repository answers a practical question:

**Can an individual or an organization use remote coding agents without turning
the remote runtime into a credentialed developer workstation?**

For this POC, the answer is **yes, within a deliberately narrow harness**. Two
credential-free Pi actors ran concurrently on AKS, used the workstation's
existing Copilot login through a revocable private bridge, edited and tested
code in separate Kata guests, and returned patches that were independently
replayed and tested before a trusted local commit.

> **Runtime naming matters:** the working AKS path uses direct
> `kata-vm-isolation` pods. Upstream Agent Substrate was proven separately on
> local kind, but is blocked on this AKS configuration. This repository does
> not relabel direct Kata execution as "Agent Substrate on AKS."

The experiment was built privately under its original safety constraints. It
was made public on 2026-08-24 only after final validation and two independent
scans of all reachable Git history found no high-confidence credential
material. GitHub secret scanning, push protection, and private vulnerability
reporting are enabled.

## What this repository proves

| Question | Proven result |
|---|---|
| Can a remote actor use Copilot without receiving the user's GitHub or Copilot token? | **Yes.** The actor receives only a POC-scoped relay capability. The trusted local broker uses the already-authenticated user session. |
| Can the actor edit and test code remotely? | **Yes.** A real Pi SDK actor read, edited, and tested a fixture in an AKS Kata guest. |
| Can more than one actor run at once? | **Yes.** An implementer and reviewer/tester ran concurrently with `19.887 s` of measured overlap. |
| Can source move to the actor without a Git clone or repository credential? | **Yes.** The harness sends a bounded archive of one committed revision, not `.git`, history, or a trusted filesystem mount. |
| Can untrusted actor output be kept out of the trusted repository until validated? | **Yes.** Patches are replayed in disposable workspaces, policy-scanned, and tested in a no-network container before local staging or commit. |
| Can actors be isolated from Kubernetes, Azure metadata, the node, the internet, and each other? | **Yes for the measured POC controls.** Runtime and live network probes passed. |
| Can remote workspace state survive suspension? | **Yes.** OSS Agent Sandbox released the Kata pod and restored a PVC into a new process. |
| Can the Pi process and in-memory session resume on AKS? | **No.** Agent Sandbox resume is a cold process restart. |
| Does upstream Agent Substrate run on this AKS cluster? | **No.** Required certificate APIs are absent and usable nested KVM is unavailable. The preflight stops without cluster mutation. |

The full, evidence-linked matrix is in [STATUS.md](STATUS.md). Sanitized machine
outputs are indexed in [evidence/README.md](evidence/README.md).

## Why this is useful

### From a developer or operator point of view

- Keep using the GitHub Copilot login already present on the workstation.
- Send a task and a committed source snapshot to disposable remote compute.
- Let the actor read, edit, and test inside a stronger runtime boundary than a
  normal local process.
- Receive a patch rather than granting the actor repository write authority.
- Keep review, final testing, commit, and push on the trusted workstation.
- Revoke remote model access immediately by closing the local bridge.

The remote actor does indirectly consume the user's Copilot entitlement while
the bridge is connected. That is application-level delegation of model
requests, **not delegation of a GitHub-issued token or GitHub identity**. The
actor's relay capability cannot be used against GitHub or Copilot directly.

### From an organization or agent-harness point of view

This POC demonstrates a control pattern for an internal coding-agent platform:

- **Centralize credentials:** keep user/model credentials in a trusted broker
  instead of distributing them to every worker.
- **Issue narrow actor identities:** authenticate model access, job submission,
  bridge traffic, and actor delivery with separate capabilities.
- **Treat the model and repository as untrusted:** enforce policy in tools,
  transport, runtime, and patch acceptance rather than in prompts.
- **Make workers disposable:** give each actor one job, one isolated workspace,
  and no durable external identity.
- **Separate execution from authority:** remote actors can propose code; only a
  trusted orchestrator can accept, commit, or push it.
- **Compose specialist roles:** run implementer and reviewer/tester actors in
  parallel without sharing workspaces, delivery capabilities, or network
  access.
- **Fail closed:** disconnecting the trusted bridge removes model access, and a
  failed actor test or patch replay produces no accepted change.
- **Preserve inspectable evidence:** record versions, digests, timings, policy
  results, and conclusions without recording credential values.

This is the part worth carrying into a production harness. The exact Pi, relay,
or Kubernetes implementation can change; the authority split should not.

## Trust and authority model

| Component | Trusted authority | Explicitly does not receive |
|---|---|---|
| Trusted workstation | Copilot login, local Git repository, Azure/Kubernetes operator access, final patch acceptance, commit and push | N/A - this is the trusted control point |
| Local Copilot broker and bridge | Uses local Copilot auth; maps authenticated actor IDs to separate local broker capabilities | No remote filesystem or actor tool execution |
| Private AKS relay | Authenticates and routes bounded model/job traffic to fixed actor targets | No GitHub, Copilot, Azure, registry, or kubeconfig credential |
| Kata Pi actor | One actor-scoped model capability, one archive-derived workspace, constrained tools | No external credential, Git history, service-account token, host mount, or repository write authority |
| Agent Sandbox controller | Dedicated-cluster lifecycle reconciliation for the workspace-resume experiment | Not treated as an actor; its broad controller RBAC is not delegated to actor pods |

The five POC capability classes are intentionally separate: actor-to-relay
model access, bridge tunnel access, trusted job submission, relay-to-actor job
delivery, and bridge-to-local-broker access. Actor pods store only the verifier
for their inbound delivery capability, not its reusable bearer.

See [SECURITY.md](SECURITY.md) for the complete trust boundary and acceptance
criteria.

## End-to-end architecture

```text
Trusted workstation                                  Dedicated AKS POC

committed Git revision
        |
        v
bounded archive + manifest ---- job capability ----> private relay ClusterIP
                                                         | fixed actor route
existing Copilot login                                   v
        |                                           Kata actor A
loopback broker <---- trusted WebSocket bridge ----> Kata actor B
        ^                                                |
        | actor-scoped model requests                    | bounded patch
        +------------------------------------------------+
                                                         |
disposable replay + policy scan <------------------------+
        |
no-network container test
        |
trusted local stage / commit / push
```

Nothing in AKS can use the workstation's GitHub, Copilot, Azure, or kubeconfig
credentials. Nothing in AKS can commit or push. The relay is reachable only
through a loopback `kubectl port-forward`; actor and relay Services are
`ClusterIP`.

## What a remote actor can and cannot do

| The actor can | The actor cannot |
|---|---|
| Request model completions through its authenticated private relay route while the trusted bridge is connected | Obtain or use the underlying GitHub/Copilot credential |
| Read, edit, and write regular files inside its own archive-derived workspace | Read `.git`, repository history, the trusted workspace, host paths, or another actor's workspace |
| Run exact allowlisted entry points: `npm test`, `npm run test`, `npm run typecheck`, `npm run build`, and `node --test` | Submit an arbitrary shell command through the Pi tool API |
| Execute repository code reached by those build/test entry points inside the sandbox | Escape the sandbox's filesystem, process, identity, or network policy by design |
| Return a bounded full-index binary patch after a successful test event and exact-patch replay | Commit, push, open a pull request, call GitHub APIs, or select an arbitrary relay destination |
| Reach the relay and cluster DNS | Reach public internet, Kubernetes API, Azure IMDS, node-local services, or peer actors in the measured deployment |

Allowlisted `npm` commands can execute code defined by the untrusted repository.
That is expected coding-agent behavior, which is why runtime isolation and
trusted-side no-network retesting are required in addition to command
allowlisting.

## How a change becomes trusted

1. The trusted orchestrator resolves one exact commit.
2. Source transport rejects links, submodules, unsupported modes,
   credential-like paths/content, and oversized input.
3. The actor receives only a bounded `git archive` plus a SHA-256 manifest.
4. Pi uses four tools: `workspace_read`, `workspace_edit`, `workspace_write`,
   and `workspace_test`.
5. The actor must emit a successful test event.
6. The remote service exports the exact final patch, replays it in a fresh
   workspace, and tests it again.
7. The trusted workstation independently replays and policy-checks the patch.
8. Tests run against that exact tree in a non-root Docker container with no
   network, dropped capabilities, bounded resources, and a read-only source
   mount.
9. Only the already validated Git index is eligible for a local commit.

For two actors, each patch passes independently before the orchestrator merges
only disjoint changes into a fresh baseline and tests the exact combined tree.

## What this repository does not prove

| Not proven | Honest boundary |
|---|---|
| Production readiness | This is a public research POC, not a supported multi-tenant service. It has no production SLA, HA, quota, billing, abuse-management, or operator UX layer. |
| Agent Substrate on AKS | Upstream Substrate works on the pinned local kind baseline, not on this AKS control plane. |
| Full-state suspend/resume on AKS | Agent Sandbox preserves workspace PVC data, not process memory or Pi in-memory session state. |
| Broad workload compatibility | The demonstrated coding tasks and command allowlist are intentionally narrow and Node-oriented. |
| Large-scale scheduling | The proof is two concurrent Kata actors on one sandbox node, not fleet-scale throughput or capacity planning. |
| Unrestricted networked development | Actor public egress is denied. Package acquisition and other internet-dependent workflows require a separately designed, explicit allowlist or artifact mirror. |
| A least-privilege Agent Sandbox controller | Release `v0.5.6` requires cluster-wide reconciliation authority; this is accepted only on the dedicated disposable POC cluster. |
| Perfect containment against unknown runtime vulnerabilities | The POC proves configured controls and measured probes, not the absence of hypervisor, kernel, Kubernetes, or dependency vulnerabilities. |
| Automatic GitHub workflow authority | Actors return patches. PR creation, branch updates, commits, and pushes deliberately remain outside the remote harness. |
| Credential absence as a mathematical guarantee | Automated tests and a full reachable-history static audit found no credentials, but novel obfuscation and unknown scanner gaps are always possible. |

## Runtime compatibility: what actually worked

| Runtime placement | Result | Meaning |
|---|---|---|
| Pinned Agent Substrate + gVisor workers on local kind | **PASS** | Actor routing plus data/full pause and suspend lifecycle semantics were proven. |
| Agent Substrate microVM on local kind | **BLOCKED** | The Docker kind node exposed no `/dev/kvm`. |
| Agent Substrate control plane on AKS | **BLOCKED** | AKS lacks required `PodCertificateRequest` and `ClusterTrustBundle` APIs; preflight makes no cluster changes. |
| Agent Substrate microVM on/inside AKS Kata | **BLOCKED** | The node path does not expose usable KVM and Kata cannot provide nested KVM. |
| Direct Pi actor in AKS `kata-vm-isolation` | **PASS** | This is the working remote coding path. |
| OSS Agent Sandbox controller + AKS Kata | **PASS, workspace only** | Suspend releases the pod and resume restores the PVC into a new process. |

The experiments are intentionally additive: a blocked row is retained as a
result, not hidden behind the working fallback.

## Reproduce the proof

### 1. Local deterministic gates

Requirements include Node.js 22 or newer and Docker. These commands do not
copy or print authentication material:

```bash
./scripts/preflight.sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm audit --omit=dev
npm run security:local
```

### 2. Real local Copilot path

The first two smokes use the already-authenticated local GitHub Copilot session
and consume model requests. The transport smoke uses the deterministic backend
to prove archive/patch handling. None accepts a GitHub token argument:

```bash
npm run smoke:copilot
npm run smoke:pi-copilot
npm run smoke:transport:local
```

Expected success markers include `PISA_COPILOT_OK` and
`PISA_PI_COPILOT_OK`.

### 3. Dedicated AKS path

This path requires Azure CLI, `kubectl`, Helm, an authenticated Azure account,
and permission to create billable resources. Provisioning is guarded to the
dedicated `rg-pi-substrate-aks` resource group and `pisa-*` resources where
practical.

```bash
make aks-provision
make aks-runtime-probes

# BLOCKED is the expected, successful compatibility result; no cluster mutation.
make aks-substrate-preflight

make aks-agent-sandbox
make aks-harness-image
npm run smoke:remote-actor
make aks-multi-actor
make security
make aks-verify
```

The final live topology is the two-actor deployment. Run
`make aks-multi-actor` again after an experiment that restores the legacy
single-actor deployment.

The upstream kind lifecycle is a separate proof. Follow the exact pinned steps
in [deploy/substrate/README.md](deploy/substrate/README.md).

### 4. Tear down only the POC

The working environment is intentionally left running after the proof. When
teardown is explicitly intended, the script requires the exact resource-group
confirmation:

```bash
PISA_CONFIRM_TEARDOWN=rg-pi-substrate-aks make aks-teardown
```

See [deploy/aks/README.md](deploy/aks/README.md) before running it.

## Repository map

| Path | Purpose |
|---|---|
| `packages/copilot-broker` | Loopback-only, actor-authenticated Copilot SDK broker using the existing local login |
| `packages/pi-actor` | Constrained Pi `createAgentSession()` wrapper and canonical workspace policy |
| `packages/model-relay` | Actor-keyed private relay and trusted local WebSocket bridge |
| `packages/remote-actor` | One-job archive/task/patch service and remote acceptance gate |
| `packages/orchestrator` | Bounded archive-in, validated patch-out, replay, merge, and trusted staging |
| `deploy/aks` | Dedicated AKS/ACR topology, Kata actors, relay, and network policies |
| `deploy/substrate` | Pinned upstream local kind baseline and lifecycle reproduction |
| `deploy/agent-sandbox` | Pinned OSS Agent Sandbox overlay and workspace lifecycle proof |
| `scripts` | Reproducible smokes, provisioning, runtime probes, security verification, and teardown |
| `experiments` | Narrative results, failures, interpretations, and exact limitations |
| `evidence` | Sanitized versions, digests, booleans, timings, and conclusions |

## Verified snapshot

| Item | Value |
|---|---|
| Local test suite | 30 tests passed |
| Production dependency audit | Zero advisories |
| Pi packages | Pinned `@earendil-works/pi-*` `0.84.2` |
| Agent Substrate | `bc51ef2452c4bf4c0542cd6850040c9ed1033421` |
| OSS Agent Sandbox | `v0.5.6`, commit `211b7579cabed9460c1a692eb687084ff4c5879d` |
| Final harness image | `pisasubstrate84acr.azurecr.io/pisa-harness@sha256:437eef6199f18fc3b30e4a972e38156315f0cd53e31de5c9607bbc2aa64e48c9` |
| Remote concurrency | Two Kata actors, `19,887 ms` overlap |
| Exposure | ClusterIP only; no LoadBalancer Services |

## Read next

1. [STATUS.md](STATUS.md) - PASS/BLOCKED matrix with direct evidence links.
2. [SECURITY.md](SECURITY.md) - trust boundary, capability split, runtime
   controls, and acceptance gate.
3. [DESIGN.md](DESIGN.md) - authoritative design and original constraints.
4. [docs/ARCHITECTURE_EVOLUTION.md](docs/ARCHITECTURE_EVOLUTION.md) - every
   architecture iteration and why it changed.
5. [docs/LAB_NOTES.md](docs/LAB_NOTES.md) - append-only experiment diary,
   including failures.
6. [evidence/README.md](evidence/README.md) - sanitized proof index.
