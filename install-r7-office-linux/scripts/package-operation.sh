#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$SCRIPT_DIR/lib/common.sh"
. "$SCRIPT_DIR/lib/json.sh"
. "$SCRIPT_DIR/lib/state.sh"

RUN_ID=
STATE_DIR=
PACKAGE=
EXPECTED_SHA256=
BACKEND=
MODE=
PACKAGE_TRUST=untrusted
TARGET=/opt/r7-office/desktopeditors/DesktopEditors
SERVICE=r7-office-astra-remove-security-exec_id.service
DEPENDENCIES=()
REQUIRED_APPROVALS=()
APPROVED_ACTIONS=()

while [ "$#" -gt 0 ]; do
    case "$1" in
        --run-id) RUN_ID="$2"; shift 2 ;;
        --state-dir) STATE_DIR="$2"; shift 2 ;;
        --package) PACKAGE="$2"; shift 2 ;;
        --expected-sha256) EXPECTED_SHA256="$2"; shift 2 ;;
        --backend) BACKEND="$2"; shift 2 ;;
        --mode) MODE="$2"; shift 2 ;;
        --package-trust) PACKAGE_TRUST="$2"; shift 2 ;;
        --dependency) DEPENDENCIES+=("$2"); shift 2 ;;
        --require-approval) REQUIRED_APPROVALS+=("$2"); shift 2 ;;
        --approved-action) APPROVED_ACTIONS+=("$2"); shift 2 ;;
        --target) TARGET="$2"; shift 2 ;;
        --service) SERVICE="$2"; shift 2 ;;
        *) die 30 "Unknown argument: $1" ;;
    esac
done

validate_run_id "$RUN_ID"
ensure_state_dir "$STATE_DIR" true
acquire_state_lock "$STATE_DIR"
trap release_state_lock EXIT
OUTPUT="$STATE_DIR/operation.json"
assert_output_safe "$OUTPUT"

operation_stop() {
    local code="$1"
    local status="$2"
    local message="$3"
    local content
    content=$(cat <<EOF
{
  "schema_version": 1,
  "run_id": $(json_string "$RUN_ID"),
  "stage": "package-operation",
  "status": $(json_string "$status"),
  "mode": $(json_string "${MODE:-unknown}"),
  "backend": $(json_string "${BACKEND:-unknown}"),
  "result": "stopped",
  "warnings": [$(json_string "$message")],
  "required_approvals": $(json_array "${REQUIRED_APPROVALS[@]}"),
  "next_actions": [],
  "logs": {}
}
EOF
)
    json_write_atomic "$OUTPUT" "$content" || die 70 "Cannot write stopped operation result"
    log "ERROR: $message"
    exit "$code"
}

case "$BACKEND" in apt|dnf|zypper|yum) ;; *) operation_stop 20 unsupported "Unsupported backend: $BACKEND" ;; esac
# shellcheck disable=SC1090
. "$SCRIPT_DIR/lib/backends/$BACKEND.sh"
backend_available || operation_stop 20 unsupported "Backend is unavailable: $BACKEND"

case "$MODE" in
    refresh-metadata|install|upgrade|repair|install-dependencies|configure-integration) ;;
    *) operation_stop 30 prerequisite-failed "Unsupported operation mode: $MODE" ;;
esac

if [ "$MODE" != refresh-metadata ] && [ "$MODE" != repair ] && [ "$MODE" != install-dependencies ]; then
    is_regular_file_without_symlink "$PACKAGE" ||
        operation_stop 30 prerequisite-failed "Package must be a regular non-symlink file"
    ACTUAL_SHA256=$(sha256_file "$PACKAGE")
    [ "$ACTUAL_SHA256" = "$EXPECTED_SHA256" ] ||
        operation_stop 60 trust-failed "Package SHA-256 changed after inspection"
fi

has_approval() {
    local required="$1"
    local approved
    for approved in "${APPROVED_ACTIONS[@]}"; do
        [ "$approved" = "$required" ] && return 0
    done
    return 1
}

derive_package_approvals() {
    local evidence="$STATE_DIR/evidence/mutation-package-scripts.txt"
    : >"$evidence"
    if command -v dpkg-deb >/dev/null 2>&1 && dpkg-deb --info "$PACKAGE" >/dev/null 2>&1; then
        local control="$STATE_DIR/evidence/mutation-control"
        [ ! -L "$control" ] || die 70 "Mutation evidence path is a symlink"
        mkdir -p -- "$control"
        dpkg-deb -e "$PACKAGE" "$control"
        for script in preinst postinst prerm postrm; do
            [ ! -f "$control/$script" ] || sed -n '1,400p' "$control/$script" >>"$evidence"
        done
        append_deb_service_units "$PACKAGE" "$evidence"
    elif command -v rpm >/dev/null 2>&1 && rpm -qp "$PACKAGE" >/dev/null 2>&1; then
        rpm -qp --scripts "$PACKAGE" >"$evidence"
        append_rpm_service_units "$PACKAGE" "$evidence"
    fi
    if grep -Eqi 'security\.exec_id|setfattr[[:space:]].*-x' "$evidence"; then
        REQUIRED_APPROVALS+=("remove-security-exec-id")
    fi
    if grep -Eqi 'systemctl[[:space:]]+enable|update-rc\.d.*enable|rc-update[[:space:]]+add' "$evidence"; then
        REQUIRED_APPROVALS+=("enable-r7-service")
    fi
    if grep -Eqi '(^|[;&|[:space:]])(eval|sudo|useradd|adduser|visudo|iptables|nft)[[:space:]]|/etc/sudoers|curl[^|]*\|[[:space:]]*(sh|bash)|wget[^|]*\|[[:space:]]*(sh|bash)' "$evidence"; then
        operation_stop 30 prerequisite-failed "Package contains an unknown privileged script action"
    fi
}

