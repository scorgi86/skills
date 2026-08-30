#!/usr/bin/env bash

set -o pipefail

log() {
    printf '%s\n' "$*" >&2
}

die() {
    local code="$1"
    shift
    log "ERROR: $*"
    exit "$code"
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || die 30 "Required command is unavailable: $1"
}

validate_run_id() {
    case "$1" in
        ''|*[!a-z0-9-]*|-*|*-) die 70 "Invalid run id: $1" ;;
    esac
}

normalize_arch() {
    case "$1" in
        x86_64|amd64) printf 'amd64\n' ;;
        aarch64|arm64) printf 'arm64\n' ;;
        i386|i486|i586|i686) printf 'i386\n' ;;
        *) printf '%s\n' "$1" ;;
    esac
}

is_regular_file_without_symlink() {
    local path="$1"
    [ -f "$path" ] && [ ! -L "$path" ]
}

sha256_file() {
    local path="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum -- "$path" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 -- "$path" | awk '{print $1}'
    else
        die 30 "Neither sha256sum nor shasum is available"
    fi
}

command_output_or_unknown() {
    local output
    if output=$("$@" 2>/dev/null) && [ -n "$output" ]; then
        printf '%s\n' "$output"
    else
        printf 'unknown\n'
    fi
}

append_deb_service_units() {
    local package="$1"
    local output="$2"
    local list_file="${output}.units.$$"

    command -v dpkg-deb >/dev/null 2>&1 || return 0
    command -v tar >/dev/null 2>&1 || return 0
    dpkg-deb --fsys-tarfile "$package" |
        tar -tf - 2>/dev/null |
        grep -E '(^|/)[^/]+\.service$' |
        grep -Ev '(^/|(^|/)\.\.(/|$))' >"$list_file" || true

    if [ -s "$list_file" ]; then
        printf '\n===== packaged service units =====\n' >>"$output"
        dpkg-deb --fsys-tarfile "$package" |
            tar -xOf - -T "$list_file" >>"$output" 2>/dev/null || true
    fi
    rm -f -- "$list_file"
}

append_rpm_service_units() {
    local package="$1"
    local output="$2"
    local unit

    command -v rpm >/dev/null 2>&1 || return 0
    command -v rpm2cpio >/dev/null 2>&1 || return 0
    command -v cpio >/dev/null 2>&1 || return 0

    while IFS= read -r unit; do
        [ -n "$unit" ] || continue
        case "$unit" in
            /*) unit=".$unit" ;;
        esac
        case "$unit" in
            *'/../'*|'../'*|*'/..') continue ;;
        esac
        printf '\n===== packaged service unit: %s =====\n' "$unit" >>"$output"
        rpm2cpio "$package" |
            cpio --quiet -i --to-stdout "$unit" >>"$output" 2>/dev/null || true
    done < <(rpm -qpl "$package" 2>/dev/null | grep -E '(^|/)[^/]+\.service$')
}
