#!/usr/bin/env bash
set -euo pipefail
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TASK=$(mktemp -d /tmp/r7-alias-test.XXXXXXXX)
trap 'rm -rf -- "$TASK"' EXIT
chmod 755 "$TASK"
mkdir "$TASK/home"
chown nobody "$TASK/home"
ln -s /bin/echo "$TASK/binary with spaces"
for attempt in 1 2; do
    runuser -u nobody -- env HOME="$TASK/home" bash "$BASE/wsl-alias.sh" "$TASK/binary with spaces"
done
[ "$(grep -c '^alias dev-r7-office=' "$TASK/home/.bashrc")" = 1 ]
runuser -u nobody -- env HOME="$TASK/home" bash -c 'shopt -s expand_aliases; source "$HOME/.bashrc"; eval dev-r7-office' >"$TASK/output"
grep -Fxq -- '--ascdesktop-support-debug-info' "$TASK/output"
printf 'PASS: ordinary-user alias, spaced executable, repeated configuration, debug argument\n'
