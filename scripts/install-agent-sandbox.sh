#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTEXT="pisa-aks"
PIN_FILE="${ROOT_DIR}/deploy/agent-sandbox/PINNED_VERSION"
RELEASE="$(awk -F= '$1 == "RELEASE" { print $2 }' "${PIN_FILE}")"
MANIFEST_SHA256="$(
  awk -F= '$1 == "MANIFEST_SHA256" { print $2 }' "${PIN_FILE}"
)"

if [[ "$(kubectl config current-context)" != "${CONTEXT}" ]]; then
  echo "Refusing Agent Sandbox install outside context ${CONTEXT}" >&2
  exit 1
fi

RENDERED_MANIFEST="$("${ROOT_DIR}/scripts/render-agent-sandbox.sh")"

kubectl --context "${CONTEXT}" apply --dry-run=client \
  --filename "${RENDERED_MANIFEST}" >/dev/null
kubectl --context "${CONTEXT}" apply --filename "${RENDERED_MANIFEST}"
kubectl --context "${CONTEXT}" rollout status \
  deployment/agent-sandbox-controller \
  --namespace agent-sandbox-system \
  --timeout=300s

controller_security="$(
  kubectl --context "${CONTEXT}" get deployment agent-sandbox-controller \
    --namespace agent-sandbox-system \
    -o 'jsonpath={.spec.template.spec.securityContext.runAsNonRoot}{" "}{.spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation}{" "}{.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem}{" "}{.spec.template.spec.containers[0].securityContext.capabilities.drop[0]}'
)"
if [[ "${controller_security}" != "true false true ALL" ]]; then
  echo "Agent Sandbox controller hardening assertion failed" >&2
  exit 1
fi

printf 'agent_sandbox_release=%s\n' "${RELEASE}"
printf 'manifest_sha256=%s\n' "${MANIFEST_SHA256}"
printf 'controller_security=restricted\n'
printf 'PISA_AGENT_SANDBOX_INSTALLED\n'
