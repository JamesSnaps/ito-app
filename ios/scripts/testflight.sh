#!/bin/sh
# Archives a Release build and uploads it to App Store Connect for TestFlight,
# the same way as Brief (news-hub/ios/scripts/testflight.sh); team C729B84RYG,
# as in project.yml.
#
#   ios/scripts/testflight.sh            # archive and upload
#   UPLOAD=0 ios/scripts/testflight.sh   # archive and export an .ipa only
#   ARCHIVE=<path>/GameNight-<build>.xcarchive ios/scripts/testflight.sh  # upload an existing archive
#   ADHOC=1 ios/scripts/testflight.sh    # an ad hoc .ipa, for devices registered with the account
#   ADHOC=1 INSTALL="Louis's iPad" ios/scripts/testflight.sh   # ...and install it on that device
#
# Ad hoc builds (ios/README.md, "Ad hoc builds") are for family under 13, who
# can't use TestFlight: the device is registered with the team once (Brief's
# news-hub/ios/scripts/register-device.mjs — same team, so a device registered
# for Brief is already registered here), Developer Mode is on (iOS won't open an
# ad hoc app without it), then build and install over a cable. Each runs for a
# year, until its provisioning profile expires.
#
# Archives and exports go to $GAMENIGHT_BUILD, outside the repo.
#
# The build number is the time (yyyymmddHHMM, UTC), so every upload is newer
# than the last; the version is MARKETING_VERSION in project.yml.
#
# Signing and upload use an App Store Connect API key, so they don't depend on
# the account signed in to Xcode (Xcode 27.1 stopped sharing that with
# xcodebuild: "No Accounts"). The key is the team's — Brief and Dishes use the
# same one — at ~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8, with its ids
# in ~/.appstoreconnect/gamenight.env (or ASC_ENV):
#
#   ASC_KEY_ID=ABC123DEFG
#   ASC_ISSUER_ID=00000000-0000-0000-0000-000000000000
#
# Without them it falls back to Xcode's account.
set -eu
cd "$(dirname "$0")/.."
# Xcode's export copies with whichever rsync comes first; Homebrew's 3.x breaks
# it ("Copy failed"), so the system tools go first.
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
ASC_ENV=${ASC_ENV:-$HOME/.appstoreconnect/gamenight.env}
[ -f "$ASC_ENV" ] && . "$ASC_ENV"
AUTH=""
if [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ]; then
  KEY=${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8}
  [ -f "$KEY" ] || { echo "No API key at $KEY" >&2; exit 1; }
  AUTH="-authenticationKeyPath $KEY -authenticationKeyID $ASC_KEY_ID -authenticationKeyIssuerID $ASC_ISSUER_ID"
  echo "Signing with App Store Connect API key $ASC_KEY_ID"
fi
GAMENIGHT_BUILD=${GAMENIGHT_BUILD:-$HOME/Library/Developer/Xcode/DerivedData/GameNight}
mkdir -p "$GAMENIGHT_BUILD"
if [ -n "${ARCHIVE:-}" ]; then
  BUILD=$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleVersion' "$ARCHIVE/Info.plist")
  SKIP_ARCHIVE=1
else
  BUILD=${BUILD:-$(date -u +%Y%m%d%H%M)}
  ARCHIVE=$GAMENIGHT_BUILD/GameNight-$BUILD.xcarchive
fi
DESTINATION=$([ "${UPLOAD:-1}" = 1 ] && echo upload || echo export)
METHOD=app-store-connect
if [ -n "${ADHOC:-}" ]; then
  METHOD=release-testing  # Xcode's name for ad hoc
  DESTINATION=export
fi
EXPORT=$GAMENIGHT_BUILD/export-${ADHOC:+adhoc-}$BUILD

if [ -z "${SKIP_ARCHIVE:-}" ]; then
xcodegen generate
xcodebuild -project GameNight.xcodeproj -scheme GameNight -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates $AUTH CURRENT_PROJECT_VERSION="$BUILD" archive -quiet
fi

cat > "$GAMENIGHT_BUILD/ExportOptions-$METHOD.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>$METHOD</string>
  <key>destination</key><string>$DESTINATION</string>
  <key>teamID</key><string>C729B84RYG</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$GAMENIGHT_BUILD/ExportOptions-$METHOD.plist" \
  -exportPath "$EXPORT" -allowProvisioningUpdates $AUTH
echo "Build $BUILD: $DESTINATION done."
[ "$DESTINATION" = export ] && echo "$EXPORT/GameNight.ipa"

# INSTALL is a device's name or UDID. devicectl installs (and replaces) the app;
# it wants an .app, not an .ipa, and Developer Mode on, which an ad hoc app needs
# to open anyway. Without Developer Mode, Apple Configurator can still put a
# first copy on over USB (it won't replace one that's there, though it says it did).
if [ -n "${INSTALL:-}" ]; then
  UNPACKED=$(mktemp -d)
  ditto -x -k "$EXPORT/GameNight.ipa" "$UNPACKED"
  CFGUTIL="/Applications/Apple Configurator.app/Contents/MacOS/cfgutil"
  if ! xcrun devicectl device install app --device "$INSTALL" "$UNPACKED/Payload/GameNight.app"; then
    [ -x "$CFGUTIL" ] || { rm -rf "$UNPACKED"; exit 1; }
    echo "devicectl couldn't install (Developer Mode off?): trying Apple Configurator" >&2
    ECID=$("$CFGUTIL" list | awk -v n="$INSTALL" '{ t = "Name: " n } substr($0, length($0) - length(t) + 1) == t || index($0, "UDID: " n) { print }' \
      | sed -E 's/.*ECID: (0x[0-9A-Fa-f]+).*/\1/' | head -1)
    [ -n "$ECID" ] || { rm -rf "$UNPACKED"; echo "No \"$INSTALL\" plugged in (cfgutil list)" >&2; exit 1; }
    "$CFGUTIL" --ecid "$ECID" install-app "$EXPORT/GameNight.ipa"
  fi
  rm -rf "$UNPACKED"
  echo "Installed on $INSTALL."
fi
