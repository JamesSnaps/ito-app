#!/bin/sh
# Archives a Release build and uploads it to App Store Connect for TestFlight,
# the same way as Brief (news-hub/ios/scripts/testflight.sh). Uses the Apple
# account signed in to Xcode; team C729B84RYG, as in project.yml.
#
#   ios/scripts/testflight.sh            # archive and upload
#   UPLOAD=0 ios/scripts/testflight.sh   # archive and export an .ipa only
#   ARCHIVE=<path>/GameNight-<build>.xcarchive ios/scripts/testflight.sh  # upload an existing archive
#
# Archives and exports go to $GAMENIGHT_BUILD, outside the repo.
#
# The build number is the time (yyyymmddHHMM, UTC), so every upload is newer
# than the last; the version is MARKETING_VERSION in project.yml.
set -eu
cd "$(dirname "$0")/.."
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

if [ -z "${SKIP_ARCHIVE:-}" ]; then
xcodegen generate
xcodebuild -project GameNight.xcodeproj -scheme GameNight -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD" archive -quiet
fi

cat > "$GAMENIGHT_BUILD/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DESTINATION</string>
  <key>teamID</key><string>C729B84RYG</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$GAMENIGHT_BUILD/ExportOptions.plist" \
  -exportPath "$GAMENIGHT_BUILD/export-$BUILD" -allowProvisioningUpdates
echo "Build $BUILD: $DESTINATION done."
