#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
LIB_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../lib" && pwd)
. "$LIB_DIR/common.sh"
. "$LIB_DIR/json.sh"
. "$LIB_DIR/state.sh"

assert_equal() {
    local expected="$1"
    local actual="$2"
    local label="$3"
    if [ "$expected" != "$actual" ]; then
        printf 'FAIL %s\nexpected: %s\nactual:   %s\n' "$label" "$expected" "$actual" >&2
        exit 1
    fi
}

assert_equal '"quote\" slash\\ tab\t line\n unicode-ю"' \
    "$(json_string $'quote" slash\\ tab\t line\n unicode-ю')" \
    "json escaping"

assert_equal amd64 "$(normalize_arch x86_64)" "amd64 normalization"
assert_equal arm64 "$(normalize_arch aarch64)" "arm64 normalization"

TEST_DIR=$(mktemp -d)
case "$TEST_DIR" in
    /tmp/*|/var/tmp/*) ;;
    *) printf 'Unsafe temporary directory: %s\n' "$TEST_DIR" >&2; exit 1 ;;
esac
trap 'rm -rf -- "$TEST_DIR"' EXIT

ensure_state_dir "$TEST_DIR/state" false
json_write_atomic "$TEST_DIR/state/result.json" '{"ok":true}'
assert_equal '{"ok":true}' "$(cat "$TEST_DIR/state/result.json")" "atomic JSON write"

acquire_state_lock "$TEST_DIR/state"
if bash -c '
    set -euo pipefail
    . "$1/common.sh"
    . "$1/state.sh"
    acquire_state_lock "$2"
' bash "$LIB_DIR" "$TEST_DIR/state" >/dev/null 2>&1; then
    printf 'FAIL concurrent lock was accepted\n' >&2
    exit 1
fi
release_state_lock

printf 'SELF_TEST_OK\n'
