# Generates a local development CA and a server certificate for LAN HTTPS.
#
# The server certificate contains SAN entries for the machine's LAN IPv4
# address and localhost, so a phone on the same Wi-Fi can open
# https://<lan-ip>:8765/vlm after trusting the generated CA.
#
# Outputs (all under run/tls):
#   vlm-local-ca.cer   - CA certificate to install/trust on the phone
#   vlm-server.pfx     - server certificate + private key for Node
#   passphrase.txt     - PFX passphrase (local, git-ignored run directory)
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/setup-lan-tls.ps1

$ErrorActionPreference = "Stop"

$tlsDir = Join-Path (Get-Location) "run\tls"
New-Item -ItemType Directory -Force -Path $tlsDir | Out-Null
$passphrase = "vlm-local"

# Pick the LAN IPv4 address of the active Wi-Fi/Ethernet adapter.
$lanIp = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -notmatch "Loopback" -and $_.IPAddress -notmatch "^169\." -and $_.IPAddress -ne "127.0.0.1" } |
    Sort-Object -Property SkipAsSource, InterfaceMetric |
    Select-Object -First 1 -ExpandProperty IPAddress)
if (-not $lanIp) { throw "Could not determine a LAN IPv4 address." }
Write-Host "LAN IPv4 address: $lanIp"

# Reuse an existing CA if present, otherwise create one.
$ca = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq "CN=VLM Local Dev CA" } | Select-Object -First 1
if (-not $ca) {
    Write-Host "Creating local CA..."
    $ca = New-SelfSignedCertificate `
        -Subject "CN=VLM Local Dev CA" `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -KeyExportPolicy Exportable `
        -KeyAlgorithm RSA -KeyLength 2048 `
        -NotAfter (Get-Date).AddYears(5) `
        -KeyUsage CertSign, CRLSign, DigitalSignature `
        -TextExtension @("2.5.29.19={text}CA=true")
}

# Remove any previous server cert with the same subject to keep this idempotent.
Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -like "CN=VLM LAN Server*" } | Remove-Item -ErrorAction SilentlyContinue

Write-Host "Creating server certificate for $lanIp..."
$server = New-SelfSignedCertificate `
    -Subject "CN=VLM LAN Server" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyExportPolicy Exportable `
    -KeyAlgorithm RSA -KeyLength 2048 `
    -NotAfter (Get-Date).AddYears(3) `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -TextExtension @(
        "2.5.29.19={text}CA=false",
        "2.5.29.37={text}1.3.6.1.5.5.7.3.1",
        "2.5.29.17={text}IPAddress=$lanIp&DNS=localhost&DNS=$lanIp"
    ) `
    -Signer $ca

Export-Certificate -Cert $ca -FilePath (Join-Path $tlsDir "vlm-local-ca.cer") -Type CERT -Force | Out-Null
$secure = ConvertTo-SecureString -String $passphrase -AsPlainText -Force
Export-PfxCertificate -Cert $server -FilePath (Join-Path $tlsDir "vlm-server.pfx") -Password $secure -Force | Out-Null
Set-Content -Path (Join-Path $tlsDir "passphrase.txt") -Value $passphrase -NoNewline -Encoding ASCII
Set-Content -Path (Join-Path $tlsDir "lan-ip.txt") -Value $lanIp -NoNewline -Encoding ASCII

Write-Host ""
Write-Host "Done."
Write-Host "  CA certificate (install on phone): $(Join-Path $tlsDir 'vlm-local-ca.cer')"
Write-Host "  Server PFX:                        $(Join-Path $tlsDir 'vlm-server.pfx')"
Write-Host "  Phone URL:                         https://${lanIp}:8765/vlm"
