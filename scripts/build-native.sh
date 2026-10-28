#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
VERSION="$(node -p "require('./package.json').version")"
OUT="${QILIU_INSTALLERS:-$ROOT/../installers}"
WORK="$ROOT/native/.build"
rm -rf "$WORK/web"
mkdir -p "$OUT" "$WORK/web"
cp -R dist/client/. "$WORK/web/"
find "$WORK/web/art" -name "*.png" -delete
python3 - "$WORK/web/index.html" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text();s=s.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' https: data:; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">');p.write_text(s)
PY
case "${1:-all}" in mac|all)
 APP="$OUT/栖流.app"
 rm -rf "$WORK/AppIcon.iconset"
 mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web" "$WORK/AppIcon.iconset" "$WORK/module-cache"
 cp native/macos/Info.plist "$APP/Contents/Info.plist"
 rm -rf "$APP/Contents/Resources/web"
 mkdir -p "$APP/Contents/Resources/web"
 cp -R "$WORK/web/." "$APP/Contents/Resources/web/"
 find "$APP/Contents/Resources/web/art" -name "*.png" -delete
 for size in 16 32 128 256 512; do sips -z "$size" "$size" public/icon-512.png --out "$WORK/AppIcon.iconset/icon_${size}x${size}.png" >/dev/null; double=$((size*2));sips -z "$double" "$double" public/icon.png --out "$WORK/AppIcon.iconset/icon_${size}x${size}@2x.png" >/dev/null;done
 iconutil -c icns "$WORK/AppIcon.iconset" -o "$APP/Contents/Resources/AppIcon.icns"
 for arch in arm64 x86_64; do xcrun swiftc -swift-version 5 -O -target "$arch-apple-macosx13.0" -module-cache-path "$WORK/module-cache" -framework Cocoa -framework WebKit -framework Security -framework CryptoKit native/macos/Qiliu.swift -o "$WORK/Qiliu-$arch";done
 lipo -create "$WORK/Qiliu-arm64" "$WORK/Qiliu-x86_64" -output "$APP/Contents/MacOS/Qiliu"
 xattr -cr "$APP"
 codesign --force --deep --sign - "$APP"
 codesign --verify --deep --strict "$APP"
 ditto -c -k --keepParent "$APP" "$OUT/Qiliu-$VERSION-mac-universal.zip"
 ;; esac
case "${1:-all}" in android|all)
 : "${ANDROID_SDK_ROOT:?Set ANDROID_SDK_ROOT to the installed Android SDK}"
 BUILD="$ANDROID_SDK_ROOT/build-tools/35.0.0"
 PLATFORM="$ANDROID_SDK_ROOT/platforms/android-35/android.jar"
 rm -rf "$WORK/android"
 mkdir -p "$WORK/android/res" "$WORK/android/classes" "$WORK/android/dex" "$WORK/android/assets/web"
 cp -R "$WORK/web/." "$WORK/android/assets/web/"
 find "$WORK/android/assets/web/art" -name "*.png" -delete
 "$BUILD/aapt2" compile --dir native/android/res -o "$WORK/android/res.zip"
 "$BUILD/aapt2" link -o "$WORK/android/base.apk" -I "$PLATFORM" --manifest native/android/AndroidManifest.xml -A "$WORK/android/assets" "$WORK/android/res.zip"
 javac -encoding UTF-8 -source 8 -target 8 -bootclasspath "$PLATFORM:$BUILD/core-lambda-stubs.jar" -d "$WORK/android/classes" native/android/src/cc/qiliu/app/MainActivity.java
 jar cf "$WORK/android/classes.jar" -C "$WORK/android/classes" .
 "$BUILD/d8" --lib "$PLATFORM" --min-api 26 --output "$WORK/android/dex" "$WORK/android/classes.jar"
 cp "$WORK/android/base.apk" "$WORK/android/unsigned.apk"
 (cd "$WORK/android/dex" && zip -q "$WORK/android/unsigned.apk" classes*.dex)
 "$BUILD/zipalign" -f 4 "$WORK/android/unsigned.apk" "$WORK/android/aligned.apk"
 : "${QILIU_SIGNING_KEY:?Set QILIU_SIGNING_KEY to a private keystore}"
 : "${QILIU_SIGNING_PASSWORD:?Set signing password in environment}"
 "$BUILD/apksigner" sign --ks "$QILIU_SIGNING_KEY" --ks-pass env:QILIU_SIGNING_PASSWORD --ks-key-alias qiliu --out "$OUT/Qiliu-$VERSION-android.apk" "$WORK/android/aligned.apk"
 "$BUILD/apksigner" verify --verbose "$OUT/Qiliu-$VERSION-android.apk"
 ;; esac
