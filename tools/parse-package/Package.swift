// swift-tools-version: 5.9

import PackageDescription

let package = Package(
	name: "ParsePackage",
	platforms: [
		.macOS(.v10_15),
	],
	products: [
		.executable(name: "ParsePackage", targets: ["ParsePackage"]),
	],
	dependencies: [
		.package(url: "https://github.com/swiftlang/swift-syntax.git", from: "509.0.0"),
	],
	targets: [
		.executableTarget(
			name: "ParsePackage",
			dependencies: [
				.product(name: "SwiftParser", package: "swift-syntax"),
				.product(name: "SwiftSyntax", package: "swift-syntax"),
			]
		),
	]
)
