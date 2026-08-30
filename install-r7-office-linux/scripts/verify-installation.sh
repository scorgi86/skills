#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$SCRIPT_DIR/lib/common.sh"
. "$SCRIPT_DIR/lib/json.sh"
. "$SCRIPT_DIR/lib/state.sh"

RUN_ID=
STATE_DIR=
BACKEND=
PACKAGE_NAME=r7-office
BINARY=/opt/r7-office/desktopeditors/DesktopEditors

while [ "$#" -gt 0 ]; do
    case "$1" in
        --run-id) RUN_ID="$2"; shift 2 ;;
        --state-dir) STATE_DIR="$2"; shift 2 ;;
        --backend) BACKEND="$2"; shift 2 ;;
        --package-name) PACKAGE_NAME="$2"; shift 2 ;;
        --binary) BINARY="$2"; shift 2 ;;
        *) die 30 "Unknown argument: $1" ;;
    esac
done

validate_run_id "$RUN_ID"
ensure_state_dir "$STATE_DIR" false
case "$BACKEND" in apt|dnf|zypper|yum) ;; *) die 20 "Unsupported backend: $BACKEND" ;; esac
. "$SCRIPT_DIR/lib/backends/$BACKEND.sh"

WARNINGS=()
PACKAGE_STATUS=not-installed
PACKAGE_VERSION=unknown
if QUERY=$(backend_query_installed "$PACKAGE_NAME" 2>/dev/null); then
    PACKAGE_STATUS=installed
    PACKAGE_VERSION=$(printf '%s\n' "$QUERY" | tail -n 1 | awk -F'\t' '{print $NF}')
fi

DATABASE_STATUS=healthy
if ! backend_audit; then
    DATABASE_STATUS=needs-attention
    WARNINGS+=("package-database-needs-attention")
fi

BINARY_STATUS=missing
MISSING_LIBRARIES=()
PROVIDER_RESULTS=()
LDD_LOG="$STATE_DIR/logs/ldd.txt"
: >"$LDD_LOG"
if [ -x "$BINARY" ]; then
    BINARY_STATUS=executable
    if command -v ldd >/dev/null 2>&1; then
        ldd "$BINARY" >"$LDD_LOG" 2>&1 || true
        while IFS= read -r library; do
            [ -n "$library" ] || continue
            MISSING_LIBRARIES+=("$library")
            PROVIDER_RESULTS+=("$library=$(backend_find_provider "$library")")
        done < <(awk '/not found/ {print $1}' "$LDD_LOG" | sort -u)
    else
        WARNINGS+=("ldd-unavailable")
    fi
else
    WARNINGS+=("main-binary-missing")
fi

DESKTOP_COUNT=$(find /usr/share/applications -maxdepth 1 -type f -iname '*r7*desktop*' 2>/dev/null | wc -l)
DISPLAY_READY=false
if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then DISPLAY_READY=true; fi

STATUS=success
EXIT_CODE=0
if [ "$PACKAGE_STATUS" != installed ] || [ "$DATABASE_STATUS" != healthy ] ||
    [ "$BINARY_STATUS" != executable ] || [ "${#MISSING_LIBRARIES[@]}" -gt 0 ]; then
    STATUS=verification-failed
    EXIT_CODE=50
fi

OUTPUT="$STATE_DIR/verification.json"
assert_output_safe "$OUTPUT"
CONTENT=$(cat <<EOF
{
  "schema_version": 1,
  "run_id": $(json_string "$RUN_ID"),
  "stage": "verify",
  "status": $(json_string "$STATUS"),
  "package": {
    "name": $(json_string "$PACKAGE_NAME"),
    "state": $(json_string "$PACKAGE_STATUS"),
    "version": $(json_string "$PACKAGE_VERSION")
  },
  "package_database": $(json_string "$DATABASE_STATUS"),
  "binary": {"path": $(json_string "$BINARY"), "state": $(json_string "$BINARY_STATUS")},
  "missing_libraries": $(json_array "${MISSING_LIBRARIES[@]}"),
  "provider_results": $(json_array "${PROVIDER_RESULTS[@]}"),
  "desktop_entries": $DESKTOP_COUNT,
  "display_ready": $(json_bool "$DISPLAY_READY"),
  "warnings": $(json_array "${WARNINGS[@]}"),
  "required_approvals": [],
  "next_actions": [],
  "logs": {"ldd": "logs/ldd.txt"}
}
EOF
)
json_write_atomic "$OUTPUT" "$CONTENT" || die 70 "Cannot write verification result"
log "Verification result: $OUTPUT"
exit "$EXIT_CODE"
