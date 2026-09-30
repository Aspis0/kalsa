#!/usr/bin/env bash
# terminate_pod.sh — end BILLING for this pod by terminating (deleting) it.
# Responsibility: this one action, with layered fallbacks.
#
# Facts used:
#   - Runpod REST API reference (docs.runpod.io/api-reference/pods/DELETE/pods/podId,
#     read 2026-09-30): "DELETE /pods/{podId}", base "https://rest.runpod.io/v1",
#     security scheme http/bearer → "Authorization: Bearer <api-key>";
#     responses 204 "Pod successfully deleted.", 400 "Invalid Pod ID.",
#     401 "Unauthorized." The page states nothing about key scoping, so
#     UNVERIFIED: whether the pod-scoped RUNPOD_API_KEY injected into the pod
#     is allowed to terminate its own pod. That is exactly why this script is
#     only the best-effort stop — the real one is `--terminate-after` at pod
#     creation (deletes the pod; `--stop-after` would keep disk billing).
#   - The control REST is v1-only (rest.runpod.io/v1); api.runpod.ai/v2 is the
#     SERVERLESS runtime API, not pod control (runpodctl skill, SKILL.md:134).
#     The old api.runpod.ai/v2/pods + x-api-key call hit the wrong API family.
#   - Terminate, not stop, ends billing: the pod's own volume disk is
#     "deleted when the pod is terminated" (runpod-usage skill,
#     reference/storage.md:32; same statement on docs.runpod.io/pods/storage).
set -uo pipefail

log() { echo "terminate_pod: $*" >&2; }

if [ -z "${RUNPOD_POD_ID:-}" ]; then
  log "RUNPOD_POD_ID not set — not on a Runpod pod (local dry-run); skipping."
  exit 0
fi

hdr=""
if [ -n "${RUNPOD_API_KEY:-}" ]; then
  # header via file so the key never appears in argv/ps
  hdr=$(mktemp) && chmod 600 "$hdr" \
    && printf 'Authorization: Bearer %s\n' "$RUNPOD_API_KEY" > "$hdr"
  code=$(curl -s -o /tmp/term-pod.json -w '%{http_code}' --max-time 30 \
    -X DELETE "https://rest.runpod.io/v1/pods/${RUNPOD_POD_ID}" \
    -H @"$hdr" || echo 000)
  rm -f "$hdr"
  log "REST DELETE /v1/pods/${RUNPOD_POD_ID} -> HTTP $code $(head -c 200 /tmp/term-pod.json 2>/dev/null)"
  case "$code" in
    200|204) exit 0 ;;
  esac
fi

if command -v runpodctl >/dev/null 2>&1 && [ -n "${RUNPOD_API_KEY:-}" ]; then
  # runpodctl resolves RUNPOD_API_KEY from the env itself; `pod delete`
  # (aliases rm/remove) targets the v1 control plane
  log "REST failed — trying runpodctl pod delete"
  runpodctl pod delete "$RUNPOD_POD_ID" && exit 0
fi
log "no API key result and no runpodctl — last resort: poweroff"
poweroff || shutdown -h now
exit 1
