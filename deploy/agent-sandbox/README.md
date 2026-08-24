# OSS Agent Sandbox on AKS Kata

This experiment pins the official Kubernetes SIG Apps Agent Sandbox release and
runs a stateful `Sandbox` on the dedicated AKS Kata pool.

## Pin

| Item | Value |
|---|---|
| Release | `v0.5.6` |
| Annotated tag object | `0a28fcdc886346d46525042a6ddf6fd94482f207` |
| Commit | `211b7579cabed9460c1a692eb687084ff4c5879d` |
| Release manifest SHA-256 | `1696dbb6faded503149b3994badb599df5dcf24d5985466881784f442dd9c3e5` |
| Controller image | `registry.k8s.io/agent-sandbox/agent-sandbox-controller:v0.5.6` |

The release manifest is downloaded to `.work/`, verified before use, and
rendered through the tracked Kustomize overlay. It is never piped to a shell.

## Controller scope

The upstream release installs four CRDs, two ClusterRoles and
ClusterRoleBindings, a conversion webhook, and one controller Deployment.
The controller can manage Pods, PVCs, Services, Sandboxes, extension resources,
and NetworkPolicies across namespaces. Release `v0.5.6` does not expose a
namespace-scoped watch flag; its namespace flags configure only webhook and
leader-election placement.

That authority is accepted only because `pisa-aks` is a dedicated disposable
POC cluster. The overlay adds Restricted Pod Security labels and runs the
controller non-root with RuntimeDefault seccomp, a read-only root filesystem,
no added capabilities, no privilege escalation, and a bounded writable
`emptyDir` at `/tmp`. The controller necessarily retains its Kubernetes
service-account token; sandbox actors do not.

## Install and experiment

```bash
make aks-agent-sandbox-install
make aks-agent-sandbox
```

The experiment temporarily scales the existing one-node-pool Kata actor down,
then:

1. creates a credential-free, deny-all `Sandbox` under
   `kata-vm-isolation`;
2. writes a non-sensitive marker to a dynamically provisioned workspace PVC;
3. verifies service-account, external credential-name, Kubernetes API, IMDS,
   and public egress denial;
4. sets `spec.operatingMode: Suspended` and waits for the pod to be deleted;
5. verifies the PVC remains bound;
6. resumes the Sandbox and verifies a new pod/process sees the prior marker;
7. suspends the probe again and restores the original remote actor.

Success prints `PISA_AGENT_SANDBOX_OK`. The final probe stays suspended, so it
holds no Kata VM. Its 1 GiB PVC remains for inspection.

This proves workspace persistence across a real controller-managed
suspend/resume. It does not preserve memory or Pi's in-memory session. It is
also not Agent Substrate lifecycle on AKS; that path remains blocked by the
managed control-plane certificate API gate.

## Component teardown

Leave the working POC running for inspection. To remove only Agent Sandbox and
its probe from `pisa-aks`:

```bash
make aks-agent-sandbox-teardown
```

The target verifies the context, deletes `pi-agent-sandbox` first so its
Sandbox and PVC are reconciled while the controller still exists, then removes
the exact digest-verified controller manifest, RBAC, webhook, CRDs, and system
namespace. It does not touch the AKS cluster, ACR, original remote actor, or
another resource group.
