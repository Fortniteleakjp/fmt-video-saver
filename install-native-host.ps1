param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$helper = Join-Path $root "native_helper.exe"
if (-not (Test-Path -LiteralPath $helper)) {
  throw "native_helper.exe was not found. Run build-native-helper.ps1 first."
}

$manifestPath = Join-Path $root "native-host-manifest.json"
$manifest = [ordered]@{
  name = "com.fmtsaver.helper"
  description = "FMT Video Saver native helper"
  path = $helper
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding utf8

foreach ($key in @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.fmtsaver.helper",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.fmtsaver.helper"
)) {
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name "(default)" -Value $manifestPath
}

Write-Output "Native helper registered for Chrome and Edge."
