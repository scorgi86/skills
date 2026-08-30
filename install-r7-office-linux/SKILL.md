---
name: install-r7-office-linux
description: Safely inspect, install, upgrade, repair, and verify local R7 Office DEB or RPM packages on Linux and WSL without assuming a specific distribution or package manager. Use when Codex needs to handle R7 Office packages through APT, DNF, Zypper, or YUM; analyze maintainer scripts and signatures; request approval for services or security attributes; resolve runtime libraries; or diagnose an incomplete installation.
---

# Install R7 Office on Linux

Route installation through small, deterministic stages. Keep inspection non-mutating. Never run package scripts, refresh repository metadata, enable services, or alter security attributes before the corresponding plan and approval boundary.

## Scope

Support DEB with APT/APT-GET and RPM with DNF/Zypper/YUM. Treat WSL as a transport layer. Return `unsupported` for other formats instead of improvising a low-level installation.

## Prepare a run

1. Resolve the target Linux environment and package path.
2. Use a unique `run_id` containing only lowercase letters, digits, and hyphens.
3. For unprivileged inspection, use:

   ```text
   ${XDG_STATE_HOME:-$HOME/.local/state}/r7-office-installer/<run-id>
   ```

4. For root operations, use:

   ```text
   /var/tmp/r7-office-installer/<run-id>
   ```

5. Do not trust user-owned state for mutations. Re-run inspection as root and recheck the package SHA-256 before any change.

Read [references/state-schema.md](references/state-schema.md) when interpreting stage results. Read [references/backend-contract.md](references/backend-contract.md) when adding or diagnosing a package-manager backend.

## Route the stages

### 1. Detect the environment

Run:

```bash
bash scripts/environment.sh --run-id "$RUN_ID" --state-dir "$STATE_DIR"
```

Review `environment.json`. Stop on an unsupported architecture, broken package database, missing safe backend, or insufficient disk space.

This stage reads the current metadata cache but does not refresh it.

### 2. Inspect the package

Run:

```bash
bash scripts/inspect-package.sh \
  --run-id "$RUN_ID" \
  --state-dir "$STATE_DIR" \
  --package "$PACKAGE"
```

Review `package.json` and evidence under `evidence/`.

- Verify format and architecture.
- Distinguish integrity, authenticity, and user trust.
- Inspect DEB maintainer scripts or RPM scriptlets before installation.
- Treat `unknown-privileged` actions as a stop condition.
- Do not use `ldd` on files from an untrusted package.

### 3. Build the plan and cross the approval boundary

Explain every entry in `required_approvals`. Approvals must be exact actions, for example:

```text
trust-unsigned-package
remove-security-exec-id
enable-r7-service
```

Bind approvals to the current `run_id` and package SHA-256. Never accept `approve-all`.

Repository metadata refresh is a separate planned mutation. Use `refresh-metadata` only when the cache is absent or unsuitable and the installation request authorizes normal dependency resolution.

### 4. Execute one package operation

Use explicit arguments derived from the inspected result:

```bash
bash scripts/package-operation.sh \
  --run-id "$RUN_ID" \
  --state-dir "$ROOT_STATE_DIR" \
  --package "$PACKAGE" \
  --expected-sha256 "$SHA256" \
  --backend "$BACKEND" \
  --mode install
```

Available modes:

- `refresh-metadata`
- `install`
- `upgrade`
- `repair`
- `install-dependencies`
- `configure-integration`

Pass each required and approved action explicitly. The script must reject missing, mismatched, or broader approvals.

Do not use a low-level backend such as `dpkg` or `rpm` when dependencies require resolution.

### 5. Verify runtime requirements

After a trusted package has been installed, run:

```bash
bash scripts/verify-installation.sh \
  --run-id "$RUN_ID" \
  --state-dir "$ROOT_STATE_DIR" \
  --backend "$BACKEND" \
  --package-name r7-office
```

Review `verification.json`.

- Require a healthy package database.
- Require an installed R7 Office package and executable.
- Use `ldd` only after installation.
- Treat ambiguous or unavailable library-provider searches as unresolved.
- Install a uniquely identified dependency only through a separate `install-dependencies` operation.
- When APT reports that `libgconf-2-4` is not installable on Debian 13,
  read [references/debian-libgconf.md](references/debian-libgconf.md) and
  follow its compatibility and trust workflow before retrying R7 Office.
- Do not launch the GUI unless the user requests it or explicitly accepts a visible smoke test.

## WSL entry

Use `scripts/wsl-entry.ps1` to select a WSL distribution, translate a Windows package path, and invoke the same Linux scripts. Do not put APT, RPM, Astra, or systemd policy in the PowerShell adapter.

## Security rules

- A SHA-256 match proves continuity, not publisher authenticity.
- Check RPM signatures with `rpmkeys`; check DEB signatures only when supported metadata and tools exist.
- Require explicit trust for an unsigned local package.
- Never install systemd solely to satisfy an unreviewed package script.
- Inspect service units before enabling them.
- Distinguish an absent `security.exec_id` attribute from permission or filesystem errors.
- Never hide security-operation failures with unconditional `|| true`.
- Keep arbitrary command output in log files, not embedded in JSON.

## Completion report

Report:

- package format, version, architecture, and SHA-256;
- selected backend;
- signature/trust result;
- metadata refresh and package changes;
- approved service or security actions;
- package database health;
- unresolved libraries or warnings;
- WSLg/X11/Wayland readiness;
- launch command when applicable.

## Stop conditions

Stop and return to the user when:

- the package changes after inspection;
- architecture is incompatible;
- signature verification fails;
- an unsigned package is not explicitly trusted;
- a privileged package action is unknown;
- no backend can resolve required dependencies safely;
- the package database is broken by an unrelated operation;
- a library provider is ambiguous;
- root state ownership or locking is invalid;
- a requested service/security action is not explicitly approved.
