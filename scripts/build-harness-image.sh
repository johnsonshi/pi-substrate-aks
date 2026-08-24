#!/usr/bin/env bash
set -euo pipefail

readonly RESOURCE_GROUP="rg-pi-substrate-aks"
readonly ACR_NAME="pisasubstrate84acr"
readonly IMAGE_REPOSITORY="pisa-harness"
readonly IMAGE_TAG="v1"
readonly IMAGE="${ACR_NAME}.azurecr.io/${IMAGE_REPOSITORY}:${IMAGE_TAG}"
readonly BUILDER_NAME="pisa-local-builder"
readonly STATE_DIRECTORY=".state/aks"
readonly IMAGE_FILE="${STATE_DIRECTORY}/harness-image.txt"

for command in az docker; do
  command -v "${command}" >/dev/null || {
    printf 'missing required command: %s\n' "${command}" >&2
    exit 1
  }
done

az acr show \
  --name "${ACR_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --only-show-errors >/dev/null

az acr login --name "${ACR_NAME}" --only-show-errors >/dev/null

if ! docker buildx inspect "${BUILDER_NAME}" >/dev/null 2>&1; then
  docker buildx create \
    --name "${BUILDER_NAME}" \
    --driver docker-container >/dev/null
fi
docker buildx inspect "${BUILDER_NAME}" --bootstrap >/dev/null

docker buildx build \
  --builder "${BUILDER_NAME}" \
  --file deploy/aks/Dockerfile.harness \
  --platform linux/amd64 \
  --provenance=false \
  --push \
  --tag "${IMAGE}" \
  .

digest="$(az acr repository show \
  --name "${ACR_NAME}" \
  --image "${IMAGE_REPOSITORY}:${IMAGE_TAG}" \
  --query digest \
  -o tsv)"

[[ "${digest}" == sha256:* ]] || {
  printf 'harness image digest was not returned\n' >&2
  exit 1
}

mkdir -p "${STATE_DIRECTORY}"
printf '%s@%s\n' \
  "${ACR_NAME}.azurecr.io/${IMAGE_REPOSITORY}" \
  "${digest}" >"${IMAGE_FILE}"
chmod 600 "${IMAGE_FILE}"

printf 'PISA_HARNESS_IMAGE=%s@%s\n' \
  "${ACR_NAME}.azurecr.io/${IMAGE_REPOSITORY}" \
  "${digest}"
