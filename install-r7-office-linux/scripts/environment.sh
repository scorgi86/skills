#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/json.sh
. "$SCRIPT_DIR/lib/json.sh"
# shellcheck source=lib/state.sh
. "$SCRIPT_DIR/lib/state.sh"

RUN_ID=
STATE_DIR=

while [ "$#" -gt 0 ]; do
    case "$1" in
        --run-id) RUN_ID="$2"; shift 2 ;;
        --state-dir) STATE_DIR="$2"; shift 2 ;;
        *) die 30 "Unknown argument: $1" ;;
    esac
done

validate_run_id "$RUN_ID"
ensure_state_dir "$STATE_DIR" false
OUTPUT="$STATE_DIR/environment.json"
assert_output_safe "$OUTPUT"

OS_ID=unknown
OS_VERSION=unknown
if [ -r /etc/os-release ]; then
    OS_ID=$(sed -n 's/^ID=//p' /etc/os-release | head -n 1 | tr -d '"')
    OS_VERSION=$(sed -n 's/^VERSION_ID=//p' /etc/os-release | head -n 1 | tr -d '"')
fi

HOST_ARCH=$(normalize_arch "$(uname -m)")
KERNEL=$(uname -r)
IS_WSL=false
if grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null ||
    grep -qi microsoft /proc/version 2>/dev/null; then
    IS_WSL=true
fi

INIT_MANAGER=none
if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
    INIT_MANAGER=systemd
elif command -v rc-service >/dev/null 2>&1; then
    INIT_MANAGER=openrc
elif command -v service >/dev/null 2>&1; then
    INIT_MANAGER=sysv
fi

BACKENDS=()
for candidate in apt dnf zypper yum; do
    if [ "$candidate" = apt ]; then
        command -v apt-get >/dev/null 2>&1 || command -v apt >/dev/null 2>&1 || continue
    elif ! command -v "$candidate" >/dev/null 2>&1; then
        continue
    fi
    BACKENDS+=("$candidate")
done

SELECTED_BACKEND=${BACKENDS[0]:-none}
CACHE_STATUS=unavailable
PACKAGE_DB_STATUS=unknown
if [ "$SELECTED_BACKEND" != none ]; then
    # shellcheck disable=SC1090
    . "$SCRIPT_DIR/lib/backends/$SELECTED_BACKEND.sh"
    if backend_check_cache; then CACHE_STATUS=available; else CACHE_STATUS=missing; fi
    if backend_audit; then PACKAGE_DB_STATUS=healthy; else PACKAGE_DB_STATUS=needs-attention; fi
fi

DISPLAY_READY=false
if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then DISPLAY_READY=true; fi

FREE_KB=$(df -Pk / | awk 'NR == 2 {print $4}')
READ_ELF=false
if command -v readelf >/dev/null 2>&1 || command -v objdump >/dev/null 2>&1; then READ_ELF=true; fi

CONTENT=$(cat <<EOF
{
  "schema_version": 1,
  "run_id": $(json_string "$RUN_ID"),
  "stage": "environment",
  "status": "success",
  "os": {
    "id": $(json_string "$OS_ID"),
    "version": $(json_string "$OS_VERSION"),
    "architecture": $(json_string "$HOST_ARCH"),
    "kernel": $(json_string "$KERNEL")
  },
  "wsl": $(json_bool "$IS_WSL"),
  "init_manager": $(json_string "$INIT_MANAGER"),
  "backends": $(json_array "${BACKENDS[@]}"),
  "selected_backend": $(json_string "$SELECTED_BACKEND"),
  "metadata_cache": $(json_string "$CACHE_STATUS"),
  "package_database": $(json_string "$PACKAGE_DB_STATUS"),
  "display_ready": $(json_bool "$DISPLAY_READY"),
  "elf_inspector_available": $(json_bool "$READ_ELF"),
  "free_space_kb": $FREE_KB,
  "warnings": [],
  "required_approvals": [],
  "next_actions": ["inspect-package"],
  "logs": {}
}
EOF
)

json_write_atomic "$OUTPUT" "$CONTENT" || die 70 "Cannot write environment result"
log "Environment result: $OUTPUT"
