#!/usr/bin/env bash
set -euo pipefail

readonly KUBE_CONTEXT="pisa-aks"
readonly UPSTREAM_DIR=".work/upstream/substrate"
readonly PIN_FILE="deploy/substrate/UPSTREAM_SHA"
readonly EVIDENCE_DIR="evidence/substrate-aks"
readonly EVIDENCE_FILE="${EVIDENCE_DIR}/preflight.txt"

expected_sha="$(tr -d '[:space:]' <"${PIN_FILE}")"
actual_sha="$(git -C "${UPSTREAM_DIR}" rev-parse HEAD)"
[[ "${actual_sha}" == "${expected_sha}" ]] || {
  printf 'pinned upstream checkout mismatch\n' >&2
  exit 1
}

api_resources="$(kubectl --context "${KUBE_CONTEXT}" api-resources -o name)"
has_pod_certificate_requests=false
has_cluster_trust_bundles=false
grep -Eq '^podcertificaterequests(\.|$)' <<<"${api_resources}" \
  && has_pod_certificate_requests=true
grep -Eq '^clustertrustbundles(\.|$)' <<<"${api_resources}" \
  && has_cluster_trust_bundles=true

probe="$(
  printf '%s\n' \
    'apiVersion: v1' \
    'kind: Pod' \
    'metadata:' \
    '  name: pisa-substrate-cert-api-probe' \
    '  namespace: default' \
    'spec:' \
    '  restartPolicy: Never' \
    '  containers:' \
    '  - name: probe' \
    '    image: registry.k8s.io/pause:3.10' \
    '    volumeMounts:' \
    '    - name: identity' \
    '      mountPath: /run/identity' \
    '  volumes:' \
    '  - name: identity' \
    '    projected:' \
    '      sources:' \
    '      - podCertificate:' \
    '          signerName: pisa.invalid/identity' \
    '          keyType: ECDSAP256' \
    '          credentialBundlePath: credential-bundle.pem' \
    '      - clusterTrustBundle:' \
    '          signerName: pisa.invalid/identity' \
    '          path: trust-bundle.pem' \
  | kubectl --context "${KUBE_CONTEXT}" apply \
      --dry-run=server \
      --validate=strict \
      -o json \
      -f - 2>/dev/null
)"

pod_certificate_projection_preserved="$(
  jq -r '
    [
      .spec.volumes[]?.projected.sources[]?
      | has("podCertificate")
    ]
    | any
  ' <<<"${probe}"
)"
cluster_trust_bundle_projection_preserved="$(
  jq -r '
    [
      .spec.volumes[]?.projected.sources[]?
      | has("clusterTrustBundle")
    ]
    | any
  ' <<<"${probe}"
)"

grep -q 'podcertificaterequests' \
  "${UPSTREAM_DIR}/manifests/ate-install/pod-certificate-controller.yaml"
grep -q 'clustertrustbundles' \
  "${UPSTREAM_DIR}/manifests/ate-install/pod-certificate-controller.yaml"
grep -q 'podCertificate:' \
  "${UPSTREAM_DIR}/manifests/ate-install/ate-api-server.yaml"
grep -q 'WithHostPath' \
  "${UPSTREAM_DIR}/cmd/atecontroller/internal/controllers/workerpool_apply.go"
grep -q '"SYS_ADMIN"' \
  "${UPSTREAM_DIR}/cmd/atecontroller/internal/controllers/workerpool_apply.go"

if [[
  "${has_pod_certificate_requests}" == "true" ||
  "${has_cluster_trust_bundles}" == "true" ||
  "${pod_certificate_projection_preserved}" == "true" ||
  "${cluster_trust_bundle_projection_preserved}" == "true"
]]; then
  printf 'AKS certificate API assumptions changed; review before continuing\n' >&2
  exit 1
fi

server_version="$(
  kubectl --context "${KUBE_CONTEXT}" version -o json \
    | jq -r '.serverVersion.gitVersion'
)"

mkdir -p "${EVIDENCE_DIR}"
{
  printf 'upstream_sha=%s\n' "${actual_sha}"
  printf 'kubernetes_server=%s\n' "${server_version}"
  printf 'pod_certificate_request_api=%s\n' "${has_pod_certificate_requests}"
  printf 'cluster_trust_bundle_api=%s\n' "${has_cluster_trust_bundles}"
  printf 'pod_certificate_projection_preserved=%s\n' \
    "${pod_certificate_projection_preserved}"
  printf 'cluster_trust_bundle_projection_preserved=%s\n' \
    "${cluster_trust_bundle_projection_preserved}"
  printf 'upstream_identity_api_dependency=confirmed\n'
  printf 'upstream_gvisor_host_path_dependency=confirmed\n'
  printf 'upstream_gvisor_sys_admin_dependency=confirmed\n'
  printf 'control_plane_install=BLOCKED\n'
  printf 'gvisor_worker_placement=BLOCKED\n'
  printf 'cluster_mutation=NONE\n'
  printf 'PISA_SUBSTRATE_AKS_PREFLIGHT_BLOCKED\n'
} >"${EVIDENCE_FILE}"

cat "${EVIDENCE_FILE}"
