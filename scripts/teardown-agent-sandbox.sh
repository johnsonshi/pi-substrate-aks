#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTEXT="pisa-aks"

if [[ "$(kubectl config current-context)" != "${CONTEXT}" ]]; then
  echo "Refusing Agent Sandbox teardown outside context ${CONTEXT}" >&2
  exit 1
fi

RENDERED_MANIFEST="$("${ROOT_DIR}/scripts/render-agent-sandbox.sh")"

kubectl --context "${CONTEXT}" delete namespace pi-agent-sandbox \
  --ignore-not-found --wait=true
kubectl --context "${CONTEXT}" delete --filename "${RENDERED_MANIFEST}" \
  --ignore-not-found --wait=true

echo "PISA_AGENT_SANDBOX_REMOVED"
