// swift-tools-version:6.0
// Tools version 6.0 builds the target in the Swift 6 language mode (strict concurrency).
import PackageDescription

let package = Package(
    name: "mysthi-helper",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "mysthi-helper", targets: ["MysthiHelper"]),
    ],
    targets: [
        .executableTarget(
            name: "MysthiHelper",
            path: "Sources/MysthiHelper"
        ),
    ]
)
