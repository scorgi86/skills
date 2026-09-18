[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Distro,
    [Parameter(Mandatory)][ValidateSet('environment', 'metadata', 'inspect', 'operation', 'verify')][string]$Stage,
    [string]$RunId = ('install-' + [guid]::NewGuid().ToString('N')),
    [string]$PackagePath, [string]$StateDir, [string]$Backend, [string]$Mode = 'install',
    [string]$ExpectedSha256, [string]$ExpectedVersion, [string]$PackageName = 'r7-office',
    [string]$Binary = '/opt/r7-office/desktopeditors/DesktopEditors',
    [string[]]$ApprovedAction = @(), [string[]]$Dependency = @()
)
# Native stderr is diagnostic; the native exit code determines failure.
$ErrorActionPreference = 'Continue'
$wslList = @(& wsl.exe --list --quiet)
if ($LASTEXITCODE -ne 0 -or $Distro -notin @($wslList | ForEach-Object { ($_ -replace "`0", '').Trim() })) { throw "WSL distribution is unavailable: $Distro" }
$linuxScriptRoot = @(& wsl.exe -d $Distro -u root --exec wslpath -a -u ($PSScriptRoot -replace '\\', '/')) -join ''
if ($LASTEXITCODE -ne 0 -or -not $linuxScriptRoot) { throw 'Unable to translate script directory' }
$linuxScriptRoot = $linuxScriptRoot.Trim()
$linuxPackage = ''
if ($PackagePath) {
    $resolved = (Resolve-Path -LiteralPath $PackagePath -ErrorAction Stop).Path
    $linuxPackage = @(& wsl.exe -d $Distro -u root --exec wslpath -a -u ($resolved -replace '\\', '/')) -join ''
    if ($LASTEXITCODE -ne 0 -or -not $linuxPackage) { throw 'Unable to translate package path' }
    $linuxPackage = $linuxPackage.Trim()
}
if (-not $StateDir -and $Stage -ne 'metadata') {
    $StateDir = @(& wsl.exe -d $Distro -u root --exec mktemp -d /var/tmp/r7-office.XXXXXXXX) -join ''
    if ($LASTEXITCODE -ne 0 -or -not $StateDir) { throw 'Cannot create private run directory' }
    $StateDir = $StateDir.Trim()
}
$arguments = @('-d', $Distro, '-u', 'root', '--exec', 'bash')
$resultFile = ''
switch ($Stage) {
    'metadata' {
        if (-not $linuxPackage) { throw 'PackagePath is required' }
        $arguments += @("$linuxScriptRoot/package-info.sh", '--package', $linuxPackage)
        if ($Backend) { $arguments += @('--backend', $Backend) }
    }
    'environment' {
        $arguments += @("$linuxScriptRoot/environment.sh", '--run-id', $RunId, '--state-dir', $StateDir)
        $resultFile = 'environment.json'
    }
    'inspect' {
        if (-not $linuxPackage) { throw 'PackagePath is required' }
        $arguments += @("$linuxScriptRoot/inspect-package.sh", '--run-id', $RunId, '--state-dir', $StateDir, '--package', $linuxPackage)
        $resultFile = 'package.json'
    }
    'operation' {
        $arguments += @("$linuxScriptRoot/package-operation.sh", '--run-id', $RunId, '--state-dir', $StateDir, '--mode', $Mode)
        if ($Backend) { $arguments += @('--backend', $Backend) }
        if ($linuxPackage) { $arguments += @('--package', $linuxPackage) }
        if ($ExpectedSha256) { $arguments += @('--expected-sha256', $ExpectedSha256) }
        foreach ($item in $ApprovedAction) { $arguments += @('--approved-action', $item) }
        foreach ($item in $Dependency) { $arguments += @('--dependency', $item) }
        $resultFile = 'operation.json'
    }
    'verify' {
        if (-not $Backend) { throw 'Backend is required' }
        $arguments += @("$linuxScriptRoot/verify-installation.sh", '--run-id', $RunId, '--state-dir', $StateDir, '--backend', $Backend, '--package-name', $PackageName, '--binary', $Binary)
        if ($ExpectedVersion) { $arguments += @('--expected-version', $ExpectedVersion) }
        $resultFile = 'verification.json'
    }
}
& wsl.exe @arguments
$code = $LASTEXITCODE
if ($resultFile) {
    & wsl.exe -d $Distro -u root --exec cat "$StateDir/$resultFile"
    if ($LASTEXITCODE -ne 0 -and $code -eq 0) { $code = $LASTEXITCODE }
    [Console]::Error.WriteLine("State directory: $StateDir")
}
exit $code
