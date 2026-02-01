/**
 * AutoSnippet 原生入口：完整性校验 + spawn Node 执行 bin/asnip.js
 * 若 checksums.json 不存在则跳过校验（开发模式）；存在则校验关键文件 SHA-256，不通过则 exit(1)。
 */

import Foundation
import CryptoKit

func fail(_ msg: String) -> Never {
	fputs(msg + "\n", stderr)
	fflush(stderr)
	exit(1)
}

/// 从 argv[0] 解析包根目录（bin 的父目录）。要求 root 下存在 bin/asnip.js，否则返回 nil。
func getPackageRoot() -> String? {
	let arg0 = CommandLine.arguments[0]
	let cwd = FileManager.default.currentDirectoryPath
	var pathStr = arg0
	if !arg0.hasPrefix("/") {
		pathStr = (cwd as NSString).appendingPathComponent(arg0)
	}
	let url = URL(fileURLWithPath: pathStr).resolvingSymlinksInPath()
	let binDir = url.deletingLastPathComponent()
	let root = binDir.deletingLastPathComponent()
	let rootPath = root.path
	let asnipPath = (rootPath as NSString).appendingPathComponent("bin/asnip.js")
	guard FileManager.default.fileExists(atPath: asnipPath) else {
		return nil
	}
	return rootPath
}

/// 计算文件 SHA-256 十六进制字符串
func sha256Hex(fileURL: URL) -> String? {
	guard let data = try? Data(contentsOf: fileURL) else { return nil }
	let digest = SHA256.hash(data: data)
	return digest.map { String(format: "%02x", $0) }.joined()
}

/// 校验 checksums.json 中列出的文件。禁止 relPath 含 ".." 或为绝对路径，防止路径逃逸。
func verifyIntegrity(root: String, checksumsPath: String) -> Bool {
	guard let data = try? Data(contentsOf: URL(fileURLWithPath: checksumsPath)) else {
		fputs("asd: 无法读取 checksums.json\n", stderr)
		return false
	}
	guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: String] else {
		fputs("asd: checksums.json 格式无效\n", stderr)
		return false
	}
	let rootURL = URL(fileURLWithPath: root)
	var rootNorm = rootURL.resolvingSymlinksInPath().path
	if rootNorm.hasSuffix("/") { rootNorm = String(rootNorm.dropLast()) }
	for (relPath, expectedHex) in json {
		if relPath.hasPrefix("/") || relPath.contains("..") {
			fputs("asd: 校验拒绝非法路径: \(relPath)\n", stderr)
			return false
		}
		let fileURL = rootURL.appendingPathComponent(relPath)
		let resolvedPath = fileURL.resolvingSymlinksInPath().path
		guard resolvedPath == rootNorm || resolvedPath.hasPrefix(rootNorm + "/") else {
			fputs("asd: 校验拒绝路径逃逸: \(relPath)\n", stderr)
			return false
		}
		guard FileManager.default.fileExists(atPath: fileURL.path),
		      let actualHex = sha256Hex(fileURL: fileURL) else {
			fputs("asd: 校验失败（无法读取）: \(relPath)\n", stderr)
			return false
		}
		if actualHex != expectedHex {
			fputs("asd: 完整性校验失败: \(relPath)\n", stderr)
			return false
		}
	}
	return true
}

/// 执行 node bin/asnip.js [args...]，返回子进程退出码。将调用时的 cwd 传入 ASD_CWD，供 asnip 查找项目根。
func spawnNode(root: String) -> Int32 {
	let asnipPath = (root as NSString).appendingPathComponent("bin/asnip.js")
	guard FileManager.default.fileExists(atPath: asnipPath) else {
		fail("asd: 未找到 bin/asnip.js")
	}
	let nodeArgs = ["node", asnipPath] + CommandLine.arguments.dropFirst()
	let process = Process()
	process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
	process.arguments = Array(nodeArgs)
	process.currentDirectoryURL = URL(fileURLWithPath: root)
	var env = ProcessInfo.processInfo.environment
	env["ASD_CWD"] = FileManager.default.currentDirectoryPath
	process.environment = env
	process.standardInput = FileHandle.standardInput
	process.standardOutput = FileHandle.standardOutput
	process.standardError = FileHandle.standardError
	do {
		try process.run()
		process.waitUntilExit()
		return process.terminationStatus
	} catch {
		fail("asd: 启动 node 失败: \(error.localizedDescription)")
	}
}

// MARK: - Main

guard let root = getPackageRoot() else {
	fail("asd: 无法解析包根目录")
}

let checksumsPath = (root as NSString).appendingPathComponent("checksums.json")

if FileManager.default.fileExists(atPath: checksumsPath) {
	if !verifyIntegrity(root: root, checksumsPath: checksumsPath) {
		exit(1)
	}
}

exit(spawnNode(root: root))
