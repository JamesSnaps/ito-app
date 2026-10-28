#!/bin/sh
# Builds and tests the package in the official Swift 6.2 image, with the
# whole ios/ folder mounted so the symlinks resolve. Arguments go to `swift`
# (default: test). mirror.gcr.io is Docker Hub's official images, mirrored.
here=$(cd "$(dirname "$0")" && pwd)
ios=$(dirname "$here")
exec docker run --rm -v "$ios:/ios" -w /ios/LinuxTests \
  "${SWIFT_IMAGE:-mirror.gcr.io/library/swift:6.2-noble}" swift "${@:-test}"
