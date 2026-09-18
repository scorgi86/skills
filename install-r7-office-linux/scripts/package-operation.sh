#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$SCRIPT_DIR/lib/common.sh"
. "$SCRIPT_DIR/lib/json.sh"
. "$SCRIPT_DIR/lib/state.sh"
RUN_ID= STATE_DIR= PACKAGE= EXPECTED_SHA256= BACKEND= MODE=install
TARGET=/opt/r7-office/desktopeditors/DesktopEditors
SERVICE=r7-office-astra-remove-security-exec_id.service
DEPENDENCIES=() APPROVED_ACTIONS=()
while [ "$#" -gt 0 ]; do
    case "$1" in
        --run-id) RUN_ID="$2"; shift 2;; --state-dir) STATE_DIR="$2"; shift 2;;
        --package) PACKAGE="$2"; shift 2;; --expected-sha256) EXPECTED_SHA256="$2"; shift 2;;
        --backend) BACKEND="$2"; shift 2;; --mode) MODE="$2"; shift 2;;
        --dependency) DEPENDENCIES+=("$2"); shift 2;;
        --approved-action) APPROVED_ACTIONS+=("$2"); shift 2;;
        --target) TARGET="$2"; shift 2;; --service) SERVICE="$2"; shift 2;;
        *) die 30 "Unknown argument: $1";;
    esac
done
[ "$(id -u)" = 0 ] || die 70 "This operation requires root"
RUN_ID=${RUN_ID:-install-$(date +%Y%m%d%H%M%S)-$$}
validate_run_id "$RUN_ID"
STATE_DIR=${STATE_DIR:-$(mktemp -d /var/tmp/r7-office.XXXXXXXX)}
ensure_state_dir "$STATE_DIR" true
acquire_state_lock "$STATE_DIR"
trap release_state_lock EXIT
OUTPUT="$STATE_DIR/operation.json"
case "$MODE" in install|upgrade|refresh-metadata|install-dependencies|configure-integration) ;; *) die 30 "Unsupported operation mode: $MODE";; esac
LOG_FILE="$STATE_DIR/logs/package-operation-$MODE.log"
STATUS=success RESULT=completed
PACKAGE_NAME= PACKAGE_VERSION= PACKAGE_ARCH= PACKAGE_FORMAT= ACTUAL_SHA256=
write_result() {
    json_write_atomic "$OUTPUT" "{\"schema_version\":1,\"run_id\":$(json_string "$RUN_ID"),\"stage\":\"package-operation\",\"status\":$(json_string "$STATUS"),\"mode\":$(json_string "$MODE"),\"backend\":$(json_string "$BACKEND"),\"result\":$(json_string "$RESULT"),\"package\":{\"name\":$(json_string "$PACKAGE_NAME"),\"version\":$(json_string "$PACKAGE_VERSION"),\"architecture\":$(json_string "$PACKAGE_ARCH"),\"format\":$(json_string "$PACKAGE_FORMAT"),\"sha256\":$(json_string "$ACTUAL_SHA256")},\"logs\":{\"operation\":$(json_string "$LOG_FILE")}}"
}
stop() {
    STATUS=prerequisite-failed RESULT="$2"
    write_result || die 70 "Cannot write operation result"
    die "$1" "$2"
}
if [ "$MODE" = install ] || [ "$MODE" = upgrade ]; then
    is_regular_file_without_symlink "$PACKAGE" || stop 30 "Package must be a regular non-symlink file"
    PACKAGE=$(readlink -f -- "$PACKAGE")
    package_metadata "$PACKAGE"
    select_package_backend
    if [ -n "$EXPECTED_SHA256" ]; then
        ACTUAL_SHA256=$(sha256_file "$PACKAGE")
        [ "$ACTUAL_SHA256" = "$EXPECTED_SHA256" ] || stop 60 "Package SHA-256 mismatch"
    fi
fi
case "$BACKEND" in apt|dnf|zypper|yum) ;; *) stop 20 "Unsupported backend: $BACKEND";; esac
. "$SCRIPT_DIR/lib/backends/$BACKEND.sh"
backend_available || stop 20 "Backend is unavailable"
case "$MODE" in
    install|upgrade)
        closed=0; pgrep -x DesktopEditors >/dev/null 2>&1 || closed=$?
        [ "$closed" = 1 ] || stop 30 "Close DesktopEditors before changing the package"
        require_command mountpoint
        for target in /opt/r7-office/desktopeditors/editors/sdkjs /opt/r7-office/desktopeditors/editors/web-apps; do
            mounted=0; mountpoint -q -- "$target" || mounted=$?
            [ "$mounted" = 32 ] || stop 30 "Disable development mounts before changing the package"
        done
        backend_audit || stop 40 "Package database requires attention"
        backend_install_local "$PACKAGE" >"$LOG_FILE" 2>&1 || { STATUS=backend-failed RESULT=install-failed; }
        ;;
    refresh-metadata) backend_refresh >"$LOG_FILE" 2>&1 || { STATUS=backend-failed RESULT=refresh-failed; };;
    install-dependencies)
        [ "${#DEPENDENCIES[@]}" -gt 0 ] || stop 30 "No dependencies supplied"
        backend_install_names "${DEPENDENCIES[@]}" >"$LOG_FILE" 2>&1 || { STATUS=backend-failed RESULT=dependency-install-failed; };;
    configure-integration)
        [ "$TARGET" = /opt/r7-office/desktopeditors/DesktopEditors ] && [ "$SERVICE" = r7-office-astra-remove-security-exec_id.service ] || stop 30 "Unsupported integration target"
        [ "${#APPROVED_ACTIONS[@]}" -gt 0 ] || stop 10 "An exact integration action is required"
        for action in "${APPROVED_ACTIONS[@]}"; do
            case "$action" in remove-security-exec-id|enable-r7-service) ;; *) stop 10 "Unsupported integration action";; esac
        done
        : >"$LOG_FILE"
        for action in "${APPROVED_ACTIONS[@]}"; do
            case "$action" in
                remove-security-exec-id)
                    require_command getfattr; require_command setfattr
                    if LC_ALL=C getfattr -n security.exec_id "$TARGET" >"$STATE_DIR/logs/attribute.txt" 2>&1; then
                        setfattr -x security.exec_id "$TARGET" >>"$LOG_FILE" 2>&1 || { STATUS=backend-failed RESULT=security-attribute-failed; }
                    else
                        grep -q ': No such attribute$' "$STATE_DIR/logs/attribute.txt" || stop 40 "Cannot determine security.exec_id"
                    fi;;
                enable-r7-service)
                    require_command systemctl
                    systemctl enable "$SERVICE" >>"$LOG_FILE" 2>&1 || { STATUS=backend-failed RESULT=service-enable-failed; };;
            esac
        done;;
esac
write_result || die 70 "Cannot write operation result"
log "Operation result: $OUTPUT"
[ "$STATUS" = success ] || exit 40
