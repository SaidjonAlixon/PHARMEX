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
# Vercel TLS 1.2 talab qiladi (eski Windows default TLS 1.0)
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
} catch {
  [Net.ServicePointManager]::SecurityProtocol = [Enum]::ToObject([Net.SecurityProtocolType], 3072)
}
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
  if ($cloud["TOKEN"] -match '^ODJX_') {
    throw "ODJX_… — Fom_Connect marketplace tokeni (1-aptekani oladi). PHARMEX uchun FOM_SITE_TOKEN yozing; Fom_ID/CH ni agent o'zi topadi."
  }
  $ph = $ini["PHARMACY"]
  return [pscustomobject]@{
    CloudUrl     = $cloud["URL"].TrimEnd("/")
    Token        = $cloud["TOKEN"]
    ReportUrl    = if ($fom["REPORT_URL"]) { $fom["REPORT_URL"].TrimEnd("/") } else { "auto" }
    FilialIds    = @(($fom["FILIAL_IDS"] -split '[,;\s]+' | Where-Object { $_ }))
    InitialDays  = [Math]::Max(1, [int]($(if ($fom["INITIAL_DAYS"]) { $fom["INITIAL_DAYS"] } else { 90 })))
    IntervalMin  = [Math]::Max(0, [int]($(if ($fom["INTERVAL_MIN"]) { $fom["INTERVAL_MIN"] } else { 5 })))
    TimeoutSec   = [Math]::Max(5, [int]($(if ($fom["TIMEOUT_SEC"]) { $fom["TIMEOUT_SEC"] } else { 120 })))
    FomId        = if ($ph -and $ph["FOM_ID"]) { $ph["FOM_ID"] } else { $null }
    Ch           = if ($ph -and $ph["CH"]) { $ph["CH"] } else { $null }
    PharmacyName = if ($ph -and $ph["NAME"]) { $ph["NAME"] } else { $null }
  }
}

function Save-IniValue([string]$Section, [string]$Key, [string]$Value) {
  try {
    $raw = Get-Content $ConfigPath -Raw -Encoding UTF8
    $pattern = "(?ims)(\[$Section\][^\[]*?)^\s*$Key\s*=.*$"
    if ($raw -match "(?im)^\s*$Key\s*=" -and $raw -match "\[$Section\]") {
      $raw = [regex]::Replace($raw, "(?im)(?<=\[$Section\][^\[]*)^\s*$Key\s*=.*$", "$Key=$Value")
    } elseif ($raw -match "\[$Section\]") {
      $raw = [regex]::Replace($raw, "(\[$Section\])", "`$1`r`n$Key=$Value")
    } else {
      $raw = $raw.TrimEnd() + "`r`n[$Section]`r`n$Key=$Value`r`n"
    }
    Set-Content -Path $ConfigPath -Value $raw -Encoding UTF8 -NoNewline
  } catch {}
}

function Resolve-PharmacyIdentity($Cfg) {
  if ($Cfg.FomId -and $Cfg.Ch) {
    Write-AgentLog "config.ini dagi apteka identifikatori ishlatiladi."
    return
  }
  Write-AgentLog "FAPTEKA dan Fom_ID / CH qidiruv…"
  $roots = @(
    "C:\FAPTEKA", "D:\FAPTEKA", "E:\FAPTEKA",
    (Join-Path ${env:ProgramFiles} "FAPTEKA"),
    (Join-Path ${env:ProgramFiles(x86)} "FAPTEKA"),
    $Root
  ) | Where-Object { $_ -and (Test-Path $_) }
  $names = @("SETUP.ini","SETUP","NAPTEKA","NGLOBAL","CONFIG","config.ini","SITE.ini","CONNECT.ini","Fom_Connect.ini","GLOBAL.ini")
  foreach ($root in $roots) {
    foreach ($name in $names) {
      Get-ChildItem -Path $root -Filter $name -File -ErrorAction SilentlyContinue | ForEach-Object {
        Read-PharmacyFromFile $_.FullName $Cfg
      }
    }
    Get-ChildItem -Path $root -Filter "SETUP.ini" -File -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 40 | ForEach-Object { Read-PharmacyFromFile $_.FullName $Cfg }
    if ($Cfg.FomId -and $Cfg.Ch) { break }
  }
  if ($Cfg.FomId) { Save-IniValue "PHARMACY" "FOM_ID" $Cfg.FomId }
  if ($Cfg.Ch) { Save-IniValue "PHARMACY" "CH" $Cfg.Ch }
  if ($Cfg.PharmacyName) { Save-IniValue "PHARMACY" "NAME" $Cfg.PharmacyName }
  if (-not $Cfg.FomId -and -not $Cfg.Ch) {
    Write-AgentLog "Ogohlantirish: Fom_ID/CH topilmadi — F-Apteka oynasidagi qiymatlarni [PHARMACY] ga yozing."
  }
}

