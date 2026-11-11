#!/usr/bin/env bash
# Verify the zAgentKit bundle before it is uploaded.
# Usage: verify-desktop-bundle.sh <version> <app bundle> <zip> <dmg>
# Checks: arm64 executable, bundle version, ad-hoc signature on the app and on the app inside the ZIP, DMG integrity.
set -euo pipefail

version=${1:?usage: verify-desktop-bundle.sh <version> <app bundle> <zip> <dmg>}
app=${2:?usage: verify-desktop-bundle.sh <version> <app bundle> <zip> <dmg>}
zip=${3:?usage: verify-desktop-bundle.sh <version> <app bundle> <zip> <dmg>}
dmg=${4:?usage: verify-desktop-bundle.sh <version> <app bundle> <zip> <dmg>}

fail() { echo "verify-desktop-bundle: $*" >&2; exit 1; }

[[ -d "$app" ]] || fail "app bundle not found: $app"
[[ -f "$zip" ]] || fail "zip not found: $zip"
[[ -f "$dmg" ]] || fail "dmg not found: $dmg"

plist="$app/Contents/Info.plist"
executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")
archs=$(lipo -archs "$app/Contents/MacOS/$executable")
[[ "$archs" == "arm64" ]] || fail "expected arm64 executable, found '$archs'"

actual=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")
[[ "$actual" == "$version" ]] || fail "CFBundleShortVersionString is '$actual', expected '$version'"

identifier=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")
[[ "$identifier" == "dev.supercent.zak-desktop" ]] || fail "unexpected bundle identifier '$identifier'"

codesign --verify --deep --strict "$app" || fail "codesign verification failed for $app"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
ditto -x -k "$zip" "$work"
unzipped=$(find "$work" -maxdepth 1 -name '*.app' -type d)
[[ -n "$unzipped" && "$(printf '%s\n' "$unzipped" | wc -l | tr -d ' ')" == 1 ]] || fail "zip must hold exactly one app bundle"
codesign --verify --deep --strict "$unzipped" || fail "codesign verification failed for the app inside the zip"

hdiutil verify "$dmg" >/dev/null || fail "dmg failed hdiutil verify"

echo "verify-desktop-bundle: ok"
echo "  app:     $app"
echo "  arch:    $archs"
echo "  version: $actual"
echo "  zip:     $(stat -f %z "$zip") bytes"
echo "  dmg:     $(stat -f %z "$dmg") bytes"
