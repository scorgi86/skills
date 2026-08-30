#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$SCRIPT_DIR/lib/common.sh"
. "$SCRIPT_DIR/lib/json.sh"
. "$SCRIPT_DIR/lib/state.sh"

RUN_ID=
STATE_DIR=
PACKAGE=

while [ "$#" -gt 0 ]; do
    case "$1" in
        --run-id) RUN_ID="$2"; shift 2 ;;
        --state-dir) STATE_DIR="$2"; shift 2 ;;
        --package) PACKAGE="$2"; shift 2 ;;
        *) die 30 "Unknown argument: $1" ;;
    esac
done

validate_run_id "$RUN_ID"
ensure_state_dir "$STATE_DIR" false
is_regular_file_without_symlink "$PACKAGE" || die 30 "Package must be a regular non-symlink file"

OUTPUT="$STATE_DIR/package.json"
assert_output_safe "$OUTPUT"
SHA256=$(sha256_file "$PACKAGE")
HOST_ARCH=$(normalize_arch "$(uname -m)")
FORMAT=unknown
NAME=unknown
VERSION=unknown
ARCH=unknown
AUTHENTICITY=not-verified
SCRIPTS_FILE="$STATE_DIR/evidence/package-scripts.txt"
FILES_FILE="$STATE_DIR/evidence/package-files.txt"
: >"$SCRIPTS_FILE"
: >"$FILES_FILE"

if command -v dpkg-deb >/dev/null 2>&1 && dpkg-deb --info "$PACKAGE" >/dev/null 2>&1; then
    FORMAT=deb
    NAME=$(dpkg-deb -f "$PACKAGE" Package)
    VERSION=$(dpkg-deb -f "$PACKAGE" Version)
    ARCH=$(normalize_arch "$(dpkg-deb -f "$PACKAGE" Architecture)")
    dpkg-deb -c "$PACKAGE" >"$FILES_FILE"
    CONTROL_DIR="$STATE_DIR/evidence/deb-control-$SHA256"
    if [ ! -d "$CONTROL_DIR" ]; then
        mkdir -m 0700 -- "$CONTROL_DIR"
        dpkg-deb -e "$PACKAGE" "$CONTROL_DIR"
    fi
    for script in preinst postinst prerm postrm; do
        if [ -f "$CONTROL_DIR/$script" ]; then
            printf '\n===== %s =====\n' "$script" >>"$SCRIPTS_FILE"
            sed -n '1,400p' "$CONTROL_DIR/$script" >>"$SCRIPTS_FILE"
        fi
    done
    append_deb_service_units "$PACKAGE" "$SCRIPTS_FILE"
    if command -v debsig-verify >/dev/null 2>&1 && debsig-verify "$PACKAGE" >/dev/null 2>&1; then
        AUTHENTICITY=verified
    elif command -v dpkg-sig >/dev/null 2>&1 && dpkg-sig --verify "$PACKAGE" 2>/dev/null | grep -q 'GOODSIG'; then
        AUTHENTICITY=verified
    else
        AUTHENTICITY=unsigned-or-unverified
    fi
elif command -v rpm >/dev/null 2>&1 && rpm -qp "$PACKAGE" >/dev/null 2>&1; then
    FORMAT=rpm
    NAME=$(rpm -qp --qf '%{NAME}' "$PACKAGE")
    VERSION=$(rpm -qp --qf '%{VERSION}-%{RELEASE}' "$PACKAGE")
    ARCH=$(normalize_arch "$(rpm -qp --qf '%{ARCH}' "$PACKAGE")")
    rpm -qpl "$PACKAGE" >"$FILES_FILE"
    rpm -qp --scripts "$PACKAGE" >"$SCRIPTS_FILE"
    append_rpm_service_units "$PACKAGE" "$SCRIPTS_FILE"
    if command -v rpmkeys >/dev/null 2>&1 && rpmkeys --checksig "$PACKAGE" 2>&1 | grep -qi 'digests signatures.*ok\|signatures.*ok'; then
        AUTHENTICITY=verified
    else
        AUTHENTICITY=unsigned-or-unverified
    fi
