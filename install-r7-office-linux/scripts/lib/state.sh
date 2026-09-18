#!/usr/bin/env bash

STATE_LOCK_KIND=
STATE_LOCK_PATH=

ensure_state_dir() {
    local state_dir="$1"
    local require_root="${2:-false}"
    if [ "$(id -u)" -eq 0 ]; then require_root=true; fi

    [ -n "$state_dir" ] || die 70 "State directory is empty"
    [ "$require_root" != true ] || [ "$(id -u)" -eq 0 ] || die 70 "This stage requires root"
    case "$state_dir" in /*) ;; *) die 70 "State directory must be absolute" ;; esac
    local component current= owner mode
    local -a components
    IFS=/ read -r -a components <<< "$state_dir"
    for component in "${components[@]}"; do
        [ -n "$component" ] || continue
        case "$component" in .|..) die 70 "State path must not contain dot components" ;; esac
        current="$current/$component"
        [ ! -L "$current" ] || die 70 "State path contains a symbolic link: $current"
        if [ -e "$current" ]; then
            [ -d "$current" ] || die 70 "State path component is not a directory"
            if [ "$require_root" = true ]; then
                owner=$(stat -c '%u' -- "$current")
                mode=$(stat -c '%a' -- "$current")
                [ "$owner" = 0 ] || die 70 "Root state ancestry is not owned by root"
                if (( (8#$mode & 0022) != 0 )); then
                    (( (8#$mode & 01000) != 0 )) || die 70 "Root state ancestry is writable by others"
                fi
            fi
        fi
    done
    for current in "$state_dir/logs" "$state_dir/evidence"; do
        [ ! -L "$current" ] || die 70 "State child must not be a symbolic link"
        [ ! -e "$current" ] || [ -d "$current" ] || die 70 "State child must be a directory"
    done

    umask 077
    mkdir -p -- "$state_dir" "$state_dir/logs" "$state_dir/evidence" ||
        die 70 "Cannot create state directory: $state_dir"
    chmod 0700 -- "$state_dir" ||
        die 70 "Cannot protect state directory: $state_dir"
    chmod 0700 -- "$state_dir/logs" "$state_dir/evidence" || die 70 "Cannot protect state children"
    local unsafe
    unsafe=$(find "$state_dir" -type l -print -quit)
    [ -z "$unsafe" ] || die 70 "State contains a symbolic link: $unsafe"
    unsafe=$(find "$state_dir" -type f -links +1 -print -quit)
    [ -z "$unsafe" ] || die 70 "State contains a file with multiple links: $unsafe"
    if [ "$require_root" = true ]; then
        unsafe=$(find "$state_dir" ! -uid 0 -print -quit)
        [ -z "$unsafe" ] || die 70 "Root state contains a user-owned entry"
    fi

    if [ "$require_root" = true ] && [ "$(id -u)" -ne 0 ]; then
        die 70 "This stage requires root"
    fi

    if [ "$require_root" = true ]; then
        local owner
        owner=$(stat -c '%u' -- "$state_dir" 2>/dev/null || printf 'unknown')
        [ "$owner" = 0 ] || die 70 "Root state directory is not owned by root"
    fi
}

acquire_state_lock() {
    local state_dir="$1"
    STATE_LOCK_PATH="$state_dir/lock.d"
    mkdir -- "$STATE_LOCK_PATH" 2>/dev/null || die 70 "Another operation is using this state directory"
    STATE_LOCK_KIND=mkdir
}

release_state_lock() {
    if [ "$STATE_LOCK_KIND" = mkdir ] && [ -n "$STATE_LOCK_PATH" ]; then
        rmdir -- "$STATE_LOCK_PATH" 2>/dev/null || true
    fi
    STATE_LOCK_KIND=
    STATE_LOCK_PATH=
}

assert_output_safe() {
    local output="$1"
    [ ! -L "$output" ] || die 70 "Output must not be a symbolic link: $output"
    [ ! -e "$output" ] || { [ -f "$output" ] && [ "$(stat -c '%h' -- "$output")" = 1 ]; } ||
        die 70 "Output must be a regular file with one link: $output"
}
