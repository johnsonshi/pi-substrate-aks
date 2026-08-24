#!/usr/bin/env bash
set -euo pipefail

readonly RESOURCE_GROUP="rg-pi-substrate-aks"

if [[ "${PISA_CONFIRM_TEARDOWN:-}" != "${RESOURCE_GROUP}" ]]; then
  printf 'refusing teardown; set PISA_CONFIRM_TEARDOWN=%s\n' \
    "${RESOURCE_GROUP}" >&2
  exit 1
fi

if [[ "$(az group exists --name "${RESOURCE_GROUP}")" != "true" ]]; then
  printf 'dedicated resource group is already absent\n'
  exit 0
fi

az group delete \
  --name "${RESOURCE_GROUP}" \
  --yes \
  --no-wait \
  --only-show-errors

printf 'PISA_AKS_TEARDOWN_REQUESTED\n'
