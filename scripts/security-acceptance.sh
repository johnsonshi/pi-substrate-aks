#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${ROOT_DIR}/.state"
EVIDENCE_DIR="${ROOT_DIR}/evidence/security"
TEMP_EVIDENCE="${STATE_DIR}/security-acceptance.txt"

mkdir -p "${STATE_DIR}" "${EVIDENCE_DIR}"

{
  printf 'timestamp_utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'local_security_suite=START\n'
  npm --prefix "${ROOT_DIR}" run security:local
  printf 'local_security_suite=PASS\n'
  printf 'remote_security_probe=START\n'
  npm --prefix "${ROOT_DIR}" run security:remote
  printf 'remote_security_probe=PASS\n'
  printf 'PISA_SECURITY_ACCEPTANCE_OK\n'
} | tee "${TEMP_EVIDENCE}"

mv "${TEMP_EVIDENCE}" "${EVIDENCE_DIR}/acceptance.txt"
