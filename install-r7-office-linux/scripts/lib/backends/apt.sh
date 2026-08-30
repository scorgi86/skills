#!/usr/bin/env bash

backend_available() {
    command -v apt-get >/dev/null 2>&1 || command -v apt >/dev/null 2>&1
}

backend_check_cache() {
    find /var/lib/apt/lists -type f -name '*Packages*' -print -quit 2>/dev/null |
        grep -q .
}

backend_refresh() {
    if command -v apt-get >/dev/null 2>&1; then apt-get update; else apt update; fi
}

backend_audit() {
    command -v dpkg >/dev/null 2>&1 && [ -z "$(dpkg --audit 2>/dev/null)" ]
}

backend_query_installed() {
    dpkg-query -W -f='${Status}\t${Version}\n' "$1" 2>/dev/null
}

backend_install_local() {
    local package="$1"
    if command -v apt-get >/dev/null 2>&1; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y "$package"
    else
        DEBIAN_FRONTEND=noninteractive apt install -y "$package"
    fi
}

backend_install_names() {
    if command -v apt-get >/dev/null 2>&1; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
    else
        DEBIAN_FRONTEND=noninteractive apt install -y "$@"
    fi
}

backend_find_provider() {
    local library="$1"
    if ! command -v apt-file >/dev/null 2>&1; then
        printf 'provider-search-unavailable\n'
        return 0
    fi
    local results count
    results=$(apt-file search "/$library" 2>/dev/null | cut -d: -f1 | sort -u)
    count=$(printf '%s\n' "$results" | sed '/^$/d' | wc -l)
    case "$count" in
        0) printf 'provider-not-found\n' ;;
        1) printf 'provider-found:%s\n' "$results" ;;
        *) printf 'provider-ambiguous\n' ;;
    esac
}

backend_repair() {
    dpkg --configure -a &&
        DEBIAN_FRONTEND=noninteractive apt-get -f install -y
}
