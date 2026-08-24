#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN_FILE="${ROOT_DIR}/deploy/agent-sandbox/PINNED_VERSION"

pin_value() {
  awk -F= -v key="$1" '
    $1 == key {
      print substr($0, length(key) + 2)
      found = 1
    }
    END {
      if (!found) exit 1
    }
  ' "${PIN_FILE}"
}

RELEASE="$(pin_value RELEASE)"
MANIFEST_NAME="$(pin_value MANIFEST)"
MANIFEST_SHA256="$(pin_value MANIFEST_SHA256)"
RELEASE_URL="https://github.com/kubernetes-sigs/agent-sandbox/releases/download/${RELEASE}/${MANIFEST_NAME}"
WORK_DIR="${ROOT_DIR}/.work/agent-sandbox"
SOURCE_MANIFEST="${WORK_DIR}/${MANIFEST_NAME}"
RENDERED_MANIFEST="${WORK_DIR}/pisa-rendered.yaml"

mkdir -p "${WORK_DIR}"
curl --proto '=https' --tlsv1.2 --retry 3 --fail --silent --show-error \
  --location "${RELEASE_URL}" --output "${SOURCE_MANIFEST}.tmp"

actual_sha="$(shasum -a 256 "${SOURCE_MANIFEST}.tmp" | awk '{print $1}')"
if [[ "${actual_sha}" != "${MANIFEST_SHA256}" ]]; then
  echo "Agent Sandbox manifest digest mismatch" >&2
  rm -f "${SOURCE_MANIFEST}.tmp"
  exit 1
fi
mv "${SOURCE_MANIFEST}.tmp" "${SOURCE_MANIFEST}"

kubectl kustomize "${ROOT_DIR}/deploy/agent-sandbox/overlay" \
  --load-restrictor LoadRestrictionsNone \
  --output "${RENDERED_MANIFEST}.tmp"
mv "${RENDERED_MANIFEST}.tmp" "${RENDERED_MANIFEST}"
printf '%s\n' "${RENDERED_MANIFEST}"