if [ "$MODE" = install ] || [ "$MODE" = upgrade ]; then
    derive_package_approvals
    case "$PACKAGE_TRUST" in
        verified)
            SIGNATURE_VERIFIED=false
            if command -v rpm >/dev/null 2>&1 && rpm -qp "$PACKAGE" >/dev/null 2>&1 &&
                command -v rpmkeys >/dev/null 2>&1 &&
                rpmkeys --checksig "$PACKAGE" 2>&1 | grep -qi 'digests signatures.*ok\|signatures.*ok'; then
                SIGNATURE_VERIFIED=true
            elif command -v dpkg-deb >/dev/null 2>&1 && dpkg-deb --info "$PACKAGE" >/dev/null 2>&1; then
                if command -v debsig-verify >/dev/null 2>&1 && debsig-verify "$PACKAGE" >/dev/null 2>&1; then
                    SIGNATURE_VERIFIED=true
                elif command -v dpkg-sig >/dev/null 2>&1 &&
                    dpkg-sig --verify "$PACKAGE" 2>/dev/null | grep -q 'GOODSIG'; then
                    SIGNATURE_VERIFIED=true
                fi
            fi
            [ "$SIGNATURE_VERIFIED" = true ] ||
                operation_stop 60 trust-failed "Package trust was marked verified but signature verification failed"
            ;;
        user-approved)
            REQUIRED_APPROVALS+=("trust-unsigned-package")
            ;;
        *) operation_stop 60 trust-failed "Package authenticity is not verified and user trust was not recorded" ;;
    esac
fi

for required in "${REQUIRED_APPROVALS[@]}"; do
    has_approval "$required" ||
        operation_stop 10 approval-required "Missing exact approval: $required"
done

LOG_FILE="$STATE_DIR/logs/package-operation-$MODE.log"
STATUS=success
ACTION_RESULT=completed

case "$MODE" in
    refresh-metadata)
        backend_refresh >"$LOG_FILE" 2>&1 || { STATUS=backend-failed; ACTION_RESULT=refresh-failed; }
        ;;
    install|upgrade)
        if ! backend_audit; then
            operation_stop 40 backend-failed "Package database requires repair before installation"
        fi
        backend_install_local "$PACKAGE" >"$LOG_FILE" 2>&1 || { STATUS=backend-failed; ACTION_RESULT=install-failed; }
        ;;
    repair)
        backend_repair >"$LOG_FILE" 2>&1 || { STATUS=backend-failed; ACTION_RESULT=repair-failed; }
        ;;
    install-dependencies)
        [ "${#DEPENDENCIES[@]}" -gt 0 ] ||
            operation_stop 30 prerequisite-failed "No dependency package names were supplied"
        backend_install_names "${DEPENDENCIES[@]}" >"$LOG_FILE" 2>&1 || { STATUS=backend-failed; ACTION_RESULT=dependency-install-failed; }
        ;;
    configure-integration)
        : >"$LOG_FILE"
        for approved in "${APPROVED_ACTIONS[@]}"; do
            case "$approved" in
                remove-security-exec-id)
                    command -v setfattr >/dev/null 2>&1 ||
                        operation_stop 30 prerequisite-failed "setfattr is required for the approved security operation"
                    if command -v getfattr >/dev/null 2>&1 &&
                        getfattr -n security.exec_id "$TARGET" >/dev/null 2>&1; then
                        setfattr -x security.exec_id "$TARGET" >>"$LOG_FILE" 2>&1 ||
                            { STATUS=backend-failed; ACTION_RESULT=security-attribute-failed; }
                    else
                        printf 'security.exec_id is absent or unsupported\n' >>"$LOG_FILE"
                    fi
                    ;;
                enable-r7-service)
                    command -v systemctl >/dev/null 2>&1 ||
                        operation_stop 30 prerequisite-failed "systemctl is required for the approved service operation"
                    systemctl enable "$SERVICE" >>"$LOG_FILE" 2>&1 ||
                        { STATUS=backend-failed; ACTION_RESULT=service-enable-failed; }
                    ;;
                trust-unsigned-package) ;;
                *) operation_stop 10 approval-required "Unknown approved integration action: $approved" ;;
            esac
        done
        ;;
esac

CONTENT=$(cat <<EOF
{
  "schema_version": 1,
  "run_id": $(json_string "$RUN_ID"),
  "stage": "package-operation",
  "status": $(json_string "$STATUS"),
  "mode": $(json_string "$MODE"),
  "backend": $(json_string "$BACKEND"),
  "result": $(json_string "$ACTION_RESULT"),
  "warnings": [],
  "required_approvals": $(json_array "${REQUIRED_APPROVALS[@]}"),
  "next_actions": ["verify"],
  "logs": {"operation": $(json_string "logs/package-operation-$MODE.log")}
}
EOF
)
json_write_atomic "$OUTPUT" "$CONTENT" || die 70 "Cannot write operation result"

if [ "$STATUS" != success ]; then exit 40; fi
log "Operation result: $OUTPUT"
