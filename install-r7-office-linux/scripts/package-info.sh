#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/lib/common.sh"
. "$SCRIPT_DIR/lib/json.sh"
PACKAGE= BACKEND=
while [ "$#" -gt 0 ]; do
    case "$1" in --package) PACKAGE="$2"; shift 2;; --backend) BACKEND="$2"; shift 2;; *) die 30 "Unknown argument: $1";; esac
done
package_metadata "$PACKAGE"
select_package_backend
printf '{"name":%s,"version":%s,"architecture":%s,"format":%s,"backend":%s,"installed_size_kb":%s}\n' \
    "$(json_string "$PACKAGE_NAME")" "$(json_string "$PACKAGE_VERSION")" "$(json_string "$PACKAGE_ARCH")" \
    "$(json_string "$PACKAGE_FORMAT")" "$(json_string "$BACKEND")" "$PACKAGE_SIZE_KB"
