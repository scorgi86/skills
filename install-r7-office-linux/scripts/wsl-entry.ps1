[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Distro,

    [Parameter(Mandatory)]
    [ValidateSet('environment', 'inspect', 'operation', 'verify')]
    [string]$Stage,

    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z0-9][a-z0-9-]*[a-z0-9]$')]
    [string]$RunId,

    [string]$PackagePath,
    [string]$StateDir,
    [string]$Backend,
    [string]$Mode,
    [string]$ExpectedSha256,
    [string]$PackageName = 'r7-office',
    [string]$PackageTrust = 'untrusted',
    [string[]]$RequiredApproval = @(),
    [string[]]$ApprovedAction = @(),
    [string[]]$Dependency = @()
)

$ErrorActionPreference = 'Stop'

function Invoke-Wsl {
    param([string[]]$Arguments)

    & wsl.exe @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -notin @(0, 10, 20, 30, 40, 50, 60, 70)) {
        throw "WSL command failed with unexpected exit code $exitCode"
    }
    return $exitCode
}

$wslList = & wsl.exe --list --quiet
if ($LASTEXITCODE -ne 0 -or $Distro -notin @($wslList | ForEach-Object { $_.Trim([char]0).Trim() })) {
    throw "WSL distribution is unavailable: $Distro"
}

$scriptRootForWsl = $PSScriptRoot -replace '\\', '/'
$translatedScriptRoot = & wsl.exe -d $Distro -- wslpath -a -u $scriptRootForWsl
$linuxScriptRoot = if ($null -ne $translatedScriptRoot) { $translatedScriptRoot.Trim() } else { '' }
if ($LASTEXITCODE -ne 0 -or -not $linuxScriptRoot) {
    throw 'Unable to translate the skill script directory into a Linux path'
}

if (-not $StateDir) {
    $StateDir = "/var/tmp/r7-office-installer/$RunId"
}

$linuxPackage = $null
if ($PackagePath) {
    $resolvedPackage = (Resolve-Path -LiteralPath $PackagePath).Path
    $packageForWsl = $resolvedPackage -replace '\\', '/'
    $translatedPackage = & wsl.exe -d $Distro -- wslpath -a -u $packageForWsl
    $linuxPackage = if ($null -ne $translatedPackage) { $translatedPackage.Trim() } else { '' }
    if ($LASTEXITCODE -ne 0 -or -not $linuxPackage) {
        throw 'Unable to translate the package path into a Linux path'
    }
}

$arguments = @('-d', $Distro, '-u', 'root', '--', 'bash')

switch ($Stage) {
    'environment' {
        $arguments += @(
            "$linuxScriptRoot/environment.sh",
            '--run-id', $RunId,
            '--state-dir', $StateDir
        )
    }
    'inspect' {
        if (-not $linuxPackage) { throw 'PackagePath is required for inspect' }
        $arguments += @(
            "$linuxScriptRoot/inspect-package.sh",
            '--run-id', $RunId,
            '--state-dir', $StateDir,
            '--package', $linuxPackage
        )
    }
    'operation' {
        if (-not $Backend -or -not $Mode) {
            throw 'Backend and Mode are required for operation'
        }
        $arguments += @(
            "$linuxScriptRoot/package-operation.sh",
            '--run-id', $RunId,
            '--state-dir', $StateDir,
            '--backend', $Backend,
            '--mode', $Mode,
            '--package-trust', $PackageTrust
        )
        if ($linuxPackage) { $arguments += @('--package', $linuxPackage) }
        if ($ExpectedSha256) { $arguments += @('--expected-sha256', $ExpectedSha256) }
        foreach ($item in $RequiredApproval) { $arguments += @('--require-approval', $item) }
        foreach ($item in $ApprovedAction) { $arguments += @('--approved-action', $item) }
        foreach ($item in $Dependency) { $arguments += @('--dependency', $item) }
    }
    'verify' {
        if (-not $Backend) { throw 'Backend is required for verify' }
        $arguments += @(
            "$linuxScriptRoot/verify-installation.sh",
            '--run-id', $RunId,
            '--state-dir', $StateDir,
            '--backend', $Backend,
            '--package-name', $PackageName
        )
    }
}

$stageExitCode = Invoke-Wsl -Arguments $arguments
Write-Output "State directory: $StateDir"
exit $stageExitCode
