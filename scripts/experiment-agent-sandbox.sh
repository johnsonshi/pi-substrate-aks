#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTEXT="pisa-aks"
NAMESPACE="pi-agent-sandbox"
SANDBOX="pisa-kata-lifecycle"
ACTOR_NAMESPACE="pi-substrate"
ACTOR_DEPLOYMENT="pisa-remote-actor"
EVIDENCE_DIR="${ROOT_DIR}/evidence/agent-sandbox"
EVIDENCE_TMP="${ROOT_DIR}/.state/agent-sandbox-result.txt"
original_actor_replicas=""

k() {
  kubectl --context "${CONTEXT}" "$@"
}

restore_actor() {
  if [[ -n "${original_actor_replicas}" ]]; then
    k scale deployment "${ACTOR_DEPLOYMENT}" \
      --namespace "${ACTOR_NAMESPACE}" \
      --replicas "${original_actor_replicas}" >/dev/null || true
    if [[ "${original_actor_replicas}" != "0" ]]; then
      k rollout status deployment "${ACTOR_DEPLOYMENT}" \
        --namespace "${ACTOR_NAMESPACE}" \
        --timeout=300s >/dev/null || true
    fi
  fi
}

suspend_probe() {
  k patch sandbox "${SANDBOX}" --namespace "${NAMESPACE}" \
    --type merge --patch '{"spec":{"operatingMode":"Suspended"}}' \
    >/dev/null 2>&1 || true
}

cleanup_on_exit() {
  suspend_probe
  restore_actor
}
trap cleanup_on_exit EXIT

"${ROOT_DIR}/scripts/install-agent-sandbox.sh" >/dev/null

original_actor_replicas="$(
  k get deployment "${ACTOR_DEPLOYMENT}" \
    --namespace "${ACTOR_NAMESPACE}" \
    -o jsonpath='{.spec.replicas}'
)"
k scale deployment "${ACTOR_DEPLOYMENT}" \
  --namespace "${ACTOR_NAMESPACE}" --replicas=0 >/dev/null
k wait pod --namespace "${ACTOR_NAMESPACE}" \
  --selector app.kubernetes.io/name=pisa-remote-actor \
  --for=delete --timeout=300s >/dev/null

k apply --filename "${ROOT_DIR}/deploy/agent-sandbox/lifecycle-probe.yaml" \
  >/dev/null
k wait sandbox/"${SANDBOX}" --namespace "${NAMESPACE}" \
  --for=condition=Ready --timeout=600s >/dev/null

pod_before="$(
  k get pods --namespace "${NAMESPACE}" \
    --selector app.kubernetes.io/name=pisa-agent-sandbox-probe \
    -o jsonpath='{.items[0].metadata.name}'
)"
uid_before="$(
  k get pod "${pod_before}" --namespace "${NAMESPACE}" \
    -o jsonpath='{.metadata.uid}'
)"
boot_before="$(
  k exec "${pod_before}" --namespace "${NAMESPACE}" -- \
    node -e 'process.stdout.write(require("node:fs").readFileSync("/tmp/boot-id", "utf8"))'
)"
marker="PISA_WORKSPACE_STATE_$(date -u '+%Y%m%dT%H%M%SZ')"
k exec "${pod_before}" --namespace "${NAMESPACE}" -- \
  node -e \
  'require("node:fs").writeFileSync("/workspace/lifecycle-state", process.argv[1], { mode: 0o600 })' \
  "${marker}"

security_probe="$(
  k exec "${pod_before}" --namespace "${NAMESPACE}" -- node -e '
    const { existsSync } = require("node:fs");
    const net = require("node:net");
    const connect = (host, port) => new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(1500);
      socket.once("connect", () => finish("reachable"));
      socket.once("error", () => finish("blocked"));
      socket.once("timeout", () => finish("blocked"));
    });
    Promise.all([
      connect("kubernetes.default.svc", 443),
      connect("169.254.169.254", 80),
      connect("1.1.1.1", 443),
    ]).then(([api, imds, internet]) => {
      const names = Object.keys(process.env).filter((name) =>
        /^(GITHUB|GH_|COPILOT|AZURE|ARM_|KUBECONFIG|MSI_|IDENTITY_)/i.test(name)
      );
      process.stdout.write(JSON.stringify({
        credentialEnvironmentNames: names.sort(),
        serviceAccountToken: existsSync(
          "/var/run/secrets/kubernetes.io/serviceaccount/token"
        ),
        connectivity: { api, imds, internet },
      }));
    });
  '
)"
node -e '
  const assert = require("node:assert/strict");
  const probe = JSON.parse(process.argv[1]);
  assert.deepEqual(probe, {
    credentialEnvironmentNames: [],
    serviceAccountToken: false,
    connectivity: {
      api: "blocked",
      imds: "blocked",
      internet: "blocked",
    },
  });
