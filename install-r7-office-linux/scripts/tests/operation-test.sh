#!/usr/bin/env bash
set -euo pipefail
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TASK=$(mktemp -d /tmp/r7-operation-test.XXXXXXXX)
trap 'rm -rf -- "$TASK"' EXIT
mkdir "$TASK/bin"
export CALLS="$TASK/calls"
cat >"$TASK/bin/dpkg-deb" <<'SH'
#!/usr/bin/env bash
printf 'dpkg-deb %s\n' "$*" >>"$CALLS"
[ "$1" = -f ] || exit 90
printf 'Package: r7-office\nVersion: 1.2\nArchitecture: %s\nInstalled-Size: 10\n' "${ARCH_OVERRIDE:-amd64}"
SH
cat >"$TASK/bin/rpm" <<'SH'
#!/usr/bin/env bash
printf 'rpm %s\n' "$*" >>"$CALLS"
case "$1" in -qp) printf 'r7-office\t1.2-3\tx86_64\t10240\n';; -Va) exit 0;; *) exit 90;; esac
SH
cat >"$TASK/bin/manager" <<'SH'
#!/usr/bin/env bash
printf '%s %s\n' "${0##*/}" "$*" >>"$CALLS"
case " $* " in *' install '*|*' localinstall '*) exit "${INSTALL_EXIT:-0}";; esac
SH
for manager in apt-get apt dnf yum zypper; do ln -s manager "$TASK/bin/$manager"; done
for forbidden in python3 debsig-verify dpkg-sig rpmkeys; do
    printf '#!/usr/bin/env bash\nprintf "FORBIDDEN %%s\\n" "$0" >>"$CALLS"\nexit 90\n' >"$TASK/bin/$forbidden"
done
printf '#!/usr/bin/env bash\nexit 1\n' >"$TASK/bin/pgrep"
printf '#!/usr/bin/env bash\nexit 32\n' >"$TASK/bin/mountpoint"
printf '#!/usr/bin/env bash\nexit 0\n' >"$TASK/bin/dpkg"
chmod +x "$TASK/bin/"*
export PATH="$TASK/bin:$PATH"
touch "$TASK/local package.deb" "$TASK/local package.rpm"
for backend in apt dnf yum zypper; do
    extension=rpm; [ "$backend" != apt ] || extension=deb
    : >"$CALLS"
    code=0
    bash "$BASE/package-operation.sh" --run-id test-run --state-dir "$TASK/$backend" --backend "$backend" --mode install --package "$TASK/local package.$extension" >"$TASK/$backend.out" 2>&1 || code=$?
    if [ "$code" != 0 ]; then cat "$TASK/$backend.out"; cat "$CALLS"; exit "$code"; fi
    ! grep -q FORBIDDEN "$CALLS"
    [ "$(grep -cE '^(dpkg-deb -f|rpm -qp)' "$CALLS")" = 1 ]
    [ "$(grep -cE '^(apt-get|dnf|yum|zypper).* (install|localinstall) ' "$CALLS")" = 1 ]
    case "$backend" in
      apt) grep -Fq 'apt-get --no-remove install -y' "$CALLS";;
      dnf) grep -Fq 'dnf -C -y install' "$CALLS";;
      yum) grep -Fq 'yum -C -y localinstall' "$CALLS";;
      zypper) grep -Fq 'zypper --no-refresh --non-interactive install' "$CALLS";;
    esac
    ! grep -Eq ' (update|makecache|refresh)( |$)' "$CALLS"
    [ "$(stat -c '%a' "$TASK/$backend")" = 700 ]
    : >"$CALLS"
    code=0
    INSTALL_EXIT=17 bash "$BASE/package-operation.sh" --run-id test-run --state-dir "$TASK/$backend-failure" --backend "$backend" --mode upgrade --package "$TASK/local package.$extension" >/dev/null 2>&1 || code=$?
    [ "$code" = 40 ]
done
for extension in deb rpm; do
    : >"$CALLS"
    bash "$BASE/package-operation.sh" --run-id test-run --state-dir "$TASK/auto-$extension" --mode install --package "$TASK/local package.$extension" >/dev/null 2>&1
    if [ "$extension" = deb ]; then grep -q '^apt-get .* install ' "$CALLS"; else grep -q '^dnf .* install ' "$CALLS"; fi
done
for scenario in incompatible-arch incompatible-backend unsupported-format; do
    : >"$CALLS"; code=0
    case "$scenario" in
        incompatible-arch) ARCH_OVERRIDE=arm64 bash "$BASE/package-operation.sh" --run-id test-run --state-dir "$TASK/$scenario" --mode install --package "$TASK/local package.deb" >/dev/null 2>&1 || code=$?; expected=30;;
        incompatible-backend) bash "$BASE/package-operation.sh" --run-id test-run --state-dir "$TASK/$scenario" --backend dnf --mode install --package "$TASK/local package.deb" >/dev/null 2>&1 || code=$?; expected=20;;
        unsupported-format) touch "$TASK/local.zip"; bash "$BASE/package-operation.sh" --run-id test-run --state-dir "$TASK/$scenario" --mode install --package "$TASK/local.zip" >/dev/null 2>&1 || code=$?; expected=20;;
    esac
    [ "$code" = "$expected" ] && ! grep -q ' install ' "$CALLS"
done
: >"$CALLS"
code=0
bash "$BASE/package-operation.sh" --run-id test-run --state-dir "$TASK/hash" --backend apt --mode upgrade --package "$TASK/local package.deb" --expected-sha256 wrong >/dev/null 2>&1 || code=$?
[ "$code" = 60 ] && ! grep -q ' install ' "$CALLS"
code=0
INSTALL_EXIT=17 bash "$BASE/package-operation.sh" --run-id test-run --state-dir "$TASK/failure" --backend apt --mode upgrade --package "$TASK/local package.deb" >/dev/null 2>&1 || code=$?
[ "$code" = 40 ]
printf 'PASS: standalone install, metadata once, four backends, no Python/signature/audit wrappers, hash gate, native failure\n'
