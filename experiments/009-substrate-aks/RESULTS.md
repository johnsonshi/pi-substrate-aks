# Pinned Agent Substrate compatibility on AKS

## Result

**BLOCKED before cluster mutation.** The pinned Agent Substrate control plane
requires the Kubernetes `PodCertificateRequest` and `ClusterTrustBundle`
certificate APIs. The managed `pisa-aks` API server exposes neither resource.
A server-side dry run also pruned both projected-volume sources from a probe
Pod, proving that applying the upstream workloads would leave their identity
volumes empty.

The exact pinned revision is:

```text
bc51ef2452c4bf4c0542cd6850040c9ed1033421
```

## Reproduce

```bash
make aks-substrate-preflight
```

Expected final marker:

```text
PISA_SUBSTRATE_AKS_PREFLIGHT_BLOCKED
```

The probe is read-only: its only API submission uses Kubernetes server-side dry
run. It verifies the pinned checkout, discovers the managed API resources,
tests whether the required projection fields survive server decoding, and
confirms the upstream source dependencies.

## Blocking dependencies

The pinned upstream install:

- grants its certificate controller access to
  `podcertificaterequests.certificates.k8s.io` and
  `clustertrustbundles.certificates.k8s.io`;
- projects `podCertificate` and `clusterTrustBundle` sources into the API
  server, controller, router, worker manager, and data-store workloads;
- waits for certificate-controller-created trust bundles before continuing.

The observed AKS API surface cannot satisfy that identity bootstrap. AKS owns
the managed control plane, so this POC cannot enable the missing API resources
or their feature gates. A partial install would create cluster-scoped CRDs and
RBAC, then fail to establish the mTLS identity plane.

The gVisor WorkerPool was not applied after the control-plane gate failed.
Independently, the pinned worker pod requires the node
`/var/lib/ateom-gvisor` host path, host mount propagation, AppArmor
unconfined, and broad capabilities including `SYS_ADMIN`, `SYS_PTRACE`, and
`NET_ADMIN`. That is not the restricted direct-actor boundary accepted by this
POC. Wrapping that worker in AKS Kata cannot repair the missing managed
certificate APIs and remains unproven.

## Decision

Do not fork the upstream identity system, inject static signing material, or
weaken the actor boundary to force this placement. Keep the exact upstream
gVisor lifecycle proof on the dedicated kind cluster and use the proven direct
AKS Kata actor fallback. Revisit AKS placement only if the required
certificate APIs become available or a distinct self-managed Kubernetes
control plane is intentionally provisioned inside the POC resource group.

## Evidence

- `evidence/substrate-aks/preflight.txt`
- `scripts/probe-substrate-aks.sh`
- `deploy/substrate/UPSTREAM_SHA`
- `experiments/005-substrate-kind/RESULTS.md`
- `experiments/008-remote-actor/RESULTS.md`
