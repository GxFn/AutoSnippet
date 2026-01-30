// ParsePackage: STDIO JSON 协议，解析 Package.swift → name/targets/dependencies
// 与 Node 侧 swiftParserClient.js 协议对齐

import Foundation
import SwiftParser
import SwiftSyntax

// MARK: - 协议结构（与 Node 输入/输出一致）

struct InputPayload: Codable {
	let schemaVersion: Int?
	let command: String?
	let packageSwiftPath: String?
	let options: InputOptions?
}

struct InputOptions: Codable {
	let resolveLocalPaths: Bool?
	let projectRoot: String?
	let includeEdits: Bool?
}

struct OutputPackage: Codable {
	var packageSwiftPath: String?
	var packageDir: String?
	var name: String?
	var targets: [OutputTarget]?
}

struct OutputTarget: Codable {
	var name: String?
	var path: String?
	var sources: [String]?
	var dependencies: [OutputDep]?
}

struct OutputDep: Codable {
	var kind: String  // "target" | "product" | "byName"
	var name: String
	var package: String?
}

struct OutputPayload: Codable {
	let schemaVersion: Int
	let ok: Bool
	let package: OutputPackage?
	let error: OutputError?
	let warnings: [String]?
}

struct OutputError: Codable {
	let code: String?
	let message: String?
	let hint: String?
}

// MARK: - 从表达式中提取字符串（含字符串字面量、标识符）

func stringFromExpression(_ expr: ExprSyntax) -> String? {
	if let literal = expr.as(StringLiteralExprSyntax.self) {
		// 取 segments 中 StringSegment 的 content 并拼接
		var parts: [String] = []
		for segment in literal.segments {
			if let seg = segment.as(StringSegmentSyntax.self) {
				parts.append(seg.content.text)
			}
		}
		return parts.isEmpty ? nil : parts.joined()
	}
	if let ident = expr.as(DeclReferenceExprSyntax.self) {
		return ident.baseName.text
	}
	// 兜底：整段源码去掉首尾空白与引号
	let text = expr.trimmedDescription
		.trimmingCharacters(in: .whitespacesAndNewlines)
	if text.hasPrefix("\"") && text.hasSuffix("\"") {
		var s = String(text.dropFirst().dropLast())
		s = s.replacingOccurrences(of: "\\\"", with: "\"")
		return s
	}
	return text.isEmpty ? nil : text
}

// MARK: - 从 FunctionCall 的 arguments 中按 label 取表达式

func expression(forLabel label: String, in arguments: LabeledExprListSyntax) -> ExprSyntax? {
	for arg in arguments {
		guard let argLabel = arg.label?.text, argLabel == label else { continue }
		return arg.expression
	}
	return nil
}

// MARK: - 解析 dependencies 数组中的一项 → OutputDep

func parseDependency(_ expr: ExprSyntax) -> OutputDep? {
	// 先识别 .target / .product / .byName，再处理字符串，避免 .product(...) 被当成整段 byName
	if let call = expr.as(FunctionCallExprSyntax.self) {
		let called = call.calledExpression
		let args = call.arguments
		if let member = called.as(MemberAccessExprSyntax.self) {
			let memberName = member.declName.baseName.text
			if memberName == "target" {
				guard let nameExpr = expression(forLabel: "name", in: args),
				      let name = stringFromExpression(nameExpr) else { return nil }
				return OutputDep(kind: "target", name: name, package: nil)
			}
			if memberName == "product" {
				guard let nameExpr = expression(forLabel: "name", in: args),
				      let name = stringFromExpression(nameExpr) else { return nil }
				let pkg = expression(forLabel: "package", in: args).flatMap { stringFromExpression($0) }
				return OutputDep(kind: "product", name: name, package: pkg)
			}
			if memberName == "byName" {
				guard let nameExpr = expression(forLabel: "name", in: args),
				      let name = stringFromExpression(nameExpr) else { return nil }
				return OutputDep(kind: "byName", name: name, package: nil)
			}
		}
	}
	// 字符串 "ModuleName" → byName
	if let name = stringFromExpression(expr), !name.isEmpty {
		return OutputDep(kind: "byName", name: name, package: nil)
	}
	return nil
}

// MARK: - 解析 target 的 dependencies 数组（数组字面量中的元素）

