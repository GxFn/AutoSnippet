#!/usr/bin/env swift
/*
 * AutoSnippet 完整性校验入口（Swift，仅 macOS）
 * 读 checksums.json，校验关键文件 SHA-256，通过则设置 ASD_VERIFIED=1 并 spawn node bin/asnip.js。
 * 收到 SIGINT/SIGTERM 时转发给子进程，避免 asd ui 按 Ctrl+C 后 Node 成为孤儿进程占用 3000 端口。
 * 构建：node scripts/build-asd-entry.js，产物 bin/asd-verify。
 */

import Foundation
import CryptoKit
import Dispatch

func fail(_ msg: String) -> Never {
	fputs(msg + "\n", stderr)
	exit(1)
}

/// 从可执行路径解析包根目录（bin/asd-verify 的上级的上级）
func getPackageRoot() -> String? {
	let argv0 = CommandLine.arguments[0]
	let path = (argv0 as NSString).standardizingPath
	var url = URL(fileURLWithPath: path)
	if path != (path as NSString).resolvingSymlinksInPath {
		url = URL(fileURLWithPath: (path as NSString).resolvingSymlinksInPath)
	}
	var dir = url.deletingLastPathComponent().path  // bin
	dir = (dir as NSString).deletingLastPathComponent  // package root
	return dir
}

/// 文件内容 SHA-256 小写 hex
func sha256Hex(filePath: String) -> String? {
	guard let data = try? Data(contentsOf: URL(fileURLWithPath: filePath)) else { return nil }
	let hash = SHA256.hash(data: data)
	return hash.map { String(format: "%02x", $0) }.joined()
}

/// 校验 checksums.json 中列出的文件。拒绝 relPath 含 ".." 或为绝对路径。
func verifyIntegrity(root: String, checksumsPath: String) -> Bool {
	guard let data = try? Data(contentsOf: URL(fileURLWithPath: checksumsPath)) else {
		fputs("asd: 无法读取 checksums.json\n", stderr)
		return false
	}
	guard let json = try? JSONSerialization.jsonObject(with: data),
	      let entries = json as? [String: String] else {
		fputs("asd: checksums.json 格式无效\n", stderr)
		return false
	}
	let rootNorm = (root as NSString).standardizingPath
	for (relPath, expectedHex) in entries {
		if relPath.hasPrefix("/") || relPath.contains("..") {
			fputs("asd: 校验拒绝非法路径: \(relPath)\n", stderr)
			return false
		}
		let fullPath = (root as NSString).appendingPathComponent(relPath)
		let fullNorm = (fullPath as NSString).standardizingPath
		let rootSlash = rootNorm.hasSuffix("/") ? rootNorm : rootNorm + "/"
		guard fullNorm == rootNorm || fullNorm.hasPrefix(rootSlash) else {
			fputs("asd: 校验拒绝路径逃逸: \(relPath)\n", stderr)
			return false
		}
		guard let actualHex = sha256Hex(filePath: fullPath) else {
			fputs("asd: 完整性校验失败: \(relPath)\n", stderr)
			return false
		}
		if actualHex.lowercased() != expectedHex.lowercased() {
			fputs("asd: 完整性校验失败: \(relPath)\n", stderr)
			return false
		}
	}
	return true
}

/// 执行 node bin/asnip.js [args...]，将调用时的 cwd 传入 ASD_CWD，校验通过则设 ASD_VERIFIED=1。
/// 收到 SIGINT/SIGTERM 时转发给子进程，避免 asd ui 按 Ctrl+C 后 Node 未退出导致 3000 端口被占用。
func spawnNode(root: String, integrityVerified: Bool) -> Int32 {
	let asnipPath = (root as NSString).appendingPathComponent("bin/asnip.js")
	guard FileManager.default.fileExists(atPath: asnipPath) else {
		fail("asd: 未找到 bin/asnip.js")
	}
	let nodeArgs = ["node", asnipPath] + Array(CommandLine.arguments.dropFirst())
	let process = Process()
	process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
	process.arguments = nodeArgs
	process.currentDirectoryURL = URL(fileURLWithPath: root)
	var env = ProcessInfo.processInfo.environment
	env["ASD_CWD"] = FileManager.default.currentDirectoryPath
	if integrityVerified {
		env["ASD_VERIFIED"] = "1"
	}
	process.environment = env
	process.standardInput = FileHandle.standardInput
	process.standardOutput = FileHandle.standardOutput
	process.standardError = FileHandle.standardError
	do {
		try process.run()
		// 转发 SIGINT/SIGTERM 给子进程，避免 Ctrl+C 后仅 asd-verify 退出、Node 成为孤儿占用端口
		signal(SIGINT, SIG_IGN)
		signal(SIGTERM, SIG_IGN)
		let queue = DispatchQueue.main
		let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: queue)
		let sigtermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: queue)
		sigintSource.setEventHandler { process.terminate() }
		sigtermSource.setEventHandler { process.terminate() }
		sigintSource.resume()
		sigtermSource.resume()
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
var integrityVerified = false
if FileManager.default.fileExists(atPath: checksumsPath) {
	if !verifyIntegrity(root: root, checksumsPath: checksumsPath) {
		exit(1)
	}
	integrityVerified = true
}

exit(spawnNode(root: root, integrityVerified: integrityVerified))
