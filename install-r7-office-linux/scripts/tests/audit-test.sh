#!/usr/bin/env bash
set -euo pipefail
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TASK=$(mktemp -d /tmp/r7-audit-test.XXXXXXXX)
trap 'rm -rf -- "$TASK"' EXIT
mkdir -p "$TASK/package/DEBIAN" "$TASK/package/usr/share/r7-audit-fixture" "$TASK/bin"
printf 'Package: r7-audit-fixture\nVersion: 1.0\nArchitecture: all\nMaintainer: Fixture <fixture@example.invalid>\nDescription: temporary audit fixture\n' >"$TASK/package/DEBIAN/control"
printf '#!/bin/sh\necho fixture\n' >"$TASK/package/DEBIAN/postinst"
chmod +x "$TASK/package/DEBIAN/postinst"
printf fixture >"$TASK/package/usr/share/r7-audit-fixture/file"
dpkg-deb --build "$TASK/package" "$TASK/fixture.deb" >/dev/null
export SIGNATURE_CALLS="$TASK/signature-calls"
cat >"$TASK/bin/debsig-verify" <<'SH'
#!/usr/bin/env bash
echo verify >>"$SIGNATURE_CALLS"
exit "${SIGNATURE_EXIT:-0}"
SH
chmod +x "$TASK/bin/debsig-verify"
for signature in 0 10 1; do
    : >"$SIGNATURE_CALLS"; code=0
    PATH="$TASK/bin:$PATH" SIGNATURE_EXIT="$signature" bash "$BASE/inspect-package.sh" --run-id audit-fixture --state-dir "$TASK/state-$signature" --package "$TASK/fixture.deb" >/dev/null 2>&1 || code=$?
    [ "$(wc -l <"$SIGNATURE_CALLS")" = 1 ]
    if [ "$signature" = 1 ]; then [ "$code" = 60 ]; else [ "$code" = 10 ]; fi
done
grep -q 'review-required' "$TASK/state-0/package.json"
[ -f "$TASK/state-0/evidence/package-files.txt" ]
printf 'PASS: optional audit, payload/scripts evidence, signature exactly once, unsigned result, invalid signature stop\n'
