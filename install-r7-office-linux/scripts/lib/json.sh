#!/usr/bin/env bash

json_escape() {
    local value="${1-}"
    value=${value//\\/\\\\}
    value=${value//\"/\\\"}
    value=${value//$'\n'/\\n}
    value=${value//$'\r'/\\r}
    value=${value//$'\t'/\\t}
    local number character escaped
    for number in {1..31}; do
        case "$number" in 9|10|13) continue ;; esac
        printf -v character '%b' "$(printf '\\%03o' "$number")"
        printf -v escaped '\\u%04x' "$number"
        value=${value//"$character"/"$escaped"}
    done
    printf '%s' "$value"
}

json_string() {
    printf '"%s"' "$(json_escape "${1-}")"
}

json_bool() {
    case "${1-}" in
        1|true|yes) printf 'true' ;;
        *) printf 'false' ;;
    esac
}

json_array() {
    local first=1
    local value
    printf '['
    for value in "$@"; do
        if [ "$first" -eq 0 ]; then
            printf ','
        fi
        json_string "$value"
        first=0
    done
    printf ']'
}

json_write_atomic() {
    local output="$1"
    local content="$2"
    local directory temporary
    directory=$(dirname -- "$output")
    umask 077
    assert_output_safe "$output"
    temporary=$(mktemp "$directory/.tmp.XXXXXXXXXX") || return 1
    printf '%s\n' "$content" >"$temporary" || return 1
    mv -f -- "$temporary" "$output"
}
