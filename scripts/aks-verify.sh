#!/usr/bin/env bash
set -euo pipefail

readonly RESOURCE_GROUP="rg-pi-substrate-aks"
readonly CLUSTER_NAME="pisa-aks"
readonly ACR_NAME="pisasubstrate84acr"
readonly KUBE_CONTEXT="pisa-aks"

[[ "$(az group exists --name "${RESOURCE_GROUP}")" == "true" ]] || {
  printf 'dedicated resource group is missing\n' >&2
  exit 1
}

az aks wait \
  --name "${CLUSTER_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --updated \
  --interval 15 \
  --timeout 1800

cluster_profile="$(az aks show \
  --name "${CLUSTER_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query "join('|', [provisioningState,networkProfile.networkPlugin,networkProfile.networkPluginMode,networkProfile.networkDataplane])" \
  -o tsv)"
if [[ "${cluster_profile}" != "Succeeded|azure|overlay|cilium" ]]; then
  printf 'unexpected AKS profile: %s\n' "${cluster_profile}" >&2
  exit 1
fi

acr_profile="$(az acr show \
  --name "${ACR_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query "join('|', [provisioningState,sku.name,to_string(adminUserEnabled)])" \
  -o tsv)"
if [[ "${acr_profile}" != "Succeeded|Basic|false" ]]; then
  printf 'unexpected ACR profile: %s\n' "${acr_profile}" >&2
  exit 1
fi

system_profile="$(az aks nodepool show \
  --name system \
  --cluster-name "${CLUSTER_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query "join('|', [provisioningState,to_string(count),vmSize,osSku,mode])" \
  -o tsv)"
if [[ "${system_profile}" != "Succeeded|1|Standard_D2s_v5|AzureLinux|System" ]]; then
  printf 'unexpected system pool profile: %s\n' "${system_profile}" >&2
  exit 1
fi

sandbox_profile="$(az aks nodepool show \
  --name sandbox \
  --cluster-name "${CLUSTER_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query "join('|', [provisioningState,to_string(count),vmSize,osSku,workloadRuntime,mode])" \
  -o tsv)"
if [[ "${sandbox_profile}" != "Succeeded|1|Standard_D4s_v3|AzureLinux|KataVmIsolation|User" ]]; then
  printf 'unexpected sandbox pool profile: %s\n' "${sandbox_profile}" >&2
  exit 1
fi

az aks get-credentials \
  --name "${CLUSTER_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --context "${KUBE_CONTEXT}" \
  --overwrite-existing \
  --only-show-errors >/dev/null

kubectl --context "${KUBE_CONTEXT}" wait \
  --for=condition=Ready nodes --all --timeout=300s >/dev/null
kubectl --context "${KUBE_CONTEXT}" get \
  runtimeclass kata-vm-isolation >/dev/null

printf 'PISA_AKS_VERIFIED\n'
