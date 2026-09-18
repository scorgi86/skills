#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || ! $1 =~ ^r7-office-dev-[a-f0-9]{16}$ ]]; then
    printf '%s\n' 'Expected a deployment keeper identifier' >&2
    exit 2
fi
exec -a "$1" /usr/bin/sleep infinity
