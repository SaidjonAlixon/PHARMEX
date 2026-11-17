#Requires -RunAsAdministrator
<#
.SYNOPSIS
  FOM PC — Radmin/VPN SIZ. Lokal REPORT dan tortib PHARMXS ga yuboradi.
  Kompyuter o‘chib-yonganda ham Task Scheduler orqali o‘zi davom etadi.

.DESCRIPTION
  - Yangi dastur o‘rnatmaydi (faqat Windows PowerShell + Task Scheduler)
  - SERVICEREPORTS/REPORT.exe lokal 8084
  - Chiqish (HTTPS) pharmxs.uz ga — kirish porti ochish shart emas
  - Birinchi ishga tushirish: 01.01.2025 → 12.11.2026

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\fom-first-run.ps1
#>
param(
  [string]$PlatformUrl = "https://pharmxs.uz",
  [int]$OrganizationId = 3,
  [int]$ReportPort = 8084,
  [string]$DateFrom = "2025-01-01",
  [string]$DateTo = "2026-11-12",
  [string]$OpsToken = "5I-8pOQl3-vYg-2KenGyL0nQVDzSifCj",
  [string]$FilialIds = "1"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$PlatformUrl = $PlatformUrl.TrimEnd("/")
$InstallDir = Join-Path $env:ProgramData "PHARMXS"
$TokenFile = Join-Path $InstallDir "agent.token"
$ConfigFile = Join-Path $InstallDir "agent.json"
$WorkerPath = Join-Path $InstallDir "fom-worker.ps1"
$LogPath = Join-Path $InstallDir "agent.log"
$TaskName = "PHARMXS-FOM-Pull"

function Write-Step([string]$m, [string]$c = "Cyan") {
  Write-Host ""
  Write-Host "=== $m ===" -ForegroundColor $c
}
function Write-Log([string]$m) {
  try {
    if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null }
    Add-Content -Path $LogPath -Value ("[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] " + $m) -Encoding UTF8
  } catch {}
}

Write-Step "PHARMXS FOM — VPN siz, avtomatik tortish"
Write-Host "Platform : $PlatformUrl"
Write-Host "Org      : $OrganizationId"
Write-Host "REPORT   : 127.0.0.1:$ReportPort"
Write-Host "Davr     : $DateFrom → $DateTo"

Write-Step "1) REPORT.exe / SERVICEREPORTS"
$listening = Get-NetTCPConnection -LocalPort $ReportPort -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Write-Host "Port $ReportPort tinglanmayapti. REPORT.exe ni yoqing, keyin Enter..." -ForegroundColor Yellow
  [void][System.Console]::ReadLine()
  $listening = Get-NetTCPConnection -LocalPort $ReportPort -State Listen -ErrorAction SilentlyContinue
}
if (-not $listening) { throw "REPORT/SERVICEREPORTS ishlamayapti (TCP $ReportPort)." }
Write-Host "OK: port $ReportPort tinglanmoqda" -ForegroundColor Green

$probe = "http://127.0.0.1:$ReportPort/P_GetReport_XML?pDateFrom=01.01.2025&pDateTo=07.01.2025&pFilial_id=1&pReport_id=188"
try {
  $r = Invoke-WebRequest -Uri $probe -UseBasicParsing -TimeoutSec 60
  Write-Host "OK: lokal REPORT HTTP $($r.StatusCode), bytes=$($r.RawContentLength)" -ForegroundColor Green
} catch {
  throw "Lokal REPORT javob bermadi: $($_.Exception.Message)"
}

