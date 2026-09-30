#!/usr/bin/env bash
# terminate_pod.sh — end BILLING for this pod by terminating it.
# Responsibility: this one action, with layered fallbacks.
#
# Facts used (quoted in REPORT.md §1):
#   - Runpod predefines RUNPOD_POD_ID and RUNPOD_API_KEY in every pod
#     (docs.runpod.io/pods/templates/manage-templates).
#   - Terminate, not stop, is what ends billing: "Terminating permanently
#     deletes all data not stored in a network volume" and volume disk is
#     "deleted when the Pod is terminated" (docs.runpod.io/pods/manage-pods,
#     docs.runpod.io/pods/storage).
#   - REST: DELETE https://api.runpod.ai/v2/pods/{podId} with x-api-key.
set -uo pipefail

log() { echo "terminate_pod: $*" >&2; }

if [ -z "${RUNPOD_POD_ID:-}" ]; then
  log "RUNPOD_POD_ID not set — not on a Runpod pod (local dry-run); skipping."
  exit 0
fi

if [ -n "${RUNPOD_API_KEY:-}" ]; then
  code=$(curl -s -o /tmp/term-pod.json -w '%{http_code}' --max-time 30 \
    -X DELETE "https://api.runpod.ai/v2/pods/${RUNPOD_POD_ID}" \
    -H "x-api-key: ${RUNPOD_API_KEY}" || echo 000)
  log "REST DELETE -> HTTP $code $(head -c 200 /tmp/term-pod.json 2>/dev/null)"
  case "$code" in
    200|204) exit 0 ;;
  esac
fi

if command -v runpodctl >/dev/null 2>&1; then
  runpodctl remove pod "$RUNPOD_POD_ID" && exit 0
  runpodctl pod delete "$RUNPOD_POD_ID" && exit 0   # newer syntax
fi
log "no API key result and no runpodctl — last resort: poweroff"
poweroff || shutdown -h now
exit 1
