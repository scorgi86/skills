$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('r7-prepare-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
    . (Join-Path $PSScriptRoot '../prepare-wsl.ps1') -Distro test -LinuxUser developer -WorkspaceRoot $fixture -LogDirectory $fixture
    function Invoke-Stage {
        param($Name, $FilePath, $Arguments, [switch]$AllowFailure)
        $code = if ($Name -eq $script:FailStage) { 40 } else { 0 }
        $output = switch ($Name) {
            'run-directory' { '/var/tmp/r7-office.mock' }
            'metadata' { '{"name":"r7-office","version":"1.2","architecture":"amd64","format":"deb","backend":"apt","installed_size_kb":10}' }
            'environment' { '{"os":{"architecture":"amd64"},"selected_backend":"apt","package_database":"healthy","free_space_kb":100000}' }
            'package-verify' { '{"package":{"version":"1.2"},"status":"success"}' }
            default { 'ok' }
        }
        $stdout = Join-Path $fixture "$Name.out"
        [IO.File]::WriteAllText($stdout, $output)
        $record = [pscustomobject]@{ Name=$Name; Status=$(if($code -eq 0){'success'}else{'failed'}); ExitCode=$code; Seconds=0.001; Stdout=$stdout; Stderr=$stdout }
        $script:Stages.Add($record)
        if ($code -ne 0 -and -not $AllowFailure) { throw "mock stage $Name failure" }
        $record
    }
    function Assert { param($Condition, $Message); if (-not $Condition) { throw $Message } }
    foreach ($variant in @('fresh', 'upgrade', 'same-version', 'environment-only')) {
        $PackagePath = if ($variant -eq 'environment-only') { '' } else { 'local.deb' }
        $script:Stages.Clear(); $script:FailStage = ''
        $result = Invoke-Preparation
        Assert ($result.Status -eq 'success' -and $result.Version -eq '1.2') $variant
        $names = @($script:Stages | Where-Object Status -ne 'skipped' | Select-Object -ExpandProperty Name)
        Assert ($names[-1] -eq 'verify') 'Final verification absent'
        if ($PackagePath) { Assert (($names -join ',') -eq 'preflight,run-directory,metadata,environment,disable,install,package-verify,alias,enable,verify') 'Wrong full flow' }
        else { Assert ($names -notcontains 'install' -and $names -notcontains 'disable') 'Environment-only mutated package' }
    }
    $PackagePath = 'local.deb'
    foreach ($failed in @('preflight','metadata','environment','disable','install','package-verify','alias','enable','verify')) {
        $script:Stages.Clear(); $script:FailStage = $failed
        $result = Invoke-Preparation
        Assert ($result.Status -eq 'failed' -and $result.FailedStage -eq $failed) "Failure hidden: $failed"
        $active = @($script:Stages | Where-Object Status -ne 'skipped')
        Assert ($active[-1].Name -eq $failed) "Continued after $failed"
        if ($failed -ne 'verify') { Assert (@($script:Stages | Where-Object Status -eq 'skipped').Count -gt 0) 'Skipped stages missing' }
        if ($failed -in @('install','package-verify','alias')) { Assert ($result.MountState -eq 'disconnected') 'Disconnected state missing' }
        if ($failed -eq 'verify') { Assert ($result.MountState -eq 'connected') 'Connected state missing after verification failure' }
    }
    $json = $result | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    Assert ($json.Stages[0].Seconds -ge 0 -and $null -eq $json.ModelTokens) 'Metrics invalid'
    Write-Output 'PASS: full flow, four inputs, final verification, failure gates, state report, JSON metrics'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    if (-not $resolved.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe cleanup' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
