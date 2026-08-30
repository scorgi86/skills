#!/usr/bin/env bash

backend_available() { command -v zypper >/dev/null 2>&1; }
backend_check_cache() { [ -d /var/cache/zypp ] && find /var/cache/zypp -type f -print -quit 2>/dev/null | grep -q .; }
backend_refresh() { zypper --non-interactive refresh; }
backend_audit() { rpm -Va --nofiles --nodigest >/dev/null; }
backend_query_installed() { rpm -q --qf '%{NAME}\t%{VERSION}-%{RELEASE}\n' "$1" 2>/dev/null; }
backend_install_local() { zypper --non-interactive install "$1"; }
backend_install_names() { zypper --non-interactive install "$@"; }
backend_find_provider() {
    local results count
    results=$(zypper --non-interactive what-provides "*/$1" 2>/dev/null |
        awk -F'|' 'NF >= 2 && $1 !~ /^[-+]/ {gsub(/^[ \t]+|[ \t]+$/, "", $2); if ($2 != "Name") print $2}' | sort -u)
    count=$(printf '%s\n' "$results" | sed '/^$/d' | wc -l)
    case "$count" in 0) printf 'provider-not-found\n' ;; 1) printf 'provider-found:%s\n' "$results" ;; *) printf 'provider-ambiguous\n' ;; esac
}
backend_repair() { zypper --non-interactive verify; }
