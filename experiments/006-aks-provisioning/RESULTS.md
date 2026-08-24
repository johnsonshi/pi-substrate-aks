# Experiment 006: Dedicated AKS provisioning

## Metadata

- Date: 2026-08-24
- Local baseline commit: `be4f127`
- Resource group: `rg-pi-substrate-aks`
- AKS: `pisa-aks`
- Location: `westus2`
- Kubernetes: `1.35`

## Question

Can the POC create a minimal, dedicated, reproducible AKS topology with a Kata
node pool and enforceable Cilium networking without touching pre-existing Azure
resources or introducing actor credentials?

## Commands

```bash
make aks-provision
make aks-verify
```

The provision command was run a second time to exercise its existing-resource
validation path.

## Result

**PASS**

The exact dedicated resource group contains:

- one-node Azure Linux system pool on `Standard_D2s_v5`;
- one-node Azure Linux user pool on `Standard_D4s_v3` with
  `KataVmIsolation`;
- AKS `1.35` using Azure CNI overlay and the Cilium dataplane;
- a system-assigned AKS managed identity;
- a Basic dedicated ACR with admin authentication disabled.

Both nodes became Ready, the `kata-vm-isolation` RuntimeClass resolved to the
`kata` handler, and the cluster contained zero LoadBalancer services. The
second provision run returned `PISA_AKS_PROVISIONED`; the independent verifier
returned `PISA_AKS_VERIFIED`.

## Security boundary

The scripts use only the exact `rg-pi-substrate-aks` scope and `pisa-*`
resource names. The AKS identity receives pull access only to the dedicated
ACR. No SSH key was generated, no admin kubeconfig was requested, and no
kubeconfig content or Azure identifier is retained as evidence.

The cluster API credential remains on the trusted workstation. Actors will use
dedicated service accounts with token automount disabled and receive no Azure,
GitHub, Copilot, kubeconfig, or workstation credential.

## Evidence

- `scripts/aks-provision.sh`
- `scripts/aks-verify.sh`
- `scripts/aks-teardown.sh`
- `deploy/aks/README.md`
- `evidence/aks-provisioning/topology.txt`

## Remaining work

- Run a credential-free Kata pod and network/identity denial probes.
- Test KVM visibility and each Substrate placement.
- Attempt the pinned Substrate control plane on AKS.
- Build and deploy the credential-free Pi actor image.
