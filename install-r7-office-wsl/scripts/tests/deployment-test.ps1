[CmdletBinding()]
param([Parameter(Mandatory)][string]$Distro, [Parameter(Mandatory)][string]$LinuxUser)
$ErrorActionPreference = 'Stop'
$runId = [guid]::NewGuid().ToString('N')
$testWorkspace = Join-Path ([IO.Path]::GetTempPath()) "r7-deployment-test-$runId"
$linuxFixture = "/var/tmp/r7-deployment-test-$runId"
$entry = Join-Path $PSScriptRoot '../wsl-dev.ps1'
$testState = Join-Path $testWorkspace 'state'
function Linux {
    param([string[]]$Command)
    & wsl.exe -d $Distro -u root --exec @Command
    if ($LASTEXITCODE -ne 0) { throw "Test preparation/cleanup failed: $($Command -join ' ')" }
}
function Run {
    param($Action)
    & $entry -Action $Action -WorkspaceRoot $testWorkspace -Distro $Distro -LinuxUser $LinuxUser -EditorRoot $linuxFixture -StateDirectory $testState
}
$enabled = $false
try {
    New-Item -ItemType Directory -Path $testWorkspace | Out-Null
    $artifacts = @('sdkjs/word/sdk-all.js', 'sdkjs/cell/sdk-all.js', 'sdkjs/slide/sdk-all.js',
        'web-apps/apps/documenteditor/main/index.html', 'web-apps/apps/spreadsheeteditor/main/index.html',
        'web-apps/apps/presentationeditor/main/index.html')
    foreach ($relative in $artifacts) {
        $file = Join-Path $testWorkspace "Editors/editors/$relative"
        New-Item -ItemType Directory -Path (Split-Path $file) -Force | Out-Null
        [IO.File]::WriteAllText($file, 'deployment test fixture')
    }
    Linux @('mkdir', '-p', '--', "$linuxFixture/editors/sdkjs", "$linuxFixture/editors/web-apps")
    # Test the supplied orchestration against a harmless executable, never the installed GUI.
    Linux @('cp', '--', '/bin/sleep', "$linuxFixture/DesktopEditors")
    Run Inspect
    $enabled = $true
    Run Enable
    Run Enable
    Run Verify
    Run Disable
    $enabled = $false
    Run Disable
    Write-Output 'PASS: native WSL inspect, bind mounts, keeper, idempotence, verification, disable'
} finally {
    $cleanupSafe = $true
    if ($enabled) {
        try { Run Disable } catch { $cleanupSafe = $false; Write-Warning "Preserving test fixtures and state: $_" }
    }
    if ($cleanupSafe) {
        if ($linuxFixture -notmatch '^/var/tmp/r7-deployment-test-[a-f0-9]{32}$') { throw 'Unsafe Linux cleanup target' }
        Linux @('rm', '-r', '--', $linuxFixture)
        if (Test-Path -LiteralPath $testWorkspace) {
            $resolvedFixture = (Resolve-Path -LiteralPath $testWorkspace).Path
            if (-not $resolvedFixture.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe Windows cleanup target' }
            Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
        }
    }
}
