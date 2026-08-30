# Package backend contract

Every backend file defines the same shell functions:

```text
backend_available
backend_check_cache
backend_refresh
backend_audit
backend_query_installed
backend_install_local
backend_install_names
backend_find_provider
backend_repair
```

Functions return normal shell exit codes. Human-readable diagnostics go to stderr. Query functions print one normalized value to stdout.

## Provider search values

`backend_find_provider` prints one of:

```text
provider-found:<package>
provider-ambiguous
provider-index-required
provider-search-unavailable
provider-not-found
```

Only `provider-found:<package>` may be routed to a later dependency-install operation.

## Backend priority

For DEB, prefer `apt`, then `apt-get`. Use `dpkg` only for inspection, audit, or an explicitly safe operation with already satisfied dependencies.

For RPM, prefer `dnf`, then `zypper`, then `yum`. Use `rpm` for inspection and signature checks; do not use `rpm -U` when dependency resolution is required.

Metadata refresh is a distinct mutation. `backend_check_cache` must not refresh it.
