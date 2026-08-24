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

## Teardown

The working POC is intentionally left running. The only supported teardown
deletes the exact dedicated resource group and requires an explicit guard:

```bash
PISA_CONFIRM_TEARDOWN=rg-pi-substrate-aks make aks-teardown
```

Do not use this command for any other resource group.