func parseDependenciesList(_ expr: ExprSyntax) -> [OutputDep] {
	var deps: [OutputDep] = []
	if let list = expr.as(ArrayExprSyntax.self) {
		for elem in list.elements {
			let elemExpr = elem.expression
			if let d = parseDependency(elemExpr) {
				deps.append(d)
			}
		}
	}
	return deps
}

// MARK: - Visitor：收集 Package(name:) 与 .target(name:dependencies:path:sources:)

final class PackageManifestVisitor: SyntaxVisitor {
	var packageName: String?
	var packageDir: String?
	var packageSwiftPath: String = ""
	var targets: [OutputTarget] = []
	private var isInsideTargetsArray = false
	private var targetCallDepth = 0

	override func visit(_ node: FunctionCallExprSyntax) -> SyntaxVisitorContinueKind {
		let called = node.calledExpression
		let args = node.arguments

		// Package(name: "X", ...)
		if let ident = called.as(DeclReferenceExprSyntax.self), ident.baseName.text == "Package" {
			if let nameExpr = expression(forLabel: "name", in: args),
			   let name = stringFromExpression(nameExpr) {
				packageName = name
			}
			return .visitChildren
		}

		// .target(...) 或 .executableTarget(...)
		if let member = called.as(MemberAccessExprSyntax.self) {
			let memberName = member.declName.baseName.text
			if memberName == "target" || memberName == "executableTarget" {
				var name: String?
				var path: String?
				var sources: [String]?
				var dependencies: [OutputDep] = []

				if let nameExpr = expression(forLabel: "name", in: args) {
					name = stringFromExpression(nameExpr)
				}
				if let pathExpr = expression(forLabel: "path", in: args) {
					path = stringFromExpression(pathExpr)
				}
				if let depsExpr = expression(forLabel: "dependencies", in: args) {
					dependencies = parseDependenciesList(depsExpr)
				}
				if let sourcesExpr = expression(forLabel: "sources", in: args) {
					if let arr = sourcesExpr.as(ArrayExprSyntax.self) {
						sources = arr.elements.compactMap { stringFromExpression($0.expression) }
					}
				}

				if let n = name {
					targets.append(OutputTarget(
						name: n,
						path: path,
						sources: sources,
						dependencies: dependencies.isEmpty ? nil : dependencies
					))
				}
				return .skipChildren
			}
		}
		return .visitChildren
	}
}

// MARK: - 主流程

func run() {
	guard let inputLine = readLine(strippingNewline: true), !inputLine.isEmpty else {
		writeError("no input")
		exit(1)
	}

	guard let inputData = inputLine.data(using: .utf8),
	      let input = try? JSONDecoder().decode(InputPayload.self, from: inputData),
	      input.command == "parsePackage",
	      let packageSwiftPath = input.packageSwiftPath, !packageSwiftPath.isEmpty else {
		writeError("invalid input")
		exit(1)
	}

	let url = URL(fileURLWithPath: packageSwiftPath)
	guard FileManager.default.fileExists(atPath: url.path) else {
		writeError("file not found: \(packageSwiftPath)")
		exit(1)
	}

	guard let source = try? String(contentsOf: url, encoding: .utf8) else {
		writeError("cannot read file")
		exit(1)
	}

	let sourceFile = Parser.parse(source: source)
	let visitor = PackageManifestVisitor(viewMode: .sourceAccurate)
	visitor.packageSwiftPath = packageSwiftPath
	visitor.packageDir = url.deletingLastPathComponent().path
	visitor.walk(sourceFile)

	let package = OutputPackage(
		packageSwiftPath: packageSwiftPath,
		packageDir: visitor.packageDir,
		name: visitor.packageName,
		targets: visitor.targets.isEmpty ? nil : visitor.targets
	)

	let output = OutputPayload(
		schemaVersion: 1,
		ok: true,
		package: package,
		error: nil,
		warnings: nil
	)
	writeOutput(output)
}

func writeOutput(_ output: OutputPayload) {
	let encoder = JSONEncoder()
	encoder.outputFormatting = [.sortedKeys]
	guard let data = try? encoder.encode(output),
	      let str = String(data: data, encoding: .utf8) else {
		writeError("encode failed")
		exit(1)
	}
	print(str)
}

func writeError(_ message: String) {
	let output = OutputPayload(
		schemaVersion: 1,
		ok: false,
		package: nil,
		error: OutputError(code: "parseFailed", message: message, hint: "fallbackToAstLite"),
		warnings: nil
	)
	writeOutput(output)
}

run()
