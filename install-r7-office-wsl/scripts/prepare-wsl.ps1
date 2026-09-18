[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Distro,
    [Parameter(Mandatory)][string]$LinuxUser,
    [Parameter(Mandatory)][string]$WorkspaceRoot,
    [string]$PackagePath,
    [string]$EditorRoot = '/opt/r7-office/desktopeditors',
    [string]$LogDirectory = (Join-Path $env:LOCALAPPDATA ('R7-Office/prepare/' + [guid]::NewGuid().ToString('N')))
)
$ErrorActionPreference = 'Stop'
$script:PowerShell = (Get-Process -Id $PID).Path
$script:Stages = [Collections.Generic.List[object]]::new()
function Quote-NativeArgument {
    param([string]$Value)
    if ($Value -and $Value -notmatch '[\s"]') { return $Value }
    '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
function Invoke-Stage {
    param([string]$Name, [string]$FilePath, [string[]]$Arguments, [switch]$AllowFailure)
    $stdout = Join-Path $LogDirectory "$Name.stdout.log"
    $stderr = Join-Path $LogDirectory "$Name.stderr.log"
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $code = 1
    $process = [Diagnostics.Process]::new()
    try {
        $process.StartInfo.FileName = $FilePath
        $process.StartInfo.Arguments = ($Arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' '
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        if (-not $process.Start()) { throw "Cannot start $Name" }
        $outputTask = $process.StandardOutput.ReadToEndAsync()
        $errorTask = $process.StandardError.ReadToEndAsync()
        while (-not $process.WaitForExit(30000)) { Write-Host "Running: $Name ($([int]$timer.Elapsed.TotalSeconds)s)" }
        $code = $process.ExitCode
        [IO.File]::WriteAllText($stdout, $outputTask.Result, [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText($stderr, $errorTask.Result, [Text.UTF8Encoding]::new($false))
    } catch {
        [IO.File]::WriteAllText($stdout, '', [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText($stderr, $_.ToString(), [Text.UTF8Encoding]::new($false))
    } finally { $timer.Stop(); $process.Dispose() }
    $record = [pscustomobject]@{ Name = $Name; Status = $(if ($code -eq 0) { 'success' } else { 'failed' }); ExitCode = $code; Seconds = $timer.Elapsed.TotalSeconds; Stdout = $stdout; Stderr = $stderr }
    $script:Stages.Add($record)
    Write-Host "$Name`: $($record.Status); exit=$code; seconds=$([math]::Round($record.Seconds, 2))"
    if ($code -ne 0 -and -not $AllowFailure) { throw "Stage $Name failed ($code); logs: $stderr and $stdout" }
    $record
}
function Invoke-Preparation {
    $planned = @('preflight', 'run-directory', 'metadata', 'environment', 'disable', 'install', 'package-verify', 'alias', 'enable', 'verify')
    $entry = Join-Path $PSScriptRoot '../../install-r7-office-linux/scripts/wsl-entry.ps1'
    $dev = Join-Path $PSScriptRoot 'wsl-dev.ps1'
    $runId = 'install-' + [guid]::NewGuid().ToString('N')
    $devArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $dev, '-Distro', $Distro, '-LinuxUser', $LinuxUser, '-WorkspaceRoot', $WorkspaceRoot, '-EditorRoot', $EditorRoot)
    $adapterArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $entry, '-Distro', $Distro, '-RunId', $runId)
    $current = 'preflight'; $status = 'success'; $message = ''; $version = $null; $stateDir = ''; $mountState = 'unchanged'; $packageOperation = 'not-run'
    try {
        Invoke-Stage -Name $current -FilePath $script:PowerShell -Arguments ($devArgs + @('-Action', 'Preflight')) | Out-Null
        $current = 'run-directory'
        $record = Invoke-Stage -Name $current -FilePath 'wsl.exe' -Arguments @('-d', $Distro, '-u', 'root', '--exec', 'mktemp', '-d', '/var/tmp/r7-office.XXXXXXXX')
        $stateDir = (Get-Content -Raw $record.Stdout).Trim()
        if ($stateDir -notmatch '^/var/tmp/r7-office\.[A-Za-z0-9]+$') { throw 'Invalid private run directory' }
        $adapterArgs += @('-StateDir', $stateDir)
        $expectedVersion = ''
        if ($PackagePath) {
            $current = 'metadata'
            $record = Invoke-Stage -Name $current -FilePath $script:PowerShell -Arguments ($adapterArgs + @('-Stage', 'metadata', '-Backend', 'apt', '-PackagePath', $PackagePath))
            $metadata = Get-Content -Raw $record.Stdout | ConvertFrom-Json
            if ($metadata.name -ne 'r7-office' -or $metadata.format -ne 'deb' -or $metadata.architecture -ne 'amd64') { throw 'WSL preparation requires an amd64 R7 Office DEB' }
            $expectedVersion = $metadata.version
            $current = 'environment'
            $record = Invoke-Stage -Name $current -FilePath $script:PowerShell -Arguments ($adapterArgs + @('-Stage', 'environment'))
            $environment = Get-Content -Raw $record.Stdout | ConvertFrom-Json
            if ($environment.os.architecture -ne 'amd64' -or $environment.selected_backend -ne 'apt' -or $environment.package_database -ne 'healthy') { throw 'WSL environment is incompatible' }
            if ($environment.free_space_kb -lt $metadata.installed_size_kb) { throw 'Insufficient disk space' }
            $current = 'disable'
            Invoke-Stage -Name $current -FilePath $script:PowerShell -Arguments ($devArgs + @('-Action', 'Disable')) | Out-Null
            $mountState = 'disconnected'
            $current = 'install'; $packageOperation = 'failed'
            Invoke-Stage -Name $current -FilePath $script:PowerShell -Arguments ($adapterArgs + @('-Stage', 'operation', '-Backend', 'apt', '-Mode', 'install', '-PackagePath', $PackagePath)) | Out-Null
            $packageOperation = 'completed'
        }
        $current = 'package-verify'
        $verifyArgs = $adapterArgs + @('-Stage', 'verify', '-Backend', 'apt', '-Binary', "$EditorRoot/DesktopEditors")
        if ($expectedVersion) { $verifyArgs += @('-ExpectedVersion', $expectedVersion) }
        $record = Invoke-Stage -Name $current -FilePath $script:PowerShell -Arguments $verifyArgs
        $verification = Get-Content -Raw $record.Stdout | ConvertFrom-Json
        $version = $verification.package.version
        foreach ($action in @('Alias', 'Enable', 'Verify')) {
            $current = $action.ToLowerInvariant()
            Invoke-Stage -Name $current -FilePath $script:PowerShell -Arguments ($devArgs + @('-Action', $action)) | Out-Null
            if ($action -eq 'Enable') { $mountState = 'connected' }
        }
    } catch {
        $status = 'failed'; $message = $_.ToString()
        if ($current -eq 'enable') { $mountState = 'unknown-after-rollback' }
    }
    foreach ($name in $planned) {
        if ($name -notin @($script:Stages | Select-Object -ExpandProperty Name)) {
            $script:Stages.Add([pscustomobject]@{ Name=$name; Status='skipped'; ExitCode=$null; Seconds=$null; Stdout=$null; Stderr=$null })
        }
    }
    [pscustomobject]@{
        Status=$status; FailedStage=$(if($status -eq 'failed'){$current}else{$null}); Error=$message
        Distro=$Distro; LinuxUser=$LinuxUser; WorkspaceRoot=$WorkspaceRoot; EditorRoot=$EditorRoot
        Version=$version; PackageOperation=$packageOperation; MountState=$mountState; Mounts=@()
        LinuxStateDirectory=$stateDir; Stages=@($script:Stages.ToArray()); ModelTokens=$null; ModelInferenceSeconds=$null
    }
}
if ($MyInvocation.InvocationName -eq '.') { return }
$LogDirectory = [IO.Path]::GetFullPath($LogDirectory)
if (Test-Path -LiteralPath $LogDirectory) {
    if (@(Get-ChildItem -LiteralPath $LogDirectory -Force).Count) { throw 'LogDirectory must be new or empty' }
}
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
$result = Invoke-Preparation
# Read-only kernel snapshot also works after a failed installation or rollback.
$mounts = foreach ($resource in @('sdkjs', 'web-apps')) {
    $target = "$EditorRoot/editors/$resource"
    $record = Invoke-Stage -Name "mount-$resource" -FilePath 'wsl.exe' -Arguments @('-d', $Distro, '-u', 'root', '--exec', 'findmnt', '-n', '-o', 'SOURCE', '-M', $target) -AllowFailure
    [pscustomobject]@{ Target=$target; Source=$(if($record.ExitCode -eq 0){(Get-Content -Raw $record.Stdout).Trim()}else{$null}); State=$(if($record.ExitCode -eq 0){'mounted'}elseif($record.ExitCode -eq 1){'absent'}else{'unknown'}) }
}
$result.Mounts = @($mounts)
$result.Stages = @($script:Stages.ToArray())
$json = $result | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $LogDirectory 'summary.json'), $json, [Text.UTF8Encoding]::new($false))
Write-Output $json
if ($result.Status -ne 'success') { exit 1 }
