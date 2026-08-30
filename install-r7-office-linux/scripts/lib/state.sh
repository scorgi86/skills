#!/usr/bin/env bash

STATE_LOCK_KIND=
STATE_LOCK_PATH=
STATE_LOCK_FD=

ensure_state_dir() {
    local state_dir="$1"
    local require_root="${2:-false}"

    [ -n "$state_dir" ] || die 70 "State directory is empty"
    [ ! -L "$state_dir" ] || die 70 "State directory must not be a symbolic link: $state_dir"

    umask 077
    mkdir -p -- "$state_dir" "$state_dir/logs" "$state_dir/evidence" ||
        die 70 "Cannot create state directory: $state_dir"
    chmod 0700 -- "$state_dir" ||
        die 70 "Cannot protect state directory: $state_dir"

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
    if command -v flock >/dev/null 2>&1; then
        STATE_LOCK_PATH="$state_dir/lock"
        exec {STATE_LOCK_FD}>"$STATE_LOCK_PATH" ||
            die 70 "Cannot open state lock"
        flock -n "$STATE_LOCK_FD" ||
            die 70 "Another operation is using this state directory"
        STATE_LOCK_KIND=flock
    else
        STATE_LOCK_PATH="$state_dir/lock.d"
        mkdir -- "$STATE_LOCK_PATH" 2>/dev/null ||
            die 70 "Another operation is using this state directory"
        STATE_LOCK_KIND=mkdir
    fi
}

release_state_lock() {
    if [ "$STATE_LOCK_KIND" = mkdir ] && [ -n "$STATE_LOCK_PATH" ]; then
        rmdir -- "$STATE_LOCK_PATH" 2>/dev/null || true
    elif [ "$STATE_LOCK_KIND" = flock ] && [ -n "$STATE_LOCK_FD" ]; then
        flock -u "$STATE_LOCK_FD" 2>/dev/null || true
    fi
    STATE_LOCK_KIND=
    STATE_LOCK_PATH=
    STATE_LOCK_FD=
}

assert_output_safe() {
    local output="$1"
    [ ! -L "$output" ] || die 70 "Output must not be a symbolic link: $output"
}