' "${security_probe}"

k patch sandbox "${SANDBOX}" --namespace "${NAMESPACE}" \
  --type merge --patch '{"spec":{"operatingMode":"Suspended"}}' >/dev/null
k wait sandbox/"${SANDBOX}" --namespace "${NAMESPACE}" \
  --for=condition=Suspended --timeout=300s >/dev/null
k wait pod --namespace "${NAMESPACE}" \
  --selector app.kubernetes.io/name=pisa-agent-sandbox-probe \
  --for=delete --timeout=300s >/dev/null

pvc_phase="$(
  k get pvc --namespace "${NAMESPACE}" \
    -o jsonpath='{.items[0].status.phase}'
)"
if [[ "${pvc_phase}" != "Bound" ]]; then
  echo "Sandbox workspace PVC was not retained while suspended" >&2
  exit 1
fi

k patch sandbox "${SANDBOX}" --namespace "${NAMESPACE}" \
  --type merge --patch '{"spec":{"operatingMode":"Running"}}' >/dev/null
k wait sandbox/"${SANDBOX}" --namespace "${NAMESPACE}" \
  --for=condition=Ready --timeout=600s >/dev/null

pod_after="$(
  k get pods --namespace "${NAMESPACE}" \
    --selector app.kubernetes.io/name=pisa-agent-sandbox-probe \
    -o jsonpath='{.items[0].metadata.name}'
)"
uid_after="$(
  k get pod "${pod_after}" --namespace "${NAMESPACE}" \
    -o jsonpath='{.metadata.uid}'
)"
boot_after="$(
  k exec "${pod_after}" --namespace "${NAMESPACE}" -- \
    node -e 'process.stdout.write(require("node:fs").readFileSync("/tmp/boot-id", "utf8"))'
)"
state_after="$(
  k exec "${pod_after}" --namespace "${NAMESPACE}" -- \
    node -e 'process.stdout.write(require("node:fs").readFileSync("/workspace/lifecycle-state", "utf8"))'
)"

if [[ "${uid_before}" == "${uid_after}" || "${boot_before}" == "${boot_after}" ]]; then
  echo "Sandbox resume did not create a fresh pod process" >&2
  exit 1
fi
if [[ "${state_after}" != "${marker}" ]]; then
  echo "Sandbox workspace state did not survive suspend/resume" >&2
  exit 1
fi

runtime_class="$(
  k get pod "${pod_after}" --namespace "${NAMESPACE}" \
    -o jsonpath='{.spec.runtimeClassName}'
)"
image_id="$(
  k get pod "${pod_after}" --namespace "${NAMESPACE}" \
    -o jsonpath='{.status.containerStatuses[0].imageID}'
)"
if [[ "${runtime_class}" != "kata-vm-isolation" ]]; then
  echo "Agent Sandbox pod did not use AKS Kata" >&2
  exit 1
fi

suspend_probe
k wait sandbox/"${SANDBOX}" --namespace "${NAMESPACE}" \
  --for=condition=Suspended --timeout=300s >/dev/null
k wait pod --namespace "${NAMESPACE}" \
  --selector app.kubernetes.io/name=pisa-agent-sandbox-probe \
  --for=delete --timeout=300s >/dev/null
restore_actor
original_actor_replicas=""
trap - EXIT

mkdir -p "${EVIDENCE_DIR}" "$(dirname "${EVIDENCE_TMP}")"
{
  printf 'timestamp_utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'upstream_release=v0.5.6\n'
  printf 'upstream_commit=211b7579cabed9460c1a692eb687084ff4c5879d\n'
  printf 'manifest_sha256=1696dbb6faded503149b3994badb599df5dcf24d5985466881784f442dd9c3e5\n'
  printf 'controller=Ready\n'
  printf 'runtime_class=%s\n' "${runtime_class}"
  printf 'image_id=%s\n' "${image_id}"
  printf 'credential_environment_names=NONE\n'
  printf 'service_account_token=false\n'
  printf 'kubernetes_api=blocked\n'
  printf 'imds=blocked\n'
  printf 'public_internet=blocked\n'
  printf 'suspend_condition=True\n'
  printf 'pod_released_while_suspended=true\n'
  printf 'pod_identity_changed_on_resume=true\n'
  printf 'process_state_restored=false\n'
  printf 'workspace_pvc_state_restored=true\n'
  printf 'final_operating_mode=Suspended\n'
  printf 'PISA_AGENT_SANDBOX_OK\n'
} | tee "${EVIDENCE_TMP}"
mv "${EVIDENCE_TMP}" "${EVIDENCE_DIR}/lifecycle.txt"
