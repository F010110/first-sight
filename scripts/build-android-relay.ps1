param([Parameter(Mandatory=$true)][string]$Sdk,[Parameter(Mandatory=$true)][string]$JavaHome)
$ErrorActionPreference='Stop'
$env:JAVA_HOME=$JavaHome
$env:Path="$JavaHome/bin;"+$env:Path
$root=Split-Path $PSScriptRoot -Parent
$out=Join-Path $root 'run/android-relay-build'
New-Item -ItemType Directory -Force "$out/classes","$out/dex" | Out-Null
$tools=Join-Path $Sdk 'build-tools/35.0.0'
$platform=Join-Path $Sdk 'platforms/android-35/android.jar'
function Check-Exit {if($LASTEXITCODE -ne 0){throw "Android build command failed: $LASTEXITCODE"}}
$sources=Get-ChildItem "$root/android/relay/src" -Recurse -Filter '*.java' | ForEach-Object {$_.FullName}
& "$JavaHome/bin/javac.exe" -encoding UTF-8 --release 8 -classpath $platform -d "$out/classes" $sources
Check-Exit
& "$JavaHome/bin/jar.exe" cf "$out/classes.jar" -C "$out/classes" .
Check-Exit
& "$tools/d8.bat" --lib $platform --min-api 26 --output "$out/dex" "$out/classes.jar"
Check-Exit
& "$tools/aapt.exe" package -f -M "$root/android/relay/AndroidManifest.xml" -I $platform -F "$out/unsigned.apk"
Check-Exit
Push-Location "$out/dex"
try {& "$tools/aapt.exe" add "$out/unsigned.apk" classes.dex;Check-Exit} finally {Pop-Location}
& "$tools/zipalign.exe" -f 4 "$out/unsigned.apk" "$out/aligned.apk"
Check-Exit
$key=Join-Path $env:LOCALAPPDATA 'Temp/opencode/android-relay-build/debug.keystore'
if(!(Test-Path $key)){
 & "$JavaHome/bin/keytool.exe" -genkeypair -keystore $key -storepass android -keypass android -alias androiddebugkey -dname 'CN=First Sight Local Debug' -keyalg RSA -keysize 2048 -validity 3650
 Check-Exit
}
& "$tools/apksigner.bat" sign --ks $key --ks-pass pass:android --key-pass pass:android --out "$out/first-sight-relay-debug.apk" "$out/aligned.apk"
Check-Exit
& "$tools/apksigner.bat" verify --verbose "$out/first-sight-relay-debug.apk"
Check-Exit
Write-Output "APK: $out/first-sight-relay-debug.apk"
