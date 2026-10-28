// swift-tools-version: 6.2
// The iOS app's parts that don't need UIKit — the Fugitive models, the
// offline engine and table, nearby play — built with the Xcode project's
// settings (Swift 6, MainActor by default) so they compile, and their tests
// run, on Linux: in CI, and anywhere without a Mac. The sources are symlinks
// into ios/GameNight and ios/GameNightTests; MultipeerConnectivity is a
// signature-only stub. A file added to the app that should be checked here
// needs a symlink too.
//
//   cd ios/LinuxTests && ./run.sh            # in the swift:6.2 container
//   cd ios/LinuxTests && swift test          # with a Swift 6.2 toolchain
import PackageDescription

let settings: [SwiftSetting] = [.defaultIsolation(MainActor.self)]
let package = Package(
    name: "GameNight",
    targets: [
        .target(name: "MultipeerConnectivity"),
        .target(name: "GameNight", dependencies: ["MultipeerConnectivity"], swiftSettings: settings),
        .testTarget(name: "GameNightTests", dependencies: ["GameNight"], exclude: ["Fixtures"],
                    swiftSettings: settings),
    ]
)
