$ErrorActionPreference = 'Stop'
foreach ($scriptFile in Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..') -Filter '*.ps1' -Recurse) {
    $tokens = $null; $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($scriptFile.FullName, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors) { throw "Syntax error in $($scriptFile.Name): $($parseErrors.Message -join '; ')" }
}
$entry = Join-Path $PSScriptRoot '../wsl-dev.ps1'
$fixture = Join-Path ([System.IO.Path]::GetTempPath()) ('r7-dev-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$global:devTest = @{ Mounts = @{}; Keeper = $false; FailSecondMount = $false; FailUnmount = $false; BrokenPackage = $false; Mutations = 0; Unreadable = ''; Open = $false }

function global:wsl.exe {
    $nativeArgs = @($args)
    $separator = [array]::IndexOf($nativeArgs, '--exec')
    if ($separator -lt 0) { throw 'Direct WSL execution is required' }
    $command = @($nativeArgs[($separator + 1)..($nativeArgs.Count - 1)])
    $global:LASTEXITCODE = 0
    switch ($command[0]) {
        'id' { '1000' }
        'dpkg-query' { if ($global:devTest.BrokenPackage) { throw 'Broken package must not be checked by Disable' }; 'install ok installed'; '1.0-test' }
        'wslpath' { '/mnt/c/' + ($command[-1] -replace '^C:[\\/]', '' -replace '\\', '/') }
        'test' {
            if ($command -contains '-r' -and $global:devTest.Unreadable -and $command[-1].EndsWith($global:devTest.Unreadable)) { $global:LASTEXITCODE = 1 }
            if ($command -contains '-ef') {
                if ($global:devTest.Mounts[$command[-1]] -ne $command[1]) { $global:LASTEXITCODE = 1 }
            }
        }
        'mountpoint' { if (-not $global:devTest.Mounts.ContainsKey($command[-1])) { $global:LASTEXITCODE = 32 } }
        'pgrep' {
            if ($command -contains 'DesktopEditors') { if ($global:devTest.Open) { '413' } else { $global:LASTEXITCODE = 1 } }
            elseif (-not $global:devTest.Keeper) { $global:LASTEXITCODE = 1 } else { '1234' }
        }
        'mount' {
            if ($global:devTest.FailSecondMount -and $command[-1].EndsWith('/web-apps')) { $global:LASTEXITCODE = 1 }
            else { $global:devTest.Mounts[$command[-1]] = $command[-2]; $global:devTest.Mutations++ }
        }
        'umount' {
            if ($global:devTest.FailUnmount) { $global:LASTEXITCODE = 1 }
            else { $global:devTest.Mounts.Remove($command[-1]); $global:devTest.Mutations++ }
        }
        'pkill' { $global:devTest.Keeper = $false }
        'findmnt' { if ($command -contains '-M') { $global:devTest.Mounts[$command[-1]] } else { 'mock bind mount' } }
        'ldd' { 'libc.so.6 => /lib/libc.so.6' }
        'dpkg' { }
        'apt-get' { }
        default { throw "Unexpected command: $command" }
    }
}
function global:Start-Process { $global:devTest.Keeper = $true }
function Assert { param($Condition, $Message); if (-not $Condition) { throw $Message } }
function Run { param($Action); & $entry -Action $Action -WorkspaceRoot $fixture -Distro 'test-distro' -LinuxUser 'developer' -StateDirectory (Join-Path $fixture 'state') | Out-Null }
function Must-Fail { param($Action); $failed = $false; try { Run $Action } catch { $failed = $true }; Assert $failed "Expected failure: $Action" }
try {
    Must-Fail Enable
    Assert ($global:devTest.Mutations -eq 0) 'Missing build caused mutations'
    $artifacts = @('sdkjs/word/sdk-all.js', 'sdkjs/cell/sdk-all.js', 'sdkjs/slide/sdk-all.js',
        'web-apps/apps/documenteditor/main/index.html', 'web-apps/apps/spreadsheeteditor/main/index.html',
        'web-apps/apps/presentationeditor/main/index.html')
    foreach ($relative in $artifacts) {
        $file = Join-Path $fixture "Editors/editors/$relative"
        New-Item -ItemType Directory -Path (Split-Path $file) -Force | Out-Null
        [System.IO.File]::WriteAllText($file, 'test artifact')
    }
    $global:devTest.BrokenPackage = $true
    Run Preflight
    foreach ($relative in $artifacts) {
        $file = Join-Path $fixture "Editors/editors/$relative"
        Remove-Item -LiteralPath $file
        Must-Fail Preflight
        [System.IO.File]::WriteAllText($file, '')
        Must-Fail Preflight
        [System.IO.File]::WriteAllText($file, 'test artifact')
        $global:devTest.Unreadable = $relative.Substring($relative.IndexOf('/') + 1)
        Must-Fail Preflight
        $global:devTest.Unreadable = ''
    }
    Assert ($global:devTest.Mutations -eq 0) 'Preflight caused mutations'
    $global:devTest.BrokenPackage = $false
    Run Enable
    Assert ($global:devTest.Mounts.Count -eq 2 -and $global:devTest.Keeper) 'Enable failed'
    Run Verify
    $mutations = $global:devTest.Mutations
    Run Enable
    Assert ($global:devTest.Mutations -eq $mutations) 'Enable is not idempotent'
    Run Disable
    Run Disable
    Assert ($global:devTest.Mounts.Count -eq 0 -and -not $global:devTest.Keeper) 'Disable failed'
    $global:devTest.FailSecondMount = $true
    Must-Fail Enable
    Assert ($global:devTest.Mounts.Count -eq 0 -and -not $global:devTest.Keeper) 'Rollback failed'
    $global:devTest.FailUnmount = $true
    Must-Fail Enable
    Assert ($global:devTest.Mounts.Count -eq 1 -and $global:devTest.Keeper) 'Incomplete rollback was hidden'
    $global:devTest.FailUnmount = $false
    $global:devTest.BrokenPackage = $true
    Remove-Item -LiteralPath (Join-Path $fixture 'Editors') -Recurse -Force
    Run Disable
    Assert ($global:devTest.Mounts.Count -eq 0 -and -not $global:devTest.Keeper) 'Recovery without build/package failed'
    $global:devTest.BrokenPackage = $false
    $global:devTest.FailSecondMount = $false
    foreach ($relative in $artifacts) {
        $file = Join-Path $fixture "Editors/editors/$relative"
        New-Item -ItemType Directory -Path (Split-Path $file) -Force | Out-Null
        [System.IO.File]::WriteAllText($file, 'test artifact')
    }
    $global:devTest.Open = $true
    Must-Fail Preflight
    $global:devTest.Open = $false
    $global:devTest.Mounts['/opt/r7-office/desktopeditors/editors/web-apps'] = '/unknown/source'
    $mutations = $global:devTest.Mutations
    Must-Fail Enable
    Must-Fail Disable
    Must-Fail Preflight
    Assert ($global:devTest.Mutations -eq $mutations) 'Unknown mount was modified'
    Write-Output 'PASS: syntax, preinstall Preflight, all six missing/empty/unreadable files, enable, verify, idempotence, disable, rollback, recovery without build/package, unknown mount'
} finally {
    $resolvedFixture = (Resolve-Path -LiteralPath $fixture).Path
    if (-not $resolvedFixture.StartsWith([System.IO.Path]::GetTempPath(), [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path' }
    Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
}
