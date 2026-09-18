#!/usr/bin/env bash
set -euo pipefail
HERE=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BASE=$(CDPATH= cd -- "$HERE/.." && pwd)
TEST_DIR=$(mktemp -d /tmp/r7-verification-test.XXXXXXXXXX)
trap 'rm -rf -- "$TEST_DIR"' EXIT
mkdir "$TEST_DIR/bin"
cat >"$TEST_DIR/bin/dpkg-query" <<'EOF'
#!/bin/sh
printf '%s\t%s\n' "${MOCK_STATUS:-install ok installed}" "${MOCK_VERSION:-1.2}"
EOF
cat >"$TEST_DIR/bin/dpkg" <<'EOF'
#!/bin/sh
exit "${MOCK_AUDIT_EXIT:-0}"
EOF
cat >"$TEST_DIR/bin/apt-get" <<'EOF'
#!/bin/sh
exit "${MOCK_CHECK_EXIT:-0}"
EOF
cat >"$TEST_DIR/bin/ldd" <<'EOF'
#!/bin/sh
exit "${MOCK_LDD_EXIT:-0}"
EOF
chmod +x "$TEST_DIR/bin/"*
export PATH="$TEST_DIR/bin:$PATH"
check() {
    local label="$1" expected="$2" actual=0
    shift 2
    env "$@" bash "$BASE/verify-installation.sh" --run-id test-run --state-dir "$TEST_DIR/state" --backend apt --binary /bin/true --expected-version 1.2 >/dev/null 2>&1 || actual=$?
    [ "$actual" = "$expected" ] || { printf 'FAIL %s: exit %s expected %s\n' "$label" "$actual" "$expected"; exit 1; }
    printf 'PASS %s\n' "$label"
}
check installed 0
check removed-package 50 MOCK_STATUS='deinstall ok config-files'
check ldd-error 50 MOCK_LDD_EXIT=1
check audit-error 50 MOCK_AUDIT_EXIT=1
check dependency-error 50 MOCK_CHECK_EXIT=1
check version-mismatch 50 MOCK_VERSION=9.9
. "$BASE/lib/common.sh"
. "$BASE/lib/state.sh"
mkdir "$TEST_DIR/unsafe"
ln -s "$TEST_DIR/bin" "$TEST_DIR/unsafe/logs"
if (ensure_state_dir "$TEST_DIR/unsafe" false) >/dev/null 2>&1; then
    printf 'FAIL symlink state accepted\n'; exit 1
fi
printf 'PASS symlink-state-rejected\n'
printf 'VERIFICATION_TEST_OK\n'
