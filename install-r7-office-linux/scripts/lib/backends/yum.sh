#!/usr/bin/env bash

backend_available() { command -v yum >/dev/null 2>&1; }
backend_check_cache() { [ -d /var/cache/yum ] && find /var/cache/yum -type f -print -quit 2>/dev/null | grep -q .; }
backend_refresh() { yum -y makecache; }
backend_audit() { command -v package-cleanup >/dev/null 2>&1 && package-cleanup --problems || rpm -Va --nofiles --nodigest >/dev/null; }
backend_query_installed() { rpm -q --qf '%{NAME}\t%{VERSION}-%{RELEASE}\n' "$1" 2>/dev/null; }
backend_install_local() { yum -y localinstall "$1"; }
backend_install_names() { yum -y install "$@"; }
backend_find_provider() {
    local results count
    results=$(yum -q provides "*/$1" 2>/dev/null | awk '/^[[:alnum:]_.+:-]+[[:space:]]*:/ {sub(/[[:space:]]*:.*/, "", $0); print}' | sort -u)
    count=$(printf '%s\n' "$results" | sed '/^$/d' | wc -l)
    case "$count" in 0) printf 'provider-not-found\n' ;; 1) printf 'provider-found:%s\n' "$results" ;; *) printf 'provider-ambiguous\n' ;; esac
}
backend_repair() { yum -y check; }
