# Experiment 007: AKS runtime and KVM matrix

## Metadata

- Date: 2026-08-24
- Local baseline commit: `cbdd9e0`
- AKS: `pisa-aks`, Kubernetes `1.35`
- Sandbox pool: Azure Linux `Standard_D4s_v3`,
  `KataVmIsolation`
- Probe image digest:
  `sha256:9e782490db59b4acea87c93fc454e3fe1a184ccd3ea66bce5d7574aeb77cc14e`

## Question

Which isolation and nested-hypervisor properties are actually available on the
AKS sandbox pool, and do they satisfy the credential, identity, network, and
KVM prerequisites for a remote coding actor or Substrate microVM worker?

## Implementation

`tools/runtime-probe` builds a scratch image containing one static Go binary.
It reports only booleans, kernel release, UID, credential variable names, and
bounded connectivity status. It never reports environment values.

`deploy/aks/runtime-probes.yaml` runs digest-pinned runc and
`kata-vm-isolation` pods with:

- restricted Pod Security;
- non-root UID `65532`;
- read-only root filesystem;
- no Linux capabilities or privilege escalation;
- no service-account token;
- no service links or host volumes;
- deny-all ingress and egress through Cilium.

A separate, temporary privileged diagnostic namespace tested only the
`/dev/kvm` host path. It was deleted after evidence collection.

## Result

| Variant | Result | Evidence |
|---|---|---|
| Restricted runc pod on sandbox node | **PASS** | Separate host kernel; no credentials/token/KVM; API, IMDS, public egress blocked |
| Restricted AKS Kata pod | **PASS** | Distinct guest kernel; no credentials/token/KVM; API, IMDS, public egress blocked |
| Substrate microVM prerequisite in runc pod | **BLOCKED** | Node `/dev/kvm` is not a character device; privileged mount returns KVM API version `0` |
| Substrate microVM inside AKS Kata | **BLOCKED** | No KVM in normal Kata pod; attempted host-device placement timed out creating the Kata sandbox |
| Substrate gVisor on AKS | **PENDING** | Requires pinned control-plane/worker attempt |
| OSS Agent Sandbox + AKS Kata | **PENDING** | Fallback controller not yet installed |

The final digest-pinned restricted probes returned:

```text
PISA_RUNTIME_PROBES_OK
```

The runc and Kata kernel releases differed, proving that the Kata pod used a
separate guest kernel. Both probes had an empty credential-environment-name
list, no service-account token, no `/host`, `/home/operator`, or `/root` path,
and effective denial to the Kubernetes service, Azure IMDS, and a public
endpoint.

## Iterations

The first Kata attempt used a `64Mi` memory limit and failed closed with a
documented runtime minimum of `128Mi`. Raising the request to `128Mi` and limit
to `256Mi` produced the successful isolated run.

The first KVM host-path manifest required a character device. Both placements
failed that check because the node path is not a usable KVM character device.
With type checking removed solely for diagnosis, a privileged runc pod could
see the path but `KVM_GET_API_VERSION` returned `0`. The equivalent Kata
placement never created its pod sandbox.

## Interpretation

AKS Pod Sandboxing is a viable direct isolation boundary for the credential-free
Pi actor. It is not a placement for a nested Substrate KVM microVM on this
pool. Even the normal runc placement lacks a usable `/dev/kvm`, so the current
`KataVmIsolation` pool cannot host Substrate's KVM backend.

This does not yet decide whether Substrate's gVisor workers or control plane can
run on AKS. Those remain separate tests.

## Evidence

- `tools/runtime-probe/`
- `deploy/aks/runtime-probes.yaml`
- `deploy/aks/kvm-probes.yaml`
- `scripts/build-runtime-probe.sh`
- `scripts/run-runtime-probes.sh`
- `evidence/aks-runtime/runtime-probes.txt`