function Read-PharmacyFromFile([string]$File, $Cfg) {
  try { $text = [IO.File]::ReadAllText($File) } catch { return }
  if (-not $Cfg.FomId) {
    $m = [regex]::Match($text, '(?im)^\s*(?:Fom[_\s]?[Ii][Dd]|FOM_ID|FomId)\s*[=:]\s*(\d{3,8})\s*$')
    if ($m.Success) { $Cfg.FomId = $m.Groups[1].Value; Write-AgentLog "  Fom_ID=$($Cfg.FomId) ← $File" }
  }
  if (-not $Cfg.Ch) {
    $m = [regex]::Match($text, '(?im)^\s*(?:CH|Channel|CHANNEL)\s*[=:]\s*([A-Z0-9]{8,20})\s*$')
    if ($m.Success -and $m.Groups[1].Value -notmatch '^ODJX') {
      $Cfg.Ch = $m.Groups[1].Value; Write-AgentLog "  CH=$($Cfg.Ch) ← $File"
    }
  }
  if (-not $Cfg.PharmacyName) {
    $m = [regex]::Match($text, '(?im)^\s*(?:NAME|Наименование|Apteka|PHARMACY|ORG)\s*[=:]\s*(.+)\s*$')
    if ($m.Success) {
      $n = $m.Groups[1].Value.Trim()
      if ($n.Length -ge 3 -and $n.Length -lt 120 -and $n -notmatch 'http') { $Cfg.PharmacyName = $n }
    }
  }
}

function Add-Candidate([System.Collections.Generic.List[string]]$List, [string]$Url) {
  if ([string]::IsNullOrWhiteSpace($Url)) { return }
  $u = $Url.Trim().TrimEnd("/")
  if ($u -notmatch '^https?://') { $u = "http://$u" }
  if (-not $List.Contains($u)) { [void]$List.Add($u) }
}

function Get-UrlsFromFaptekaConfigs {
  $found = New-Object System.Collections.Generic.List[string]
  $roots = @(
    "C:\FAPTEKA", "D:\FAPTEKA", "E:\FAPTEKA",
    (Join-Path ${env:ProgramFiles} "FAPTEKA"),
    (Join-Path ${env:ProgramFiles(x86)} "FAPTEKA"),
    $Root
  ) | Where-Object { $_ -and (Test-Path $_) }
  $names = @("SETUP.ini", "SETUP", "NAPTEKA", "NGLOBAL", "CONFIG", "config.ini", "REPORT.ini", "SERVICEREPORTS.ini")
  foreach ($root in $roots) {
    Write-AgentLog "FAPTEKA papka: $root"
    foreach ($name in $names) {
      Get-ChildItem -Path $root -Filter $name -File -ErrorAction SilentlyContinue | ForEach-Object {
        Extract-UrlsFromFile $_.FullName $found
      }
    }
    Get-ChildItem -Path $root -Filter "SETUP.ini" -File -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 30 | ForEach-Object { Extract-UrlsFromFile $_.FullName $found }
  }
  try {
    Get-Process -ErrorAction SilentlyContinue | Where-Object {
      $_.ProcessName -match 'REPORT|SERVICEREPORT|NServis|FOM_SQL'
    } | ForEach-Object {
      Write-AgentLog ("Jarayon topildi: {0} (PID {1})" -f $_.ProcessName, $_.Id)
    }
  } catch {}
  return $found
}