fi

if [ "$FORMAT" = unknown ]; then
    CONTENT=$(cat <<EOF
{
  "schema_version": 1,
  "run_id": $(json_string "$RUN_ID"),
  "stage": "inspect-package",
  "status": "unsupported",
  "package": {"path": $(json_string "$PACKAGE"), "sha256": $(json_string "$SHA256"), "format": "unknown"},
  "warnings": ["unsupported-package-format"],
  "required_approvals": [],
  "next_actions": [],
  "logs": {"scripts": "evidence/package-scripts.txt", "files": "evidence/package-files.txt"}
}
EOF
)
    json_write_atomic "$OUTPUT" "$CONTENT"
    exit 20
fi

APPROVALS=()
WARNINGS=()
CLASSIFICATION=known-safe

if [ "$AUTHENTICITY" != verified ]; then
    APPROVALS+=("trust-unsigned-package")
fi
if grep -Eqi 'security\.exec_id|setfattr[[:space:]].*-x' "$SCRIPTS_FILE"; then
    APPROVALS+=("remove-security-exec-id")
fi
if grep -Eqi 'systemctl[[:space:]]+enable|update-rc\.d.*enable|rc-update[[:space:]]+add' "$SCRIPTS_FILE"; then
    APPROVALS+=("enable-r7-service")
fi
if grep -Eqi '(^|[;&|[:space:]])(eval|sudo|useradd|adduser|visudo|iptables|nft)[[:space:]]|/etc/sudoers|curl[^|]*\|[[:space:]]*(sh|bash)|wget[^|]*\|[[:space:]]*(sh|bash)' "$SCRIPTS_FILE"; then
    CLASSIFICATION=unknown-privileged
    WARNINGS+=("unknown-privileged-package-script")
fi

COMPATIBLE=true
if [ "$ARCH" != all ] && [ "$ARCH" != noarch ] && [ "$ARCH" != "$HOST_ARCH" ]; then
    COMPATIBLE=false
    WARNINGS+=("architecture-mismatch")
fi

STATUS=success
NEXT=("check-readiness")
EXIT_CODE=0
if [ "$COMPATIBLE" = false ] || [ "$CLASSIFICATION" = unknown-privileged ]; then
    STATUS=prerequisite-failed
    NEXT=()
    EXIT_CODE=30
elif [ "${#APPROVALS[@]}" -gt 0 ]; then
    STATUS=approval-required
    NEXT=("request-approval")
    EXIT_CODE=10
fi

CONTENT=$(cat <<EOF
{
  "schema_version": 1,
  "run_id": $(json_string "$RUN_ID"),
  "stage": "inspect-package",
  "status": $(json_string "$STATUS"),
  "package": {
    "path": $(json_string "$PACKAGE"),
    "sha256": $(json_string "$SHA256"),
    "format": $(json_string "$FORMAT"),
    "name": $(json_string "$NAME"),
    "version": $(json_string "$VERSION"),
    "architecture": $(json_string "$ARCH"),
    "host_architecture": $(json_string "$HOST_ARCH"),
    "architecture_compatible": $(json_bool "$COMPATIBLE"),
    "authenticity": $(json_string "$AUTHENTICITY")
  },
  "script_classification": $(json_string "$CLASSIFICATION"),
  "warnings": $(json_array "${WARNINGS[@]}"),
  "required_approvals": $(json_array "${APPROVALS[@]}"),
  "next_actions": $(json_array "${NEXT[@]}"),
  "logs": {"scripts": "evidence/package-scripts.txt", "files": "evidence/package-files.txt"}
}
EOF
)

json_write_atomic "$OUTPUT" "$CONTENT" || die 70 "Cannot write package result"
log "Package result: $OUTPUT"
exit "$EXIT_CODE"
