#Requires -Version 5.1
<#
.SYNOPSIS
  PHARMEX FOM Agent — apteka kompyuterida ishlaydi.
  Lokal REPORT.exe (127.0.0.1:8084) dan o'qiydi, PHARMEX bulutiga yuboradi.
#>
param(
  [switch]$Once,
  [switch]$Test
)

$ErrorActionPreference = "Stop"
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$ConfigPath = Join-Path $Root "config.ini"
$ExamplePath = Join-Path $Root "config.example.ini"
$LogFile = Join-Path $Root "agent.log"

$Reports = [ordered]@{
  organizations   = @{ Id = 189; Dated = $false; Label = "Tashkilotlar" }
  catalog         = @{ Id = 188; Dated = $false; Label = "Tovarlar" }
  stock           = @{ Id = 6;   Dated = $false; Label = "Qoldiqlar" }
  purchases       = @{ Id = 11;  Dated = $true;  Label = "Kirim" }
  supplierReturns = @{ Id = 12;  Dated = $true;  Label = "Qaytarish" }
  writeOffs       = @{ Id = 3;   Dated = $true;  Label = "Hisobdan chiqarish" }
  retailSales     = @{ Id = 14;  Dated = $true;  Label = "Chakana savdo" }
  insuranceSales  = @{ Id = 15;  Dated = $true;  Label = "Sugurta savdo" }
}