function Extract-UrlsFromFile([string]$File, [System.Collections.Generic.List[string]]$Found) {
  try { $text = [IO.File]::ReadAllText($File) } catch { return }
  [regex]::Matches($text, 'https?://[^\s"''<>]+', 'IgnoreCase') | ForEach-Object {
    Add-Candidate $Found ($_.Value.TrimEnd('/', '\', ',', ';'))
  }
  [regex]::Matches($text, '(?i)(?:REPORT_)?PORT\s*=\s*(\d{2,5})') | ForEach-Object {
    Add-Candidate $Found ("http://127.0.0.1:{0}" -f $_.Groups[1].Value)
  }
  [regex]::Matches($text, '(?im)^\s*URL\s*=\s*(.+)\s*$') | ForEach-Object {
    $v = $_.Groups[1].Value.Trim()
    if (-not $v -or $v -match 'pharmex') { return }
    if ($v -notmatch '^https?://') {
      if ($v -match '^\d+\.\d+\.\d+\.\d+(:\d+)?$' -or $v -match '^[\w\.-]+:\d+$') { $v = "http://$v" }
      else { return }
    }
    Add-Candidate $Found $v
  }
}

function Test-ReportUrl([string]$BaseUrl, [string]$Filial) {
  try {
    $uri = [Uri]$BaseUrl
    $client = New-Object System.Net.Sockets.TcpClient
    $ar = $client.BeginConnect($uri.Host, $(if ($uri.Port -gt 0) { $uri.Port } else { 80 }), $null, $null)
    if (-not $ar.AsyncWaitHandle.WaitOne(700)) { $client.Close(); return $false }
    $client.EndConnect($ar); $client.Close()
  } catch { return $false }
  try {
    $today = [datetime]::UtcNow.Date
    $url = "{0}/P_GetReport_XML?pDateFrom={1}&pDateTo={2}&pFilial_id={3}&pReport_id=189" -f `
      $BaseUrl.TrimEnd("/"), (Format-FomDate $today), (Format-FomDate $today), $(if ($Filial) { $Filial } else { "1" })
    $res = Invoke-WebRequest -Method GET -Uri $url -TimeoutSec 4 -ErrorAction Stop
    return ($res.Content -match "<")
  } catch { return $false }
}

function Resolve-ReportUrl($Cfg) {
  $candidates = New-Object System.Collections.Generic.List[string]
  if ($Cfg.ReportUrl -and $Cfg.ReportUrl -ne "auto") { Add-Candidate $candidates $Cfg.ReportUrl }
  foreach ($u in (Get-UrlsFromFaptekaConfigs)) { Add-Candidate $candidates $u }
  foreach ($p in @(8084, 8080, 8085, 8081, 8082, 8083, 8090, 8888, 9000, 80)) {
    Add-Candidate $candidates ("http://127.0.0.1:{0}" -f $p)
  }
  Write-AgentLog ("Qidiruv: {0} ta mumkin bo'lgan manzil…" -f $candidates.Count)
  $filial = if ($Cfg.FilialIds.Count) { $Cfg.FilialIds[0] } else { "1" }
  foreach ($url in $candidates) {
    Write-AgentLog "  tekshiruv: $url"
    if (Test-ReportUrl $url $filial) {
      Write-AgentLog "  topildi: $url"
      # config.ini ga yozib qo'yamiz — keyingi ishga tushish tezroq
      try {
        $raw = Get-Content $ConfigPath -Raw -Encoding UTF8
        if ($raw -match '(?im)^REPORT_URL\s*=') {
          $raw = [regex]::Replace($raw, '(?im)^REPORT_URL\s*=.*$', "REPORT_URL=$url")
        } else {
          $raw = $raw.TrimEnd() + "`r`nREPORT_URL=$url`r`n"
        }
        Set-Content -Path $ConfigPath -Value $raw -Encoding UTF8 -NoNewline
      } catch {}
      return $url
    }
  }
  throw "Shu kompyuterda FOM hisobot eshigi (REPORT.exe / SERVICEREPORTS) topilmadi. FOM texnigi o'rnatishi yoki config.ini da REPORT_URL ni yozishi kerak."
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
  # GET/HEAD must not include a body (PowerShell passes "" when -Body is omitted)
  if ($Method -notin @('GET', 'HEAD') -and -not [string]::IsNullOrEmpty($Body)) {
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
      throw "FOM hisobot eshigi ochilmadi ($($Cfg.ReportUrl)). REPORT.exe ishlayotganini tekshiring."
    }
    throw
  }
  $text = $res.Content
  if ($text -notmatch "<") { throw "REPORT.exe XML emas: $($text.Substring(0, [Math]::Min(120, $text.Length)))" }
  return $text
}

function Send-Report($Cfg, [string]$Report, [string]$FilialId, [string]$Xml) {
  $url = "{0}/api/fom/agent/{1}/report" -f $Cfg.CloudUrl, [uri]::EscapeDataString($Cfg.Token)
  $body = @{ report = $Report; filialId = $FilialId; xml = $Xml }
  if ($Cfg.FomId) { $body.fomId = $Cfg.FomId }
  if ($Cfg.Ch) { $body.ch = $Cfg.Ch }
  if ($Cfg.PharmacyName) { $body.pharmacyName = $Cfg.PharmacyName }
  $payload = $body | ConvertTo-Json -Compress -Depth 4
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
        if ($_.Exception.Message -match "eshig|REPORT\.exe") { throw }
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

Write-AgentLog "PHARMEX bulutini tekshiruv…"
$null = Test-Cloud $Cfg
Write-AgentLog "Bulut OK."

Resolve-PharmacyIdentity $Cfg
Write-AgentLog ("Apteka: Fom_ID={0}  CH={1}{2}" -f $(if ($Cfg.FomId) { $Cfg.FomId } else { "?" }), $(if ($Cfg.Ch) { $Cfg.Ch } else { "?" }), $(if ($Cfg.PharmacyName) { "  $($Cfg.PharmacyName)" } else { "" }))

Write-AgentLog "Shu kompyuterda FOM eshigini qidiruv (port har aptekada har xil bo'lishi mumkin)…"
try {
  $Cfg.ReportUrl = Resolve-ReportUrl $Cfg
  Write-AgentLog "REPORT: $($Cfg.ReportUrl)"
} catch {
  Write-AgentLog $_.Exception.Message
  if ($Test) { exit 1 }
  Write-AgentLog "Eshik paydo bo'lguncha kutamiz."
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
