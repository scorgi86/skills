---
name: install-r7-office-wsl
description: Install and verify an R7 Office amd64 DEB package in a Debian-compatible Linux distribution under WSL or WSLg. Use when Codex is asked to install, reinstall, repair, or diagnose installation of r7-office from a local .deb file in Astra Linux, Debian, Ubuntu, or another APT-based WSL distribution, including dependency repair, post-install systemd services, locales, shared-library checks, and graphical launch readiness.
---

# Install R7 Office in WSL

Install the user-supplied package without changing other WSL distributions. Treat package scripts and security-related services as privileged changes that require inspection and, when material, explicit approval.

## Workflow

### 1. Resolve the targets

1. List WSL distributions and versions:

   ```powershell
   wsl --list --verbose
   ```

2. Confirm the intended distribution and absolute Windows path to the `.deb`. Do not infer a distribution when multiple plausible targets exist.
3. Verify the file and inspect package metadata:

   ```powershell
   Get-Item -LiteralPath '<windows-path>'
   wsl -d <distro> -u root -- dpkg-deb -f '<wsl-path>' Package Version Architecture Depends
   ```

4. Convert `C:\path\file.deb` to `/mnt/c/path/file.deb`. Quote paths containing spaces.
5. Require `Architecture: amd64` for an x86-64 WSL distribution. Stop on an architecture mismatch.

### 2. Check readiness

Run read-only checks:

```powershell
wsl -d <distro> -u root -- bash -lc 'cat /etc/os-release; cat /etc/astra_version 2>/dev/null || true; df -h /; apt-get update'
```

Stop if the package targets an incompatible Debian generation, the repository is unavailable, free space is insufficient, or APT/dpkg is already broken for an unrelated reason. Report the exact blocker; do not remove unrelated packages automatically.

Record WSLg availability:

```powershell
wsl -d <distro> -- bash -lc 'printf "DISPLAY=%s WAYLAND_DISPLAY=%s\n" "$DISPLAY" "$WAYLAND_DISPLAY"'
```

### 3. Install through APT

Use APT rather than raw `dpkg` so declared dependencies are resolved:

```powershell
wsl -d <distro> -u root -- bash -lc 'DEBIAN_FRONTEND=noninteractive apt-get install -y "<wsl-path>"'
```

If installation fails during `postinst`, preserve the output and inspect the failing script:

```powershell
wsl -d <distro> -u root -- bash -lc 'nl -ba /var/lib/dpkg/info/r7-office.postinst | sed -n "<start>,<end>p"'
```

Do not edit the maintainer script merely to bypass a failure.

### 4. Handle systemd and Astra security explicitly

The R7 Office package may call:

```text
systemctl enable r7-office-astra-remove-security-exec_id.service
```

Inspect the unit before enabling or installing systemd:

```powershell
wsl -d <distro> -u root -- bash -lc 'sed -n "1,120p" /lib/systemd/system/r7-office-astra-remove-security-exec_id.service 2>/dev/null || true'
```

This service can remove `security.exec_id` from the R7 Office executable. Explain that this changes an Astra security attribute and obtain explicit approval before enabling it or adding systemd solely for this purpose.

After approval, install the distribution's official systemd package and finish configuration:

```powershell
wsl -d <distro> -u root -- bash -lc 'DEBIAN_FRONTEND=noninteractive apt-get install -y systemd; dpkg --configure -a'
```

If the service uses `setfattr`, verify the command exists. Install `attr` from the official repository if needed, then apply the approved operation:

```powershell
wsl -d <distro> -u root -- bash -lc 'apt-get install -y attr; setfattr -x security.exec_id /opt/r7-office/desktopeditors/DesktopEditors 2>/dev/null || true'
```

Do not enable systemd as WSL PID 1 unless the application requires a running service and the installed systemd version is compatible with WSL. Enabling a unit and enabling systemd boot are separate decisions.

### 5. Repair locale only when needed

If package scripts report that `ru_RU.UTF-8` is unavailable, uncomment or add `ru_RU.UTF-8 UTF-8` in `/etc/locale.gen`, then run:

```bash
locale-gen ru_RU.UTF-8
```

Verify with `locale -a`. Do not treat harmless non-interactive `ttyname` warnings as installation failures.

### 6. Detect undeclared runtime libraries

The DEB metadata may omit runtime dependencies. Check the main executable:

```powershell
wsl -d <distro> -u root -- bash -lc 'ldd /opt/r7-office/desktopeditors/DesktopEditors | grep "not found" || true'
```

Resolve missing libraries only from the target distribution's official repositories:

| Missing library | Package |
|---|---|
| `libpulse.so.0` | `libpulse0` |
| `libnss3.so`, `libnssutil3.so`, `libsmime3.so` | `libnss3` |
| `libnspr4.so` | `libnspr4` |
| `libgbm.so.1` | `libgbm1` |

Re-run `ldd` after installation. Stop if any library remains unresolved.

### 7. Validate

Require all of the following:

```powershell
wsl -d <distro> -u root -- bash -lc '
  dpkg -s r7-office | grep -E "^(Status|Version):"
  test -x /opt/r7-office/desktopeditors/DesktopEditors
  ldd /opt/r7-office/desktopeditors/DesktopEditors | grep "not found" && exit 1 || true
'
```

When the Astra service was approved, also verify:

```powershell
wsl -d <distro> -u root -- systemctl is-enabled r7-office-astra-remove-security-exec_id.service
```

Confirm a desktop entry exists under `/usr/share/applications`. Do not launch the GUI unless the user asks or a visible smoke launch is acceptable.

Report the installed version, package status, unresolved warnings, service/security changes, and launch command:

```powershell
wsl -d <distro> -- /opt/r7-office/desktopeditors/DesktopEditors
```
