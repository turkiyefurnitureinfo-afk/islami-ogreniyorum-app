Write-Host "=== APK Checkpoint ===" -ForegroundColor Cyan
$apkPath = "C:\islami-ogreniyorum-app\islami-ogreniyorum-app\android\app\build\outputs\apk\release\app-release.apk"
if (Test-Path $apkPath) {
    Write-Host "BUILD SUCCESS - APK FOUND"
    Write-Host "Path: $apkPath"
    $bytes = (Get-Item $apkPath).Length
    Write-Host "Size: $([math]::Round($bytes/1MB, 2)) MB ($bytes bytes)"
    exit 0
} else {
    Write-Host "APK NOT YET CREATED - build still in progress"
    exit 1
}
