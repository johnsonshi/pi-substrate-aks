#!/usr/bin/env bash
set -euo pipefail

readonly RESOURCE_GROUP="rg-pi-substrate-aks"
readonly CLUSTER_NAME="pisa-aks"
readonly ACR_NAME="pisasubstrate84acr"
readonly LOCATION="${PISA_AKS_LOCATION:-westus2}"
readonly KUBERNETES_VERSION="${PISA_KUBERNETES_VERSION:-1.35}"
readonly SYSTEM_POOL="system"
readonly SANDBOX_POOL="sandbox"
readonly KUBE_CONTEXT="pisa-aks"

for command in az kubectl; do
  command -v "${command}" >/dev/null || {
    printf 'missing required command: %s\n' "${command}" >&2
    exit 1
  }
done

account_state="$(az account show --query state -o tsv)"
if [[ "${account_state}" != "Enabled" ]]; then
  printf 'Azure account is not enabled\n' >&2
  exit 1
fi

if [[ "$(az group exists --name "${RESOURCE_GROUP}")" != "true" ]]; then
  az group create \
    --name "${RESOURCE_GROUP}" \
    --location "${LOCATION}" \
    --tags purpose=pi-substrate-aks \
    --only-show-errors \
    --query '{name:name,location:location,provisioningState:properties.provisioningState}' \
    -o json
fi

if ! az acr show \
  --name "${ACR_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --only-show-errors >/dev/null 2>&1; then
  az acr create \
    --name "${ACR_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --location "${LOCATION}" \
    --sku Basic \
    --admin-enabled false \
    --tags purpose=pi-substrate-aks \
    --only-show-errors \
    --query '{name:name,sku:sku.name,adminUserEnabled:adminUserEnabled,provisioningState:provisioningState}' \
    -o json
fi

if ! az aks show \
  --name "${CLUSTER_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --only-show-errors >/dev/null 2>&1; then
  az aks create \
    --name "${CLUSTER_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --location "${LOCATION}" \
    --kubernetes-version "${KUBERNETES_VERSION}" \
    --nodepool-name "${SYSTEM_POOL}" \
    --node-count 1 \
    --node-vm-size Standard_D2s_v5 \
    --os-sku AzureLinux \
    --max-pods 30 \
    --network-plugin azure \
    --network-plugin-mode overlay \
    --pod-cidr 192.168.0.0/16 \
    --service-cidr 10.2.0.0/16 \
    --dns-service-ip 10.2.0.10 \
    --network-dataplane cilium \
    --enable-managed-identity \
    --attach-acr "${ACR_NAME}" \
    --tier free \
    --no-ssh-key \
    --tags purpose=pi-substrate-aks \
    --only-show-errors \
    --query '{name:name,location:location,kubernetesVersion:kubernetesVersion,provisioningState:provisioningState}' \
    -o json
else
  network_profile="$(az aks show \
    --name "${CLUSTER_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --query "join('|', [networkProfile.networkPlugin,networkProfile.networkPluginMode,networkProfile.networkDataplane])" \
    -o tsv)"
  if [[ "${network_profile}" != "azure|overlay|cilium" ]]; then
    printf 'existing POC cluster has an unexpected network profile: %s\n' \
      "${network_profile}" >&2
    exit 1
  fi
fi

if ! az aks nodepool show \
  --name "${SANDBOX_POOL}" \
  --cluster-name "${CLUSTER_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --only-show-errors >/dev/null 2>&1; then
  az aks nodepool add \
    --name "${SANDBOX_POOL}" \
    --cluster-name "${CLUSTER_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --node-count 1 \
    --node-vm-size Standard_D4s_v3 \
    --os-sku AzureLinux \
    --workload-runtime KataVmIsolation \
    --mode User \
    --max-pods 30 \
    --labels pisa-runtime=kata \
    --tags purpose=pi-substrate-aks \
    --only-show-errors \
    --query '{name:name,vmSize:vmSize,osSku:osSku,workloadRuntime:workloadRuntime,provisioningState:provisioningState}' \
    -o json
else
  sandbox_profile="$(az aks nodepool show \
    --name "${SANDBOX_POOL}" \
    --cluster-name "${CLUSTER_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --query "join('|', [vmSize,osSku,workloadRuntime])" \
    -o tsv)"
  if [[ "${sandbox_profile}" != "Standard_D4s_v3|AzureLinux|KataVmIsolation" ]]; then
    printf 'existing sandbox pool has an unexpected profile: %s\n' \
      "${sandbox_profile}" >&2
    exit 1
  fi
fi

az aks wait \
  --name "${CLUSTER_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --updated \
  --interval 15 \
  --timeout 1800

az aks get-credentials \
  --name "${CLUSTER_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --context "${KUBE_CONTEXT}" \
  --overwrite-existing \
  --only-show-errors >/dev/null

kubectl --context "${KUBE_CONTEXT}" get --raw=/readyz >/dev/null
printf 'PISA_AKS_PROVISIONED\n'