function Write-AgentLog([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ss"), $Message
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Read-Ini([string]$Path) {
  $map = @{}
  $section = ""
  foreach ($raw in Get-Content -Path $Path -Encoding UTF8) {
    $line = $raw.Trim()
    if (-not $line -or $line.StartsWith(";") -or $line.StartsWith("#")) { continue }
    if ($line -match '^\[(.+)\]$') { $section = $Matches[1].ToUpperInvariant(); if (-not $map.ContainsKey($section)) { $map[$section] = @{} }; continue }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1 -or -not $section) { continue }
    $map[$section][$line.Substring(0, $eq).Trim().ToUpperInvariant()] = $line.Substring($eq + 1).Trim()
  }
  return $map
}

function Get-Config {
  if (-not (Test-Path $ConfigPath)) {
    if (Test-Path $ExamplePath) {
      Copy-Item $ExamplePath $ConfigPath
      throw "config.ini yaratildi. TOKEN ni to'ldiring va qayta ishga tushiring: $ConfigPath"
    }
    throw "config.ini topilmadi."
  }
  $ini = Read-Ini $ConfigPath
  $cloud = $ini["CLOUD"]; $fom = $ini["FOM"]
  if (-not $cloud -or -not $cloud["URL"] -or -not $cloud["TOKEN"]) { throw "[CLOUD] URL va TOKEN majburiy." }
  $script:LogFile = if ($ini["AGENT"] -and $ini["AGENT"]["LOG"]) { Join-Path $Root $ini["AGENT"]["LOG"] } else { $LogFile }
  return [pscustomobject]@{
    CloudUrl     = $cloud["URL"].TrimEnd("/")
    Token        = $cloud["TOKEN"]
    ReportUrl    = if ($fom["REPORT_URL"]) { $fom["REPORT_URL"].TrimEnd("/") } else { "http://127.0.0.1:8084" }
    FilialIds    = @(($fom["FILIAL_IDS"] -split '[,;\s]+' | Where-Object { $_ }))
    InitialDays  = [Math]::Max(1, [int]($(if ($fom["INITIAL_DAYS"]) { $fom["INITIAL_DAYS"] } else { 90 })))
    IntervalMin  = [Math]::Max(0, [int]($(if ($fom["INTERVAL_MIN"]) { $fom["INTERVAL_MIN"] } else { 5 })))
    TimeoutSec   = [Math]::Max(5, [int]($(if ($fom["TIMEOUT_SEC"]) { $fom["TIMEOUT_SEC"] } else { 120 })))
  }
}

function Format-FomDate([datetime]$Date) {
  return $Date.ToUniversalTime().ToString("dd.MM.yyyy")
}

function Get-DayUtc([int]$DaysAgo = 0) {
  return [datetime]::UtcNow.Date.AddDays(-$DaysAgo)
}

function Get-Windows([datetime]$From, [datetime]$To) {
  $list = @()
  $cursor = $From
  while ($cursor -le $To) {
    $end = $cursor.AddDays(30)
    if ($end -gt $To) { $end = $To }
    $list += ,@($cursor, $end)
    $cursor = $end.AddDays(1)
  }
  return $list
}

function Invoke-Http([string]$Method, [string]$Url, [string]$Body = $null, [hashtable]$Headers = @{}, [int]$TimeoutSec = 120) {
  $params = @{
    Method      = $Method
    Uri         = $Url
    TimeoutSec  = $TimeoutSec
    Headers     = $Headers
    ErrorAction = "Stop"
  }
  if ($null -ne $Body) {
    $params.ContentType = "application/json; charset=utf-8"
    $params.Body = [System.Text.Encoding]::UTF8.GetBytes($Body)
  }
  return Invoke-WebRequest @params
}

function Get-ReportXml($Cfg, [int]$ReportId, [string]$FilialId, [datetime]$From, [datetime]$To) {
  $qs = "pDateFrom={0}&pDateTo={1}&pFilial_id={2}&pReport_id={3}" -f (Format-FomDate $From), (Format-FomDate $To), $FilialId, $ReportId
  $url = "{0}/P_GetReport_XML?{1}" -f $Cfg.ReportUrl, $qs
  try {
    $res = Invoke-Http -Method GET -Url $url -TimeoutSec $Cfg.TimeoutSec
  } catch {
    $msg = $_.Exception.Message
    if ($msg -match "Unable to connect|rad etildi|refused|Connection refused|подключиться") {
      throw "REPORT.exe topilmadi ($($Cfg.ReportUrl)). FOM texnigi SERVICEREPORTS ni 8084 portda o'rnatishi kerak."
    }
    throw
  }
  $text = $res.Content
  if ($text -notmatch "<") { throw "REPORT.exe XML emas: $($text.Substring(0, [Math]::Min(120, $text.Length)))" }
  return $text
}

function Send-Report($Cfg, [string]$Report, [string]$FilialId, [string]$Xml) {
  $url = "{0}/api/fom/agent/{1}/report" -f $Cfg.CloudUrl, [uri]::EscapeDataString($Cfg.Token)
  $payload = @{ report = $Report; filialId = $FilialId; xml = $Xml } | ConvertTo-Json -Compress -Depth 4
  $res = Invoke-Http -Method POST -Url $url -Body $payload -Headers @{ "X-Token" = $Cfg.Token } -TimeoutSec ([Math]::Max($Cfg.TimeoutSec, 180))
  return $res.Content | ConvertFrom-Json
}

function Test-Cloud($Cfg) {
  $url = "{0}/api/fom/agent/{1}/ping" -f $Cfg.CloudUrl, [uri]::EscapeDataString($Cfg.Token)
  $res = Invoke-Http -Method GET -Url $url -Headers @{ "X-Token" = $Cfg.Token } -TimeoutSec 30
  return $res.Content | ConvertFrom-Json
}

function Invoke-Sync($Cfg) {
  $to = Get-DayUtc 0
  $from = Get-DayUtc $Cfg.InitialDays
  $imported = 0
  $errors = 0
  $filials = if ($Cfg.FilialIds.Count) { $Cfg.FilialIds } else { @("1") }

  foreach ($key in $Reports.Keys) {
    $def = $Reports[$key]
    foreach ($filial in $filials) {
      try {
        if (-not $def.Dated) {
          Write-AgentLog ("→ {0} (filial {1})…" -f $def.Label, $filial)
          $xml = Get-ReportXml $Cfg $def.Id $filial $to $to
          $result = Send-Report $Cfg $key $filial $xml
          $imported += [int]$result.imported
          Write-AgentLog ("  ✓ {0} qator → {1} import" -f $result.rows, $result.imported)
        } else {
          foreach ($win in (Get-Windows $from $to)) {
            Write-AgentLog ("→ {0} (filial {1}, {2}–{3})…" -f $def.Label, $filial, (Format-FomDate $win[0]), (Format-FomDate $win[1]))
            $xml = Get-ReportXml $Cfg $def.Id $filial $win[0] $win[1]
            $result = Send-Report $Cfg $key $filial $xml
            $imported += [int]$result.imported
            Write-AgentLog ("  ✓ {0} qator → {1} import" -f $result.rows, $result.imported)
          }
        }
      } catch {
        $errors++
        Write-AgentLog ("  ✗ {0}" -f $_.Exception.Message)
        if ($_.Exception.Message -match "REPORT\.exe topilmadi") { throw }
      }
    }
  }
  return @{ Imported = $imported; Errors = $errors }
}

Write-Host "══════════════════════════════════════"
Write-Host "  PHARMEX FOM Agent  ·  IFOR PHARMA"
Write-Host "══════════════════════════════════════"

$Cfg = Get-Config
Write-AgentLog "Config: $ConfigPath"
Write-AgentLog "Cloud:  $($Cfg.CloudUrl)"
Write-AgentLog "REPORT: $($Cfg.ReportUrl)"

Write-AgentLog "PHARMEX bulutini tekshiruv…"
$null = Test-Cloud $Cfg
Write-AgentLog "Bulut OK."

Write-AgentLog "Lokal REPORT.exe ni tekshiruv…"
try {
  $null = Get-ReportXml $Cfg 189 ($(if ($Cfg.FilialIds.Count) { $Cfg.FilialIds[0] } else { "1" })) (Get-DayUtc 0) (Get-DayUtc 0)
  Write-AgentLog "REPORT.exe OK."
} catch {
  Write-AgentLog $_.Exception.Message
  if ($Test) { exit 1 }
  Write-AgentLog "REPORT.exe paydo bo'lguncha kutamiz."
}

if ($Test) { Write-AgentLog "Test yakunlandi."; exit 0 }

function Start-Cycle {
  try {
    $null = Get-ReportXml $Cfg 189 ($(if ($Cfg.FilialIds.Count) { $Cfg.FilialIds[0] } else { "1" })) (Get-DayUtc 0) (Get-DayUtc 0)
    $r = Invoke-Sync $Cfg
    Write-AgentLog ("Sinxron yakunlandi: {0} yozuv, {1} xato." -f $r.Imported, $r.Errors)
    Set-Content -Path (Join-Path $Root "last-ok.txt") -Value (Get-Date -Format o) -Encoding UTF8
  } catch {
    Write-AgentLog ("Sinxron to'xtadi: {0}" -f $_.Exception.Message)
  }
}

Start-Cycle
if ($Once -or $Cfg.IntervalMin -le 0) { exit 0 }

Write-AgentLog ("Avto-sinxron har {0} daqiqada. Oynani yopmang." -f $Cfg.IntervalMin)
while ($true) {
  Start-Sleep -Seconds ($Cfg.IntervalMin * 60)
  Start-Cycle
}
