#!/usr/bin/env bash

package_authenticity() {
    local package="$1" result code=0
    if dpkg-deb --info "$package" >/dev/null 2>&1; then
        if command -v debsig-verify >/dev/null 2>&1; then
            debsig-verify "$package" >/dev/null 2>&1 || code=$?
            case "$code" in
                0) printf 'verified\n' ;;
                10|11|12|13) printf 'unsigned-or-unverified\n' ;;
                *) printf 'invalid-signature\n' ;;
            esac
        elif command -v dpkg-sig >/dev/null 2>&1; then
            result=$(dpkg-sig --verify "$package" 2>&1) || code=$?
            if printf '%s' "$result" | grep -q BADSIG; then
                printf 'invalid-signature\n'
            elif [ "$code" = 0 ] && printf '%s' "$result" | grep -q GOODSIG; then
                printf 'verified\n'
            else
                printf 'unsigned-or-unverified\n'
            fi
        else
            printf 'unsigned-or-unverified\n'
        fi
    elif command -v rpmkeys >/dev/null 2>&1; then
        result=$(rpmkeys --checksig "$package" 2>&1) || code=$?
        if printf '%s' "$result" | grep -Eqi 'BAD|NOT OK'; then
            printf 'invalid-signature\n'
        elif [ "$code" = 0 ] && printf '%s' "$result" | grep -qi 'signatures.*ok'; then
            printf 'verified\n'
        else
            printf 'unsigned-or-unverified\n'
        fi
    else
        printf 'unsigned-or-unverified\n'
    fi
}

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

package_metadata() {
    local package="$1" metadata
    is_regular_file_without_symlink "$package" || die 30 "Package must be a regular non-symlink file"
    case "$package" in
        *.deb)
            PACKAGE_FORMAT=deb
            require_command dpkg-deb
            metadata=$(dpkg-deb -f "$package" Package Version Architecture Installed-Size) || die 30 "Cannot read DEB metadata"
            PACKAGE_NAME=$(printf '%s\n' "$metadata" | sed -n 's/^Package: //p')
            PACKAGE_VERSION=$(printf '%s\n' "$metadata" | sed -n 's/^Version: //p')
            PACKAGE_ARCH=$(printf '%s\n' "$metadata" | sed -n 's/^Architecture: //p')
            PACKAGE_SIZE_KB=$(printf '%s\n' "$metadata" | sed -n 's/^Installed-Size: //p')
            ;;
        *.rpm)
            PACKAGE_FORMAT=rpm
            require_command rpm
            metadata=$(rpm -qp --qf '%{NAME}\t%{VERSION}-%{RELEASE}\t%{ARCH}\t%{SIZE}\n' "$package") || die 30 "Cannot read RPM metadata"
            IFS=$'\t' read -r PACKAGE_NAME PACKAGE_VERSION PACKAGE_ARCH PACKAGE_SIZE_KB <<< "$metadata"
            case "$PACKAGE_SIZE_KB" in ''|*[!0-9]*) die 30 "Invalid RPM installed size";; esac
            PACKAGE_SIZE_KB=$(( (PACKAGE_SIZE_KB + 1023) / 1024 ))
            ;;
        *) die 20 "Unsupported package format" ;;
    esac
    [ -n "$PACKAGE_NAME" ] && [ -n "$PACKAGE_VERSION" ] && [ -n "$PACKAGE_ARCH" ] || die 30 "Incomplete package metadata"
    PACKAGE_SIZE_KB=${PACKAGE_SIZE_KB:-0}
    case "$PACKAGE_SIZE_KB" in *[!0-9]*) die 30 "Invalid installed size";; esac
    PACKAGE_ARCH=$(normalize_arch "$PACKAGE_ARCH")
    case "$PACKAGE_ARCH" in all|noarch|"$(normalize_arch "$(uname -m)")") ;; *) die 30 "Package architecture is incompatible";; esac
}

select_package_backend() {
    local candidate
    if [ -z "${BACKEND:-}" ]; then
        if [ "$PACKAGE_FORMAT" = deb ]; then BACKEND=apt
        else
            for candidate in dnf zypper yum; do
                if command -v "$candidate" >/dev/null 2>&1; then BACKEND=$candidate; break; fi
            done
        fi
    fi
    case "$PACKAGE_FORMAT:${BACKEND:-}" in deb:apt|rpm:dnf|rpm:zypper|rpm:yum) ;; *) die 20 "Package format and backend are incompatible";; esac
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
    local package="$1" output="$2" temporary
    require_command dpkg-deb
    require_command tar
    assert_output_safe "$output"
    temporary=$(mktemp -d "$(dirname -- "$output")/.deb-units.XXXXXX") ||
        die 70 "Cannot create service inspection directory"

    if ! dpkg-deb --fsys-tarfile "$package" >"$temporary/data.tar" ||
       ! tar -tf "$temporary/data.tar" >"$temporary/files"; then
        rm -rf -- "$temporary"
        die 30 "Cannot inspect packaged DEB service units"
    fi
    awk '/(^|\/)[^\/]+\.service$/ && !/(^\/|(^|\/)\.\.(\/|$))/' "$temporary/files" >"$temporary/units"
    if [ -s "$temporary/units" ]; then
        if ! printf '\n===== packaged service units =====\n' >>"$output" ||
           ! tar -xOf "$temporary/data.tar" --verbatim-files-from --no-unquote --no-wildcards -T "$temporary/units" >>"$output"; then
            rm -rf -- "$temporary"
            die 30 "Cannot read packaged DEB service units"
        fi
    fi
    rm -rf -- "$temporary"
}

append_rpm_service_units() {
    local package="$1" output="$2" temporary unit
    require_command rpm
    assert_output_safe "$output"
    temporary=$(mktemp -d "$(dirname -- "$output")/.rpm-units.XXXXXX") ||
        die 70 "Cannot create service inspection directory"
    if ! rpm -qpl "$package" >"$temporary/files"; then
        rm -rf -- "$temporary"
        die 30 "Cannot list packaged RPM service units"
    fi
    awk '/(^|\/)[^\/]+\.service$/' "$temporary/files" >"$temporary/units"
    if [ -s "$temporary/units" ]; then
        if ! command -v rpm2cpio >/dev/null 2>&1 || ! command -v cpio >/dev/null 2>&1; then
            rm -rf -- "$temporary"
            die 30 "rpm2cpio and cpio are required to inspect packaged service units"
        fi
        if ! rpm2cpio "$package" >"$temporary/data.cpio"; then
            rm -rf -- "$temporary"
            die 30 "Cannot inspect packaged RPM service units"
        fi
        while IFS= read -r unit; do
            case "$unit" in /*) unit=".$unit" ;; esac
            case "$unit" in *'/../'*|'../'*|*'/..') continue ;; esac
            if ! cpio --quiet -i --to-stdout -- "$unit" <"$temporary/data.cpio" >"$temporary/unit" ||
               [ ! -s "$temporary/unit" ]; then
                rm -rf -- "$temporary"
                die 30 "Cannot read packaged RPM service unit"
            fi
            if ! printf '\n===== packaged service unit: %s =====\n' "$unit" >>"$output" ||
               ! cat "$temporary/unit" >>"$output"; then
                rm -rf -- "$temporary"
                die 30 "Cannot record packaged RPM service unit"
            fi
        done <"$temporary/units"
    fi
    rm -rf -- "$temporary"
}
