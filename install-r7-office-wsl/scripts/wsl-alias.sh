#!/usr/bin/env bash
set -euo pipefail

binary=${1:-/opt/r7-office/desktopeditors/DesktopEditors}
[[ $# -le 1 && "$binary" = /* && -x "$binary" ]] || {
    printf '%s\n' 'Expected an absolute path to DesktopEditors' >&2
    exit 2
}
[[ $(id -u) -ne 0 ]] || {
    printf '%s\n' 'Run as the application user' >&2
    exit 2
}
printf -v command '%q --ascdesktop-support-debug-info' "$binary"
printf -v alias_line 'alias dev-r7-office=%q' "$command"
if [[ ! -f "$HOME/.bashrc" ]] || ! grep -Fxq -- "$alias_line" "$HOME/.bashrc"; then
    printf '\n%s\n' "$alias_line" >>"$HOME/.bashrc"
fi
printf '%s\n' 'dev-r7-office configured in ~/.bashrc; open a new Bash terminal or run source ~/.bashrc'
