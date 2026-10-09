# Clean rebuild + restart of the production server used for visual QA.
$ErrorActionPreference = "Continue"
$root = "C:\Users\HUZAIFA\OneDrive\Desktop\depedency-zero"

Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'next(\\|/)dist(\\|/)bin(\\|/)next|npm(\\|/)cli\.js.*\sstart' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
  Write-Output "port 3000 still busy"
  exit 1
}

Push-Location $root
$log = & npm run build 2>&1
$code = $LASTEXITCODE
Pop-Location

if ($code -ne 0) {
  $log | Select-Object -Last 40
  Write-Output "BUILD FAILED"
  exit 1
}
$log | Select-String -Pattern "Compiled|Route \(app\)|○|ƒ" | Select-Object -First 8

Start-Process -FilePath "npm.cmd" -ArgumentList "run", "start" `
  -WorkingDirectory $root `
  -RedirectStandardOutput "$env:TEMP\dz-start.log" `
  -RedirectStandardError "$env:TEMP\dz-start.err" `
  -WindowStyle Hidden

for ($i = 0; $i -lt 40; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:3000/" -UseBasicParsing -TimeoutSec 8
    if ($r.StatusCode -eq 200) { Write-Output "server ready"; exit 0 }
  } catch { }
  Start-Sleep -Seconds 2
}
Write-Output "SERVER DID NOT START"
Get-Content "$env:TEMP\dz-start.log", "$env:TEMP\dz-start.err" -Tail 20
exit 1