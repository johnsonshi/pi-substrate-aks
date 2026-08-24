#!/usr/bin/env bash
set -euo pipefail

readonly KUBE_CONTEXT="pisa-aks"
readonly NAMESPACE="pi-substrate"
readonly MANIFEST="deploy/aks/runtime-probes.yaml"
readonly RUNC_POD="pisa-probe-runc"
readonly KATA_POD="pisa-probe-kata"

kubectl --context "${KUBE_CONTEXT}" delete pod \
  --namespace "${NAMESPACE}" \
  "${RUNC_POD}" "${KATA_POD}" \
  --ignore-not-found \
  --wait=true >/dev/null

kubectl --context "${KUBE_CONTEXT}" apply -f "${MANIFEST}" >/dev/null

for pod in "${RUNC_POD}" "${KATA_POD}"; do
  kubectl --context "${KUBE_CONTEXT}" wait \
    --namespace "${NAMESPACE}" \
    --for=jsonpath='{.status.phase}'=Succeeded \
    "pod/${pod}" \
    --timeout=300s >/dev/null
done

runc_result="$(kubectl --context "${KUBE_CONTEXT}" logs \
  --namespace "${NAMESPACE}" "${RUNC_POD}")"
kata_result="$(kubectl --context "${KUBE_CONTEXT}" logs \
  --namespace "${NAMESPACE}" "${KATA_POD}")"

for result in "${runc_result}" "${kata_result}"; do
  jq -e '
    .userId == 65532 and
    (.credentialEnvironmentNames | length == 0) and
    .serviceAccountTokenPresent == false and
    .kvmDevicePresent == false and
    .kvmApiVersion == 0 and
    ([.pathPresent[]] | all(. == false)) and
    ([.connectivity[]] | all(. == "blocked"))
  ' <<<"${result}" >/dev/null
done

runc_kernel="$(jq -r '.kernelRelease' <<<"${runc_result}")"
kata_kernel="$(jq -r '.kernelRelease' <<<"${kata_result}")"
[[ "${runc_kernel}" != "${kata_kernel}" ]] || {
  printf 'Kata and runc probes reported the same kernel\n' >&2
  exit 1
}

runtime_class="$(kubectl --context "${KUBE_CONTEXT}" get \
  --namespace "${NAMESPACE}" "pod/${KATA_POD}" \
  -o jsonpath='{.spec.runtimeClassName}')"
[[ "${runtime_class}" == "kata-vm-isolation" ]] || {
  printf 'Kata probe did not use the required RuntimeClass\n' >&2
  exit 1
}

printf 'runc=%s\n' "${runc_result}"
printf 'kata=%s\n' "${kata_result}"
printf 'PISA_RUNTIME_PROBES_OK\n'
