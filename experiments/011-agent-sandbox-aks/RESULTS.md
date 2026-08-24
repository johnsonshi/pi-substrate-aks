# OSS Agent Sandbox on AKS Kata

## Result

**PASS** for the pinned OSS Agent Sandbox controller managing a
`kata-vm-isolation` workload on AKS.

**PASS** for controller-managed suspend/resume with workspace PVC persistence
and worker release.

**NOT PRESERVED** for process memory and Pi in-memory session state. Resume
created a new pod UID and boot identifier. This is intentionally not described
as Agent Substrate full-state resume.

## Upstream pin

- repository: `https://github.com/kubernetes-sigs/agent-sandbox`
- release: `v0.5.6`
- annotated tag object:
  `0a28fcdc886346d46525042a6ddf6fd94482f207`
- resolved commit:
  `211b7579cabed9460c1a692eb687084ff4c5879d`
- combined release manifest SHA-256:
  `1696dbb6faded503149b3994badb599df5dcf24d5985466881784f442dd9c3e5`
- observed controller image:
  `registry.k8s.io/agent-sandbox/agent-sandbox-controller@sha256:dc23fb0d5624c306ca2f8ef0d41848dba670ebaf62beb500f870175aec529ffd`

The research handoff named a different example commit. Resolving the annotated
release tag locally established `211b7579...` as the authoritative release
commit before any cluster mutation.

## Controller security review

The exact release installs:

- four cluster-scoped CRDs;
- two ClusterRoles and ClusterRoleBindings;
- namespaced Role/RoleBinding and ServiceAccount;
- ClusterIP metrics and conversion-webhook Services;
- one controller Deployment that self-manages webhook TLS.

The ClusterRoles authorize cross-namespace Pod, PVC, Service, Sandbox,
extension-resource, NetworkPolicy, event, lease, and CRD operations. The
release has no namespace-scoped watch option. This broad authority is accepted
only on the dedicated POC cluster.

The tracked overlay adds Restricted Pod Security and hardens the controller to
non-root, RuntimeDefault seccomp, dropped capabilities, no privilege
escalation, read-only root, and a bounded writable `/tmp`. The actual
controller pod has no privileged mode or host path. Its service-account token
is required for reconciliation and remains confined to this trusted
infrastructure pod.

AKS emitted a policy warning that `registry.k8s.io` was not on a configured
allowlist, but admission permitted the pinned public controller image. No
registry credential or anonymous ACR access was added.

## Kata and lifecycle experiment

The experiment temporarily scaled the original remote actor to zero to avoid
creating two Kata guests concurrently on the one-node pool. It then created a
credential-free core `Sandbox` with:

- `runtimeClassName: kata-vm-isolation`;
- non-root UID/GID 1000;
- RuntimeDefault seccomp;
- read-only root;
- all capabilities dropped;
- no privilege escalation;
- no service-account token;
- no service links;
- a deny-all Cilium NetworkPolicy;
- a 1 GiB workspace PVC.

The live pod had no external GitHub/Copilot/Azure/ARM/kubeconfig/MSI/identity
environment variable names. Kubernetes API, Azure IMDS, and public internet
TCP attempts were blocked.

A marker was written to the workspace PVC. Setting
`spec.operatingMode: Suspended` produced `Suspended=True` and deleted the Kata
pod while the PVC remained `Bound`. Returning to `Running` created a different
pod UID and process boot identifier. The marker was unchanged. The probe was
then suspended again and the original remote actor returned to `1/1`.

## Final live state

- controller Deployment: `1/1`;
- controller namespace: Restricted Pod Security;
- probe Sandbox mode: `Suspended`;
- probe pod: absent;
- workspace PVC: `Bound`, 1 GiB;
- original remote actor: `1/1`;
- LoadBalancer Services: none.

## Reproduce

```bash
make aks-agent-sandbox
```

## Evidence

- `evidence/agent-sandbox/lifecycle.txt`
- `deploy/agent-sandbox/PINNED_VERSION`
- `deploy/agent-sandbox/lifecycle-probe.yaml`
- `scripts/install-agent-sandbox.sh`
- `scripts/experiment-agent-sandbox.sh`

## Teardown

```bash
make aks-agent-sandbox-teardown
```
