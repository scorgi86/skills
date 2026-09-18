[CmdletBinding()]
param(
    [ValidateSet('Preflight', 'Inspect', 'Enable', 'Verify', 'Launch', 'Disable', 'Alias')][string]$Action = 'Inspect',
    [Parameter(Mandatory)][string]$WorkspaceRoot,
    [Parameter(Mandatory)][string]$Distro,
    [Parameter(Mandatory)][string]$LinuxUser,
    [string]$EditorRoot = '/opt/r7-office/desktopeditors',
    [string]$StateDirectory = (Join-Path $env:LOCALAPPDATA 'R7-Office/wsl-dev')
)
$ErrorActionPreference = 'Stop'
if ($LinuxUser -eq 'root') { throw 'Select an ordinary Linux user' }
if ($EditorRoot -notmatch '^/' -or $EditorRoot.Contains("`n")) { throw 'EditorRoot must be an absolute Linux path' }
$WorkspaceRoot = [System.IO.Path]::GetFullPath($WorkspaceRoot)
if ($Action -ne 'Disable') { $WorkspaceRoot = (Resolve-Path -LiteralPath $WorkspaceRoot).Path }
$hasher = [System.Security.Cryptography.SHA256]::Create()
try { $key = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes("$Distro|$EditorRoot")))).Replace('-', '').Substring(0, 16).ToLowerInvariant() }
finally { $hasher.Dispose() }
$keeperName = "r7-office-dev-$key"
$keeper = "$keeperName infinity"
$stateFile = Join-Path $StateDirectory "$key.json"
$savedState = if (Test-Path -LiteralPath $stateFile) { Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json } else { $null }
function Invoke-Linux {
    param([string[]]$Command, [string]$User = 'root', [int[]]$Allowed = @(0))
    $preference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& wsl.exe -d $Distro -u $User --exec @Command)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $preference }
    if ($code -notin $Allowed) { throw "WSL failed ($code): $($Command -join ' ')`n$($output -join "`n")" }
    [pscustomobject]@{ Code = $code; Output = $output }
}
function Assert-Closed {
    $result = Invoke-Linux -Command @('pgrep', '-a', '-x', 'DesktopEditors') -Allowed @(0, 1)
    if ($result.Code -eq 0) { throw "Close R7 Office: $($result.Output -join ' ')" }
}
function Get-Mounted {
    param($Mapping)
    if ($Action -eq 'Disable') {
        $exists = Invoke-Linux -Command @('test', '-e', $Mapping.Target) -Allowed @(0, 1)
        if ($exists.Code -eq 1) { return $false }
    }
    $result = Invoke-Linux -Command @('mountpoint', '-q', '--', $Mapping.Target) -Allowed @(0, 32)
    if ($result.Code -eq 32) { return $false }
    if ($Action -eq 'Disable') {
        $record = @($savedState.Mappings | Where-Object { $_.Target -eq $Mapping.Target })
        if ($record.Count -ne 1) { throw "No saved identity for mount: $($Mapping.Target)" }
        $actual = (Invoke-Linux -Command @('findmnt', '-n', '-o', 'SOURCE', '-M', $Mapping.Target)).Output -join "`n"
        if ($actual -ne $record[0].MountSource) { throw "Refusing to remove an unknown mount: $($Mapping.Target)" }
        return $true
    }
    Invoke-Linux -Command @('test', $Mapping.Source, '-ef', $Mapping.Target) | Out-Null
    return $true
}
function Assert-Build {
    foreach ($mapping in $mappings) {
        foreach ($relative in $mapping.Artifacts) {
            $file = Join-Path $mapping.WindowsSource $relative
            if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -eq 0) {
                throw "Build artifact missing or empty: $file"
            }
            Invoke-Linux -User $LinuxUser -Command @('test', '-r', "$($mapping.Source)/$relative") | Out-Null
        }
    }
}
function Assert-Enabled {
    Assert-Build
    foreach ($mapping in $mappings) {
        if (-not (Get-Mounted $mapping)) { throw "Mount absent: $($mapping.Target)" }
        foreach ($relative in $mapping.Artifacts) {
            Invoke-Linux -User $LinuxUser -Command @('test', '-r', "$($mapping.Target)/$relative") | Out-Null
        }
        Invoke-Linux -Command @('findmnt', '-T', $mapping.Target) | Select-Object -ExpandProperty Output
    }
    Invoke-Linux -Command @('pgrep', '-f', '-x', $keeper) | Select-Object -ExpandProperty Output
}
function Save-MountState {
    $records = @($mappings | Where-Object { Get-Mounted $_ } | ForEach-Object {
        [pscustomobject]@{ Target = $_.Target; Source = $_.Source;
            MountSource = (Invoke-Linux -Command @('findmnt', '-n', '-o', 'SOURCE', '-M', $_.Target)).Output -join "`n" }
    })
    New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
    [pscustomobject]@{ Distro = $Distro; EditorRoot = $EditorRoot; Mappings = $records } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $stateFile -Encoding UTF8
}
$binary = "$EditorRoot/DesktopEditors"
if ($Action -ne 'Disable') {
    $uid = (Invoke-Linux -User $LinuxUser -Command @('id', '-u')).Output -join ''
    if ($uid.Trim() -eq '0') { throw 'The application user must not have UID 0' }
    if ($Action -ne 'Preflight') {
        $status = Invoke-Linux -Command @('dpkg-query', '-W', '-f=${Status}\n${Version}\n', 'r7-office')
        if ($status.Output[0] -ne 'install ok installed') { throw 'r7-office is not fully installed' }
        Invoke-Linux -User $LinuxUser -Command @('test', '-x', $binary) | Out-Null
    }
}
if ($Action -eq 'Alias') {
    $aliasScript = ((Invoke-Linux -User $LinuxUser -Command @('wslpath', '-a', '-u', (Join-Path $PSScriptRoot 'wsl-alias.sh'))).Output -join '').Trim()
    Invoke-Linux -User $LinuxUser -Command @('bash', $aliasScript, $binary) | Select-Object -ExpandProperty Output
    return
}
$mappings = @(
    @{ Name = 'sdkjs'; Artifacts = @('word/sdk-all.js', 'cell/sdk-all.js', 'slide/sdk-all.js') },
    @{ Name = 'web-apps'; Artifacts = @('apps/documenteditor/main/index.html', 'apps/spreadsheeteditor/main/index.html', 'apps/presentationeditor/main/index.html') }
)
foreach ($mapping in $mappings) {
    $mapping.WindowsSource = Join-Path $WorkspaceRoot "Editors/editors/$($mapping.Name)"
    if ($Action -ne 'Disable') {
        $mapping.Source = ((Invoke-Linux -User $LinuxUser -Command @('wslpath', '-a', '-u', $mapping.WindowsSource)).Output -join '').Trim()
    }
    $mapping.Target = "$EditorRoot/editors/$($mapping.Name)"
    if ($Action -eq 'Preflight') { continue }
    if ($Action -ne 'Disable') {
        Invoke-Linux -Command @('test', '-d', $mapping.Target) | Out-Null
        Invoke-Linux -Command @('test', '!', '-L', $mapping.Target) | Out-Null
    }
    [pscustomobject]@{ Resource = $mapping.Name; WindowsSource = $mapping.WindowsSource; Target = $mapping.Target; Mounted = Get-Mounted $mapping }
}
if ($Action -eq 'Preflight') {
    Assert-Build
    Assert-Closed
    foreach ($mapping in $mappings) {
        $exists = Invoke-Linux -Command @('test', '-e', $mapping.Target) -Allowed @(0, 1)
        if ($exists.Code -eq 0) { Get-Mounted $mapping | Out-Null }
    }
    Write-Output 'Preflight: Windows artifacts readable; editor closed; existing mounts compatible'
    return
}
if ($Action -eq 'Inspect') { return }
if ($Action -eq 'Disable') {
    Assert-Closed
    for ($index = $mappings.Count - 1; $index -ge 0; $index--) {
        if (Get-Mounted $mappings[$index]) { Invoke-Linux -Command @('umount', '--', $mappings[$index].Target) | Out-Null }
    }
    Invoke-Linux -Command @('pkill', '-f', '-x', $keeper) -Allowed @(0, 1) | Out-Null
    if (Test-Path -LiteralPath $stateFile) { Remove-Item -LiteralPath $stateFile }
    return
}
Assert-Build
if ($Action -eq 'Enable') {
    Assert-Closed
    $created = @()
    $startedKeeper = $false
    try {
        $check = Invoke-Linux -Command @('pgrep', '-f', '-x', $keeper) -Allowed @(0, 1)
        if ($check.Code -eq 1) {
            $launchDistro = if ($Distro -match '\s') { '"{0}"' -f $Distro } else { $Distro }
            $keeperScript = (Invoke-Linux -Command @('wslpath', '-a', '-u', (Join-Path $PSScriptRoot 'wsl-keeper.sh'))).Output -join ''
            $launchKeeperScript = if ($keeperScript -match '\s') { '"{0}"' -f $keeperScript } else { $keeperScript }
            $childArgs = @('-d', $launchDistro, '-u', 'root', '--exec', 'bash', $launchKeeperScript, $keeperName)
            Start-Process -FilePath 'wsl.exe' -ArgumentList $childArgs -WindowStyle Hidden | Out-Null
            $startedKeeper = $true
            for ($attempt = 0; $attempt -lt 20; $attempt++) {
                Start-Sleep -Milliseconds 250
                $check = Invoke-Linux -Command @('pgrep', '-f', '-x', $keeper) -Allowed @(0, 1)
                if ($check.Code -eq 0) { break }
            }
            if ($check.Code -ne 0) { throw 'Keeper did not start' }
        }
        foreach ($mapping in $mappings) {
            if (-not (Get-Mounted $mapping)) {
                Invoke-Linux -Command @('mount', '--bind', '--', $mapping.Source, $mapping.Target) | Out-Null
                $created += $mapping
            }
            Save-MountState
        }
        Assert-Enabled
        Save-MountState
    } catch {
        $originalError = $_
        $rollbackErrors = @()
        for ($index = $created.Count - 1; $index -ge 0; $index--) {
            try { Invoke-Linux -Command @('umount', '--', $created[$index].Target) | Out-Null } catch { $rollbackErrors += $_ }
        }
        if ($startedKeeper -and $rollbackErrors.Count -eq 0) {
            try { Invoke-Linux -Command @('pkill', '-f', '-x', $keeper) -Allowed @(0, 1) | Out-Null } catch { $rollbackErrors += $_ }
        }
        if ($rollbackErrors.Count) { throw "Setup failed: $originalError. Rollback incomplete: $($rollbackErrors -join '; ')" }
        throw $originalError
    }
    return
}
Assert-Enabled
$libraries = Invoke-Linux -User $LinuxUser -Command @('ldd', $binary)
if (($libraries.Output -join "`n") -match 'not found') { throw "Unresolved libraries: $($libraries.Output -join "`n")" }
$audit = Invoke-Linux -Command @('dpkg', '--audit')
if ($audit.Output.Count) { throw "Unfinished package operations: $($audit.Output -join ' ')" }
Invoke-Linux -Command @('apt-get', 'check') | Select-Object -ExpandProperty Output
if ($Action -eq 'Launch') {
    Assert-Closed
    $display = Invoke-Linux -User $LinuxUser -Command @('printenv', 'DISPLAY')
    if (-not ($display.Output -join '').Trim()) { throw 'DISPLAY is absent; check WSLg/X11' }
    $launchDistro = if ($Distro -match '\s') { '"{0}"' -f $Distro } else { $Distro }
    $launchBinary = if ($binary -match '\s') { '"{0}"' -f $binary } else { $binary }
    $childArgs = @('-d', $launchDistro, '-u', $LinuxUser, '--exec',
        $launchBinary, '--ascdesktop-support-debug-info')
    Start-Process -FilePath 'wsl.exe' -ArgumentList $childArgs -WindowStyle Hidden | Out-Null
}
Write-Output "Verified: $Distro; user=$LinuxUser; r7-office=$($status.Output[1])"
