# Resolve `libgconf-2-4` on Debian 13

Use this workflow when a legacy R7 Office DEB fails with:

```text
r7-office : Depends: libgconf-2-4 but it is not installable
```

Debian 13 does not publish `libgconf-2-4`. Debian 12 Bookworm publishes the
legacy library as version `3.2.6-8`; it also requires the exact-version
`gconf2-common` package. Do not add an old release globally to APT sources and
do not use a third-party package site.

## Inspect and simulate

1. Confirm that the host is Debian 13 `amd64`, APT metadata is current, and
   `dpkg --audit` is empty.
2. Confirm `apt-cache policy libgconf-2-4` has no candidate. Do not interpret an
   empty result as permission to install an arbitrary DEB.
3. Resolve both packages from official Debian Bookworm metadata:
   - `libgconf-2-4_3.2.6-8_amd64.deb`
   - `gconf2-common_3.2.6-8_all.deb`
4. Download from the official `deb.debian.org` pool over HTTPS. Record the
   package URLs, sizes, and SHA-256 values from `packages.debian.org`; compare
   the downloaded files against those values before inspection.
5. Run `inspect-package.sh` for each DEB with a separate `run_id`. Require
   `known-safe` maintainer scripts and compatible architecture.
6. Run an APT simulation with both local DEBs. Require no removals, no
   downgrades of installed packages, and all remaining dependencies to resolve
   from the current Debian release. Debian 13's `libglib2.0-0t64` may satisfy
   the historical `libglib2.0-0` dependency through `Provides`.

## Approve and install

Directly downloaded Debian DEBs can still be reported as
`unsigned-or-unverified`. Request `trust-unsigned-package` separately for each
package, bound to its `run_id` and observed SHA-256. A checksum proves file
continuity, not publisher authenticity.

After approval:

1. Repeat both inspections as root and recheck both SHA-256 values.
2. Install `gconf2-common` first through `package-operation.sh --mode install`
   using APT, then install `libgconf-2-4` the same way. Pass only the exact
   approval and expected hash for the current package.
3. Stop if APT proposes removals, unrelated downgrades, an ambiguous provider,
   or dependencies from an unapproved release.
4. Verify:
   - `apt-get check` succeeds;
   - `dpkg --audit` is empty;
   - `dpkg-query -W libgconf-2-4 gconf2-common` reports `3.2.6-8`;
   - `/usr/lib/x86_64-linux-gnu/libgconf-2.so.4` exists;
   - `ldd` on the installed trusted library reports no `not found` entries.
5. Reinspect the original R7 Office DEB and retry its installation with its own
   previously required approvals and SHA-256 binding.

Treat other Debian releases, architectures, versions, hashes, dependency
changes, or package sources as a new case. Re-resolve and revalidate them
instead of copying the Bookworm result blindly.
