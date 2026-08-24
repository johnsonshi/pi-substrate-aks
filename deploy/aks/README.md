# Dedicated AKS POC

All Azure resources for this proof live in:

```text
rg-pi-substrate-aks
```

The idempotent provisioning path creates:

| Resource | Name | Configuration |
|---|---|---|
| AKS | `pisa-aks` | Azure CNI overlay, Cilium dataplane, managed identity |
| System pool | `system` | 1 x `Standard_D2s_v5`, Azure Linux |
| Sandbox pool | `sandbox` | 1 x `Standard_D4s_v3`, Azure Linux, `KataVmIsolation` |
| ACR | `pisasubstrate84acr` | Basic, admin authentication disabled |

The cluster pull role is scoped to the dedicated ACR. No subscription-wide role
is granted.

## Provision and verify

```bash
make aks-provision
make aks-verify
```

`aks-provision` refuses to adopt an existing cluster or sandbox pool with an
unexpected network/runtime profile. It uses `--no-ssh-key`, never requests an
admin kubeconfig, and writes the normal user credential only to the trusted
workstation's Kubernetes configuration with context `pisa-aks`. Kubeconfig
contents must never be printed, committed, mounted, or sent to actors.

`aks-verify` requires:

- the exact dedicated resource group, cluster, ACR, and node-pool names;
- `Succeeded` Azure provisioning state;
- Azure CNI overlay with the Cilium dataplane;
- one ready system node and one ready Kata-capable node;
- the `kata-vm-isolation` RuntimeClass;
- ACR admin authentication disabled.

No actor or broker service may use `LoadBalancer` or `NodePort`. Remote access
uses ClusterIP services plus trusted local `kubectl port-forward`.

## Runtime probes

The digest-pinned runtime probes verify the direct runc and AKS Kata placements:

```bash
make aks-runtime-probes
```

To intentionally rebuild the small scratch probe image:

```bash
make aks-runtime-probe-image
```

Update `deploy/aks/runtime-probes.yaml` and
`deploy/aks/kvm-probes.yaml` to the returned digest before applying it. The
build uses the dedicated local `pisa-local-builder`; it does not reuse another
project's buildx or Kubernetes builder.

The privileged KVM manifest is diagnostic only. Apply it temporarily, record
only sanitized device/API results, and remove the
`pi-substrate-diagnostics` namespace immediately afterward. It is not an actor
manifest.

## Remote actor proof

Build the amd64 harness image with the dedicated local buildx builder:

```bash
make aks-harness-image
```

The script pushes `pisa-harness:v1`, resolves its registry digest, and writes
the digest-pinned reference only to ignored
`.state/aks/harness-image.txt`. The Kubernetes manifest is rendered from that
reference; deployments never use a mutable tag.

Run the real remote proof from the trusted workstation:

```bash
npm run smoke:remote-actor
```

The smoke:

1. generates separate relay-actor, bridge-tunnel, trusted-job,
   relay-to-actor delivery, and local-broker capabilities in memory; the actor
   receives only a digest of the delivery bearer;
2. stops old POC deployments, deletes and recreates the capability Secrets
   without printing their values, and therefore removes stale data keys;
3. deploys the relay on the system pool and the actor under
   `kata-vm-isolation`;
4. reaches only the runc relay through loopback `kubectl port-forward`;
5. forwards authenticated job traffic from the relay to the Kata actor;
6. keeps model authentication in a trusted local broker connected by
   WebSocket through the same relay port-forward;
7. replays and tests the exact final patch in a fresh actor workspace before
   export, then recycles the one-job actor pod;
8. retests the returned patch in a no-network local container and commits only
   the prevalidated index in a disposable trusted repository;
9. disconnects the bridge and verifies that no patch can pass acceptance.

Direct `kubectl port-forward` to the Kata actor is intentionally not used. On
this runtime the kubelet attempts the guest service at pod-netns loopback and
receives connection refused; the actor is instead reachable only from the
relay over its pod IP. Both Kubernetes Services remain `ClusterIP`.

The one-node Kata pool can remain wedged after failed host-device sandbox
experiments. Confirm the known-good runtime probe before blaming the actor. If
the probe also times out, recycle only the dedicated POC user pool:

```bash
kubectl --context pisa-aks delete deployment pisa-remote-actor \
  --namespace pi-substrate --ignore-not-found --wait=true
kubectl --context pisa-aks delete pod pisa-probe-runc pisa-probe-kata \
  --namespace pi-substrate --ignore-not-found --wait=true
az aks nodepool scale --resource-group rg-pi-substrate-aks \
  --cluster-name pisa-aks --name sandbox --node-count 0
az aks nodepool scale --resource-group rg-pi-substrate-aks \
  --cluster-name pisa-aks --name sandbox --node-count 1
make aks-runtime-probes
```

This recovery applies only to the disposable `sandbox` pool in the dedicated
POC cluster.

## Teardown

The working POC is intentionally left running. The only supported teardown
deletes the exact dedicated resource group and requires an explicit guard:

```bash
PISA_CONFIRM_TEARDOWN=rg-pi-substrate-aks make aks-teardown
```

Do not use this command for any other resource group.
