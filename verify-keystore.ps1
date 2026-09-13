$javaHome = $env:JAVA_HOME
Write-Host "JAVA_HOME: $javaHome"

$keytoolPath = "$javaHome\bin\keytool.exe"
Write-Host "Keytool path: $keytoolPath"

$keystorePath = "android\app\eas-keystore.jks"

# SECRET-LESS: read the store password / alias from the gitignored
# credentials.json instead of hardcoding them in this file.
if (-not (Test-Path "credentials.json")) {
    Write-Host "credentials.json not found - place it in the repo root (gitignored) and retry."
    exit 1
}
$creds = Get-Content "credentials.json" | ConvertFrom-Json
$storePass = $creds.android.keystore.keystorePassword
$alias = $creds.android.keystore.keyAlias

Write-Host ""
Write-Host "Verifying keystore: $keystorePath"
Write-Host "Alias: $alias"

if (Test-Path $keytoolPath) {
    Write-Host "Keytool found!"

    & $keytoolPath -list -v -keystore $keystorePath -storepass $storePass -alias $alias 2>&1 | Select-String -Pattern "SHA1:|SHA256:|SHA256|Valid from:"
} else {
    Write-Host "Keytool not found at: $keytoolPath"

    # Try to find keytool
    Write-Host ""
    Write-Host "Searching for keytool..."
    $keytoolExe = Get-ChildItem -Path $javaHome -Recurse -Filter "keytool.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($keytoolExe) {
        Write-Host "Found keytool at: $($keytoolExe.FullName)"
    }
}