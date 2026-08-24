# Security

## Trust boundary

The operator workspace, reviewed project code, and local GitHub Copilot CLI are
trusted. Repository content, model output, actor processes, actor filesystems,
package output, upstream documentation, and remote workloads are untrusted.

## Invariants

1. Copilot, GitHub, Azure, SSH, and kubeconfig credentials remain on the trusted
   local machine.
2. Actors receive source snapshots without repository credentials and return
   patches for local validation.
3. Actor tools are constrained in code and by the runtime; prompt instructions
   are not a security boundary.
4. Actor workloads have no service-account token, host namespace, host path,
   privileged mode, or unrestricted egress.
5. Broker requests are authenticated per actor, bounded, rate limited, and
   fail closed.
6. All Azure changes are restricted to `rg-pi-substrate-aks` and `pisa-*`
   resources where practical.

## Source boundary

Actors receive a bounded committed `git archive`, never the trusted repository,
its history, `.git`, or a filesystem mount. Source and returned changes reject
symlinks, submodules, unsupported Git modes, traversal, credential-like paths,
and credential-like content. Returned full-index binary patches are applied to
a disposable validation repository before being staged in a clean trusted
repository. Safety-policy changes require an explicit trusted-call override.

## Remote model and job boundary

The AKS relay is a ClusterIP-only service. Each actor receives a distinct model
capability and has a separate relay-to-actor delivery capability; the topology
also has two shared trusted-side POC capabilities:

- an actor-scoped capability authenticates model requests to the relay;
- a tunnel capability authenticates the trusted local WebSocket bridge;
- a trusted job-client capability authenticates archive/task submission;
- a different per-actor delivery capability authenticates each relay
  cluster-local forward. Each actor stores only its own SHA-256 verifier, not a
  reusable bearer.

The relay never receives a GitHub or Copilot credential. It forwards only the
authenticated actor ID over the WebSocket. The trusted bridge maps that ID to a
fifth, separate local broker capability and can send it only to a loopback
broker URL. If the bridge disconnects, model requests fail closed. The remote
actor exports no patch unless its event trace contains a successful
`workspace_test` and a clean replay of the exact final patch passes an
independent test. Each actor pod serves one job and then exits, which removes
test descendants and in-memory capabilities.

Every smoke run first removes the old relay and actor deployments, then deletes
and recreates the two POC capability Secrets. This avoids Kubernetes
server-side apply retaining revoked data keys and prevents old pods from
continuing to use prior capabilities during rotation.

The pinned Substrate control plane is not partially installed on AKS when its
required certificate APIs are absent. This POC does not substitute static
signing material or weaken worker permissions to force compatibility. The
upstream gVisor WorkerPool's host path, mount propagation, AppArmor, and broad
capability requirements are not accepted as equivalent to the restricted
direct Kata actor.

The pinned OSS Agent Sandbox controller is trusted cluster infrastructure, not
an actor. It necessarily holds a Kubernetes service-account token and
cluster-wide reconciliation rights for Pods, PVCs, Services, CRDs, extension
resources, and NetworkPolicies. Release `v0.5.6` has no namespace-scoped watch
flag, so this authority is accepted only on the dedicated disposable POC
cluster. A tracked overlay enforces Restricted Pod Security, non-root
execution, RuntimeDefault seccomp, a read-only root filesystem, dropped
capabilities, and no privilege escalation. Agent Sandbox workloads retain the
actor invariants: no service-account token, no credential, no host path, and
deny-all networking unless explicitly narrowed.

Each actor runs non-root under `kata-vm-isolation`, with a read-only root
filesystem, dropped capabilities, no privilege escalation, no service-account
token, no host volume, and an ephemeral `emptyDir` workspace. Cilium permits
actor ingress only from the relay and actor egress only to the relay and
cluster DNS. A Cilium deny rule additionally blocks the `host`, `remote-node`,
and `kube-apiserver` entities, closing the standard Kubernetes NetworkPolicy
node-traffic exception. Actor-to-actor Service traffic is denied. The relay can
egress only to actor-labeled pods and cluster DNS. Trusted job routing accepts
only a configured actor ID mapped to a fixed cluster-local URL; callers cannot
submit arbitrary targets, and the relay rejects downstream redirects rather
than forwarding a job body to a second destination.

## Enforced prompt boundary

Repository instructions are deliberately treated as attacker-controlled data.
The deterministic security fixture uses an adversarial fake model that follows
repository instructions and attempts an outside read, Git metadata read,
outside write, and destructive command. Canonical workspace checks, protected
path rules, and exact command allowlisting reject those actions even though the
model requests them. The test also proves that an operator-owned canary is not
returned in actor events or output and that protected files remain unchanged.

Prompt wording is defense in depth only. Enforced tools, source validation,
runtime isolation, capability separation, and trusted patch validation are the
security boundary.

The trusted workstation never executes returned actor code directly. It
materializes the validated patch into a separate workspace, removes Git
metadata, and runs the test in a non-root Docker container with no network,
dropped capabilities, a read-only root filesystem, a read-only source mount,
bounded CPU/memory/PIDs, and no host credential mount. Only the already
validated Git index is committed locally.

## Security acceptance

Run the deterministic local controls plus direct probes from the live Kata
actor:

```bash
make security
```

The command checks broker/relay actor identity, workspace and process
containment, prompt-injection resistance, RuntimeClass placement,
service-account token absence, external credential-related environment names,
selected prohibited paths, Kubernetes API/IMDS/node-local/public egress denial,
the valid Cilium host-entity deny policy, ClusterIP-only exposure, the expected
capability Secret key names, and bidirectional actor-to-actor denial when the
two-actor topology is deployed. It never reads Secret values or environment
values. Sanitized evidence is written to `evidence/security/acceptance.txt`.

## Prohibited data

Never commit or capture token values, credential files, kubeconfig contents,
subscription or tenant identifiers, private keys, Keychain contents, or full
environment dumps. Evidence must record only sanitized metadata and conclusions.

## Dependency posture

Pi is pinned to the patched `@earendil-works/pi-*` `0.84.2` package family.
Dependency installation disables lifecycle scripts. The deprecated
`@mariozechner/pi-coding-agent` `0.73.1` line is prohibited because its known
extension-path, auth-file, and HTML-export advisories have no patched release
under the old package name.

## Reporting

This is a private experimental repository. Record discovered vulnerabilities in
the private repository without including live secrets.
