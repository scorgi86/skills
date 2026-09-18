$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('r7 child-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    . (Join-Path $PSScriptRoot '../prepare-wsl.ps1') -Distro test -LinuxUser developer -WorkspaceRoot $fixture -LogDirectory $fixture
    $child = Join-Path $fixture 'child script.ps1'
    [IO.File]::WriteAllText($child, 'Write-Output "stdout marker"; [Console]::Error.WriteLine("stderr marker"); exit 40')
    $record = Invoke-Stage -Name transport -FilePath $script:PowerShell -Arguments @('-NoProfile', '-File', $child) -AllowFailure
    if ($record.ExitCode -ne 40 -or -not (Get-Content -Raw $record.Stdout).Contains('stdout marker') -or -not (Get-Content -Raw $record.Stderr).Contains('stderr marker')) { throw 'Child exit/output isolation failed' }
    [IO.File]::WriteAllText($child, 'Write-Output "ok"; exit 0')
    $record = Invoke-Stage -Name success -FilePath $script:PowerShell -Arguments @('-NoProfile', '-File', $child)
    if ($record.ExitCode -ne 0) { throw 'Success transport failed' }
    [IO.File]::WriteAllText($child, 'throw "child failure"')
    $record = Invoke-Stage -Name exception -FilePath $script:PowerShell -Arguments @('-NoProfile', '-File', $child) -AllowFailure
    if ($record.ExitCode -eq 0) { throw 'Exception was hidden' }
    Write-Output 'PASS: real child process, exit 40, separated stdout/stderr, success, exception, spaced paths, parent alive'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    if (-not $resolved.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe cleanup' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
