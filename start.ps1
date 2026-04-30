# start.ps1 - Oyunu başlat
$ErrorActionPreference = 'SilentlyContinue'

# Eski işlemleri temizle
Get-Process | Where-Object {$_.ProcessName -eq 'python' -or $_.ProcessName -eq 'ssh'} | Stop-Process -Force

Start-Sleep -Seconds 1

# WebSocket sunucusunu arka planda başlat
$wsJob = Start-Process -FilePath "python" -ArgumentList "backend/server.py" -PassThru -WindowStyle Hidden

Write-Host "WebSocket sunucusu başlatıldı (PID: $($wsJob.Id))"
Start-Sleep -Seconds 2

# HTTP sunucusunu (frontend) arka planda başlat
$httpJob = Start-Process -FilePath "python" -ArgumentList "-m", "http.server", "8080", "--directory", "frontend" -PassThru -WindowStyle Hidden

Write-Host "HTTP sunucusu başlatıldı (PID: $($httpJob.Id))"
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Tüneller açılıyor..."
Write-Host "Lütfen bekleyin..."
Write-Host ""

# İki tüneli paralel başlat
$tunnel1 = Start-Process -FilePath "ssh" -ArgumentList "-o", "StrictHostKeyChecking=accept-new", "-R", "80:localhost:8080", "nokey@localhost.run" -PassThru -WindowStyle Hidden -RedirectStandardOutput "tunnel_http.txt" -RedirectStandardError "tunnel_http_err.txt"

$tunnel2 = Start-Process -FilePath "ssh" -ArgumentList "-o", "StrictHostKeyChecking=accept-new", "-R", "80:localhost:8765", "nokey@localhost.run" -PassThru -WindowStyle Hidden -RedirectStandardOutput "tunnel_ws.txt" -RedirectStandardError "tunnel_ws_err.txt"

# Tünellerin URL'lerini bekle
$siteUrl = ""
$wsUrl = ""
$attempts = 0

while (($siteUrl -eq "" -or $wsUrl -eq "") -and $attempts -lt 30) {
    Start-Sleep -Seconds 2
    $attempts++
    
    if (Test-Path "tunnel_http.txt") {
        $content = Get-Content "tunnel_http.txt" -ErrorAction SilentlyContinue
        if ($content) {
            $line = $content | Select-String "lhr.life" | Select-Object -First 1
            if ($line) { $siteUrl = $line.ToString().Trim() }
        }
    }
    if (Test-Path "tunnel_http_err.txt") {
        $content = Get-Content "tunnel_http_err.txt" -ErrorAction SilentlyContinue
        if ($content) {
            $line = $content | Select-String "lhr.life" | Select-Object -First 1
            if ($line -and $siteUrl -eq "") { $siteUrl = $line.ToString().Trim() }
        }
    }
    
    if (Test-Path "tunnel_ws.txt") {
        $content = Get-Content "tunnel_ws.txt" -ErrorAction SilentlyContinue
        if ($content) {
            $line = $content | Select-String "lhr.life" | Select-Object -First 1
            if ($line) { $wsUrl = $line.ToString().Trim() }
        }
    }
    if (Test-Path "tunnel_ws_err.txt") {
        $content = Get-Content "tunnel_ws_err.txt" -ErrorAction SilentlyContinue
        if ($content) {
            $line = $content | Select-String "lhr.life" | Select-Object -First 1
            if ($line -and $wsUrl -eq "") { $wsUrl = $line.ToString().Trim() }
        }
    }
    
    Write-Host "Bekleniyor... ($attempts/30)"
}

Write-Host ""
Write-Host "==================================================="
Write-Host "OYUN HAZIR!"
Write-Host "==================================================="
Write-Host ""
Write-Host "Site URL: $siteUrl"
Write-Host "WS URL:   $wsUrl"
Write-Host ""

# script.js dosyasindaki WebSocket URL'ini güncelle
if ($wsUrl -ne "") {
    $jsFile = "frontend/script.js"
    $content = Get-Content $jsFile -Raw
    $wsAddress = $wsUrl -replace "https://", "wss://"
    $newLine = "    let wsUrl = '$wsAddress';"
    $content = $content -replace "    let wsUrl = '.*';", $newLine
    Set-Content $jsFile -Value $content
    Write-Host "WebSocket URL otomatik güncellendi: $wsAddress"
}

Write-Host ""
Write-Host "Arkadaşlarınıza şu linki gönderin:"
Write-Host $siteUrl
Write-Host ""
Write-Host "Durdurmak için Ctrl+C basin"

# Tüneller kapanmasın diye bekle
Wait-Process -Id $tunnel1.Id, $tunnel2.Id