Write-Step "2) PHARMXS bootstrap (token + sozlama)"
$bootBody = @{
  organizationId = $OrganizationId
  reportPort     = $ReportPort
  startDate      = $DateFrom
  filialIds      = $FilialIds
  opsToken       = $OpsToken
} | ConvertTo-Json
$boot = Invoke-RestMethod -Method Post -Uri "$PlatformUrl/api/fom/ops/bootstrap" `
  -Headers @{ "X-Fom-Ops-Token" = $OpsToken } `
  -ContentType "application/json; charset=utf-8" `
  -Body $bootBody -TimeoutSec 60
if (-not $boot.token) { throw "Bootstrap token qaytarmadi: $($boot | ConvertTo-Json -Compress)" }
$Token = [string]$boot.token
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Set-Content -Path $TokenFile -Value $Token -Encoding ASCII -NoNewline
@{
  platformUrl    = $PlatformUrl
  organizationId = $OrganizationId
  reportPort     = $ReportPort
  dateFrom       = $DateFrom
  dateTo         = $DateTo
} | ConvertTo-Json | Set-Content -Path $ConfigFile -Encoding UTF8
Write-Host "OK: token saqlandi → $TokenFile" -ForegroundColor Green

Write-Step "3) Worker skript (ProgramData)"
$worker = @'
$ErrorActionPreference = "Continue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$InstallDir = Join-Path $env:ProgramData "PHARMXS"
$TokenFile = Join-Path $InstallDir "agent.token"
$ConfigFile = Join-Path $InstallDir "agent.json"
$LogPath = Join-Path $InstallDir "agent.log"
function Write-AgentLog([string]$m) {
  try {
    if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null }
    Add-Content -Path $LogPath -Value ("[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] " + $m) -Encoding UTF8 -ErrorAction SilentlyContinue
  } catch {}
}
try {
  $cfg = Get-Content $ConfigFile -Raw -ErrorAction Stop | ConvertFrom-Json
  $Platform = [string]$cfg.platformUrl
  $Port = [int]$cfg.reportPort
  if ($Port -lt 1) { $Port = 8084 }
  $Token = ([string](Get-Content $TokenFile -Raw)).Trim()
} catch {
  Write-AgentLog ("config fail " + $_.Exception.Message)
  exit 1
}
function Send-Hello {
  $ips = @(); try { $ips = @(Get-NetIPAddress -AddressFamily IPv4 -EA SilentlyContinue | Where-Object { $_.IPAddress -notlike "127.*" } | Select-Object -ExpandProperty IPAddress -Unique) } catch {}
  $listening = $false; try { $listening = [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -EA SilentlyContinue) } catch {}
  $payload = (@{ token=$Token; host=($ips | Select-Object -First 1); port=$Port; machine=$env:COMPUTERNAME; localIps=$ips; reportListening=$listening; protocol="http"; agentVersion=9 } | ConvertTo-Json -Compress)
  $hello = Invoke-RestMethod -Method Post -Uri ($Platform + "/api/fom/agent/hello") -ContentType "application/json; charset=utf-8" -Body $payload -TimeoutSec 45
  Write-AgentLog ("hello ok listening=" + $listening + " needOrgSql=" + [bool]$hello.needOrgSql)
  return $hello
}
function Convert-FomDate([string]$d) {
  if ($d -match '^(\d{2})\.(\d{2})\.(\d{4})$') { return ($Matches[3] + '-' + $Matches[2] + '-' + $Matches[1]) }
  return $d
}
function Open-FomSqlConnection {
  $servers = @(".\SQLEXPRESS", ".", "localhost\SQLEXPRESS", "localhost", "(local)")
  $dbs = @("NAPTSKLAD", "NAPT", "apteka", "APTEKA", "FAPTEKA")
  foreach ($srv in $servers) {
    foreach ($db in $dbs) {
      foreach ($cs in @(
        "Server=$srv;Database=$db;Integrated Security=True;TrustServerCertificate=True;Connect Timeout=4",
        "Server=$srv;Database=$db;User ID=sa;Password=1;TrustServerCertificate=True;Connect Timeout=4"
      )) {
        try {
          $conn = New-Object System.Data.SqlClient.SqlConnection $cs
          $conn.Open()
          Write-AgentLog ("sql open $srv/$db")
          return $conn
        } catch {}
      }
    }
  }
  return $null
}
function Invoke-SqlReceiptsJob($job) {
  $fromIso = Convert-FomDate ([string]$job.from)
  $toIso = Convert-FomDate ([string]$job.to)
  Write-AgentLog ("sqlReceipts $fromIso..$toIso")
  $conn = Open-FomSqlConnection
  if ($null -eq $conn) { throw "FOM MSSQL ulanmadi" }
  try {
    $linesSql = @"
SELECT CAST(I.ID AS varchar(20)) AS ID, CAST(I.DOCTYPE AS varchar(10)) AS DT, ISNULL(I.NUMBER,'') AS N,
  CONVERT(varchar(19), I.DATAENTER, 126) AS T, CONVERT(varchar(10), I.DATA, 120) AS D,
  CAST(I.OTDEL AS varchar(20)) AS F, CAST(IL.GOOD AS varchar(20)) AS G,
  CONVERT(varchar(40), L.KOL) AS Q, CONVERT(varchar(40), L.PRICE) AS P, CONVERT(varchar(40), L.PRICE1) AS P1,
  CONVERT(varchar(40), L.NDS) AS V, CONVERT(varchar(40), IL.PRICEPRIH) AS C,
  CONVERT(varchar(40), CAST(L.KOL * L.PRICE AS numeric(20, 2))) AS A,
  CONVERT(varchar(40), CAST(L.KOL * CASE WHEN L.PRICE1 > L.PRICE THEN L.PRICE1 - L.PRICE ELSE 0 END AS numeric(20, 2))) AS DA,
  CONVERT(varchar(40), CAST(L.KOL * IL.PRICEPRIH AS numeric(20, 2))) AS CA
FROM dbo.INVOICE I WITH (NOLOCK)
JOIN dbo.INVOICELN L WITH (NOLOCK) ON L.INVOICE = I.ID
JOIN dbo.INCOMELN IL WITH (NOLOCK) ON IL.ID = L.INCOMELN
WHERE I.DOCTYPE IN (2, 4) AND L.STATE IN (11, 12)
  AND I.DATA >= CONVERT(datetime, REPLACE('$fromIso','-',''), 112)
  AND I.DATA < DATEADD(day, 1, CONVERT(datetime, REPLACE('$toIso','-',''), 112))
ORDER BY I.ID, L.ID
"@
    $paySql = @"
SELECT CAST(P.INVOICE AS varchar(20)) AS ID, CAST(MAX(P.DOCTYPE) AS varchar(10)) AS DT,
  CAST(P.CASHBOX AS varchar(20)) AS CB, ISNULL(B.NAME,'') AS CN,
  CONVERT(varchar(40), SUM(P.SUMMA)) AS S
FROM dbo.PAYIN P WITH (NOLOCK)
JOIN dbo.INVOICE I WITH (NOLOCK) ON I.ID = P.INVOICE
LEFT JOIN dbo.CASHBOX B WITH (NOLOCK) ON B.ID = P.CASHBOX
WHERE I.DOCTYPE IN (2, 4)
  AND I.DATA >= CONVERT(datetime, REPLACE('$fromIso','-',''), 112)
  AND I.DATA < DATEADD(day, 1, CONVERT(datetime, REPLACE('$toIso','-',''), 112))
GROUP BY P.INVOICE, P.CASHBOX, B.NAME
"@
    $lines = New-Object System.Collections.Generic.List[object]
    $cmd = $conn.CreateCommand(); $cmd.CommandText = $linesSql; $cmd.CommandTimeout = 300
    $rd = $cmd.ExecuteReader()
    while ($rd.Read()) {
      $lines.Add([ordered]@{ ID=[string]$rd["ID"]; DT=[string]$rd["DT"]; N=[string]$rd["N"]; T=[string]$rd["T"]; D=[string]$rd["D"]; F=[string]$rd["F"]; G=[string]$rd["G"]; Q=[string]$rd["Q"]; P=[string]$rd["P"]; P1=[string]$rd["P1"]; V=[string]$rd["V"]; C=[string]$rd["C"]; A=[string]$rd["A"]; DA=[string]$rd["DA"]; CA=[string]$rd["CA"] })
    }
    $rd.Close()
    $pays = New-Object System.Collections.Generic.List[object]
    $cmd2 = $conn.CreateCommand(); $cmd2.CommandText = $paySql; $cmd2.CommandTimeout = 300
    $rd2 = $cmd2.ExecuteReader()
    while ($rd2.Read()) {
      $pays.Add([ordered]@{ ID=[string]$rd2["ID"]; DT=[string]$rd2["DT"]; CB=[string]$rd2["CB"]; CN=[string]$rd2["CN"]; S=[string]$rd2["S"] })
    }
    $rd2.Close()
    $payload = @{ lines=$lines; payments=$pays } | ConvertTo-Json -Compress -Depth 6
    Write-AgentLog ("sqlReceipts lines=$($lines.Count) pays=$($pays.Count)")
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))
    Invoke-RestMethod -Method Post -Uri ($Platform + "/api/fom/agent/job-result") -ContentType "application/json; charset=utf-8" -Body ((@{ token=$Token; jobId=$job.id; ok=$true; xmlBase64=$b64 } | ConvertTo-Json -Compress -Depth 4)) -TimeoutSec 900 | Out-Null
    Write-AgentLog ("job ok sqlReceipts " + $job.id)
  } finally { try { $conn.Close() } catch {} }
}
function Invoke-SqlStockJob($job) {
  Write-AgentLog "sqlStock"
  $conn = Open-FomSqlConnection
  if ($null -eq $conn) { throw "FOM MSSQL ulanmadi" }
  try {
    $stockSql = @"
SELECT CAST(x.OTDEL AS varchar(20)) AS F, CAST(x.GOOD AS varchar(20)) AS G,
  CONVERT(varchar(40), SUM(x.rest)) AS Q,
  CONVERT(varchar(40), CAST(SUM(x.rest * x.PRICEPRIH) AS numeric(20, 2))) AS C,
  CONVERT(varchar(40), MAX(x.PRICEROZ)) AS P,
  CONVERT(varchar(10), MIN(x.EXPDATA), 120) AS E
FROM (
  SELECT L.OTDEL, L.GOOD, L.PRICEPRIH, L.PRICEROZ, L.EXPDATA, L.KOL - ISNULL(S.K, 0) AS rest
  FROM dbo.INCOMELN L WITH (NOLOCK)
  LEFT JOIN (SELECT INCOMELN, SUM(KOL) AS K FROM dbo.INVOICELN WITH (NOLOCK) WHERE STATE IN (11, 12) GROUP BY INCOMELN) S
    ON S.INCOMELN = L.ID
  WHERE L.STATE IN (3, 12)
) x
WHERE x.rest > 0.0005
GROUP BY x.OTDEL, x.GOOD
"@
    $rows = New-Object System.Collections.Generic.List[object]
    $cmd = $conn.CreateCommand(); $cmd.CommandText = $stockSql; $cmd.CommandTimeout = 300
    $rd = $cmd.ExecuteReader()
    while ($rd.Read()) {
      $rows.Add([ordered]@{ F=[string]$rd["F"]; G=[string]$rd["G"]; Q=[string]$rd["Q"]; C=[string]$rd["C"]; P=[string]$rd["P"]; E=[string]$rd["E"] })
    }
    $rd.Close()
    $payload = @{ rows=$rows } | ConvertTo-Json -Compress -Depth 5
    Write-AgentLog ("sqlStock rows=$($rows.Count)")
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))
    Invoke-RestMethod -Method Post -Uri ($Platform + "/api/fom/agent/job-result") -ContentType "application/json; charset=utf-8" -Body ((@{ token=$Token; jobId=$job.id; ok=$true; xmlBase64=$b64 } | ConvertTo-Json -Compress -Depth 4)) -TimeoutSec 900 | Out-Null
    Write-AgentLog ("job ok sqlStock " + $job.id)
  } finally { try { $conn.Close() } catch {} }
}
function Push-OrgNamesFromSql {
  $servers = @(".\SQLEXPRESS", ".", "localhost\SQLEXPRESS", "localhost", "(local)")
  $dbs = @("NAPTSKLAD", "NAPT", "apteka", "APTEKA", "FAPTEKA")
  $sql = "SELECT CAST(O.ID AS varchar(20)) AS I, LTRIM(RTRIM(O.NAME)) AS N, CASE WHEN ISNULL(O.APT,0)=1 THEN '1' ELSE '0' END AS APT, CASE WHEN ISNULL(O.INC,0)=1 THEN '1' ELSE '0' END AS INC, ISNULL(O.INN,'') AS INN FROM dbo.ORG O WHERE O.NAME IS NOT NULL AND LTRIM(RTRIM(O.NAME)) <> ''"
  $orgs = @()
  foreach ($srv in $servers) {
    foreach ($db in $dbs) {
      try {
        $cs = "Server=$srv;Database=$db;Integrated Security=True;TrustServerCertificate=True;Connect Timeout=4"
        $conn = New-Object System.Data.SqlClient.SqlConnection $cs
        $conn.Open()
        $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 30
        $rd = $cmd.ExecuteReader()
        while ($rd.Read()) {
          $orgs += [pscustomobject]@{ I=[string]$rd["I"]; N=[string]$rd["N"]; APT=[string]$rd["APT"]; INC=[string]$rd["INC"]; INN=[string]$rd["INN"] }
        }
        $rd.Close(); $conn.Close()
        if ($orgs.Count -gt 0) { Write-AgentLog ("org sql ok $srv/$db rows=$($orgs.Count)"); break }
      } catch {}
    }
    if ($orgs.Count -gt 0) { break }
  }
  if ($orgs.Count -lt 1) {
    $sql2 = "SELECT CAST(T.ID AS varchar(20)) AS I, LTRIM(RTRIM(T.NAME)) AS N, '1' AS APT, '0' AS INC, '' AS INN FROM dbo.OTDEL T WHERE T.NAME IS NOT NULL AND LTRIM(RTRIM(T.NAME)) <> ''"
    foreach ($srv in $servers) {
      foreach ($db in $dbs) {
        try {
          $cs = "Server=$srv;Database=$db;Integrated Security=True;TrustServerCertificate=True;Connect Timeout=4"
          $conn = New-Object System.Data.SqlClient.SqlConnection $cs
          $conn.Open()
          $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql2; $cmd.CommandTimeout = 30
          $rd = $cmd.ExecuteReader()
          while ($rd.Read()) {
            $orgs += [pscustomobject]@{ I=[string]$rd["I"]; N=[string]$rd["N"]; APT="1"; INC="0"; INN="" }
          }
          $rd.Close(); $conn.Close()
          if ($orgs.Count -gt 0) { Write-AgentLog ("otdel sql ok $srv/$db rows=$($orgs.Count)"); break }
        } catch {}
      }
      if ($orgs.Count -gt 0) { break }
    }
  }
  if ($orgs.Count -lt 1) { Write-AgentLog "org sql: no rows"; return }
  $body = (@{ token=$Token; orgs=$orgs } | ConvertTo-Json -Compress -Depth 5)
  $res = Invoke-RestMethod -Method Post -Uri ($Platform + "/api/fom/agent/push-org-names") -ContentType "application/json; charset=utf-8" -Body $body -TimeoutSec 60
  Write-AgentLog ("push-org-names branches=$($res.branches) named=$($res.named)")
}
function Invoke-JobPoll {
  $poll = Invoke-RestMethod -Method Post -Uri ($Platform + "/api/fom/agent/poll") -ContentType "application/json; charset=utf-8" -Body ((@{ token = $Token } | ConvertTo-Json -Compress)) -TimeoutSec 30
  $jobs = @(); if ($null -ne $poll.jobs) { $jobs = @($poll.jobs) }
  Write-AgentLog ("poll jobs=" + $jobs.Count)
  foreach ($job in $jobs) {
    try {
      if ([string]$job.kind -eq "sqlReceipts") { Invoke-SqlReceiptsJob $job; continue }
      if ([string]$job.kind -eq "sqlStock") { Invoke-SqlStockJob $job; continue }
      Write-AgentLog ("fetch " + $job.localUrl)
      $resp = Invoke-WebRequest -Uri $job.localUrl -UseBasicParsing -TimeoutSec 900
      $xml = [string]$resp.Content
      if ($xml -match "(?i)<HTML|<BODY>\s*<B>\s*200") {
        $xml = '<?xml version="1.0" encoding="utf-8"?><ROOT/>'
        Write-AgentLog ("job empty HTML200 " + $job.id)
      }
      $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($xml))
      $result = (@{ token=$Token; jobId=$job.id; ok=$true; xmlBase64=$b64 } | ConvertTo-Json -Compress -Depth 4)
      Invoke-RestMethod -Method Post -Uri ($Platform + "/api/fom/agent/job-result") -ContentType "application/json; charset=utf-8" -Body $result -TimeoutSec 900 | Out-Null
      Write-AgentLog ("job ok " + $job.id + " bytes=" + $xml.Length)
    } catch {
      $msg = [string]$_.Exception.Message
      Write-AgentLog ("job fail " + $job.id + " " + $msg)
      try { Invoke-RestMethod -Method Post -Uri ($Platform + "/api/fom/agent/job-result") -ContentType "application/json; charset=utf-8" -Body ((@{ token=$Token; jobId=$job.id; ok=$false; message=$msg } | ConvertTo-Json -Compress)) -TimeoutSec 30 | Out-Null } catch {}
    }
  }
  return $jobs.Count
}
Write-AgentLog ("tick start pid=" + $PID + " ver=8")
$hello = $null
try { $hello = Send-Hello } catch { Write-AgentLog ("hello fail " + $_.Exception.Message) }
if ($hello -and $hello.workerUpdateB64) {
  try {
    $upd = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$hello.workerUpdateB64))
    $upd = $upd.Replace("@@AGENT_PORT@@", [string]$Port)
    $utf8 = New-Object System.Text.UTF8Encoding $true
    foreach ($tp in @((Join-Path $InstallDir "fom-worker.ps1"), (Join-Path $InstallDir "fom-agent-worker.ps1"))) {
      [IO.File]::WriteAllText($tp, $upd, $utf8)
      Write-AgentLog ("worker self-update " + $tp)
    }
  } catch { Write-AgentLog ("worker update fail " + $_.Exception.Message) }
}
try { Push-OrgNamesFromSql } catch { Write-AgentLog ("org sql fail " + $_.Exception.Message) }
$deadline = (Get-Date).AddSeconds(110)
while ((Get-Date) -lt $deadline) {
  $n = 0
  try { $n = Invoke-JobPoll } catch { Write-AgentLog ("poll fail " + $_.Exception.Message); break }
  if ($n -lt 1) { Start-Sleep -Seconds 2; try { $n = Invoke-JobPoll } catch { break }; if ($n -lt 1) { break } }
  Start-Sleep -Milliseconds 200
}
Write-AgentLog "tick end"
'@
Set-Content -Path $WorkerPath -Value $worker -Encoding UTF8
Write-Host "OK: $WorkerPath" -ForegroundColor Green

Write-Step "4) Task Scheduler (boot + har 2 daqiqa)"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WorkerPath`""
$triggerStart = New-ScheduledTaskTrigger -AtStartup
$triggerRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration ([TimeSpan]::MaxValue)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($triggerStart, $triggerRepeat) -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "OK: vazifa $TaskName (startup + 2 daqiqa)" -ForegroundColor Green

Write-Step "5) Birinchi tick + to‘liq tortishni boshlash"
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5
$syncBody = @{
  token = $Token
  from  = $DateFrom
  to    = $DateTo
} | ConvertTo-Json
$sync = Invoke-RestMethod -Method Post -Uri "$PlatformUrl/api/fom/agent/start-sync" `
  -ContentType "application/json; charset=utf-8" `
  -Body $syncBody -TimeoutSec 60
Write-Host ($sync | ConvertTo-Json -Compress) -ForegroundColor Green

Write-Host "Ishchi 3 daqiqa joblarni oladi..." -ForegroundColor Cyan
$until = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt $until) {
  try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $WorkerPath } catch { Write-Log $_.Exception.Message }
  Start-Sleep -Seconds 5
}

Write-Step "TAYYOR" "Green"
Write-Host "Radmin/VPN kerak emas. Internet chiqishi (HTTPS) bo'lsa yetadi."
Write-Host "Kompyuter o'chib yonsa ham vazifa o'zi ishga tushadi."
Write-Host "Admin: $PlatformUrl/settings  — bo'laklar / foiz"
Write-Host "Log: $LogPath"
Write-Log "first-run complete"
