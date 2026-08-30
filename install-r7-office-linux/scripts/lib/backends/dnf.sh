#!/usr/bin/env bash

backend_available() { command -v dnf >/dev/null 2>&1; }
backend_check_cache() { [ -d /var/cache/dnf ] && find /var/cache/dnf -type f -print -quit 2>/dev/null | grep -q .; }
backend_refresh() { dnf -y makecache; }
backend_audit() { dnf -q check; }
backend_query_installed() { rpm -q --qf '%{NAME}\t%{VERSION}-%{RELEASE}\n' "$1" 2>/dev/null; }
backend_install_local() { dnf -y install "$1"; }
backend_install_names() { dnf -y install "$@"; }
backend_find_provider() {
    local results count
    results=$(dnf -q provides "*/$1" 2>/dev/null | awk '/^[[:alnum:]_.+:-]+[[:space:]]*:/ {sub(/[[:space:]]*:.*/, "", $0); print}' | sort -u)
    count=$(printf '%s\n' "$results" | sed '/^$/d' | wc -l)
    case "$count" in 0) printf 'provider-not-found\n' ;; 1) printf 'provider-found:%s\n' "$results" ;; *) printf 'provider-ambiguous\n' ;; esac
}
backend_repair() { dnf -y check; }
