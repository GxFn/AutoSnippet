#!/usr/bin/env swift
/*
 * AutoSnippet 完整性校验入口（Swift，仅 macOS）
 * 读 checksums.json，校验关键文件 SHA-256，通过则设置 ASD_VERIFIED=1 并 spawn node bin/asd-cli.js。
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
/// 根据环境变量决定是否打印详细信息（开发者模式）。
func verifyIntegrity(root: String, checksumsPath: String, debugMode: Bool) -> Bool {
	guard let data = try? Data(contentsOf: URL(fileURLWithPath: checksumsPath)) else {
		if debugMode {
			fputs("asd: 无法读取 checksums.json\n", stderr)
		}
		return false
	}
	guard let json = try? JSONSerialization.jsonObject(with: data),
	      let entries = json as? [String: String] else {
		if debugMode {
			fputs("asd: checksums.json 格式无效\n", stderr)
		}
		return false
	}
	let rootNorm = (root as NSString).standardizingPath
	for (relPath, expectedHex) in entries {
		if relPath.hasPrefix("/") || relPath.contains("..") {
			if debugMode {
				fputs("asd: 校验拒绝非法路径: \(relPath)\n", stderr)
			}
			return false
		}
		let fullPath = (root as NSString).appendingPathComponent(relPath)
		let fullNorm = (fullPath as NSString).standardizingPath
		let rootSlash = rootNorm.hasSuffix("/") ? rootNorm : rootNorm + "/"
		guard fullNorm == rootNorm || fullNorm.hasPrefix(rootSlash) else {
			if debugMode {
				fputs("asd: 校验拒绝路径逃逸: \(relPath)\n", stderr)
			}
			return false
		}
		guard let actualHex = sha256Hex(filePath: fullPath) else {
			if debugMode {
				fputs("asd: 完整性校验失败: \(relPath)\n", stderr)
			} else {
				fputs("asd: 完整性校验失败\n", stderr)
			}
			return false
		}
		if actualHex.lowercased() != expectedHex.lowercased() {
			if debugMode {
				fputs("asd: 完整性校验失败: \(relPath)\n", stderr)
			} else {
				fputs("asd: 完整性校验失败\n", stderr)
			}
			return false
		}
	}
	return true
}

/// 执行 node bin/asd-cli.js [args...]，将调用时的 cwd 传入 ASD_CWD，校验通过则设 ASD_VERIFIED=1。
/// 收到 SIGINT/SIGTERM 时转发给子进程，避免 asd ui 按 Ctrl+C 后 Node 未退出导致 3000 端口被占用。
func spawnNode(root: String, integrityVerified: Bool) -> Int32 {
	let asnipPath = (root as NSString).appendingPathComponent("bin/asd-cli.js")
	guard FileManager.default.fileExists(atPath: asnipPath) else {
		fail("asd: 未找到 bin/asd-cli.js")
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
// 使用环境变量 ASD_SKIP_CHECKSUMS=1 可跳过完整性校验（仅限开发者模式）
// 使用环境变量 ASD_DEBUG=1 可打印详细校验信息

let skipChecksums = ProcessInfo.processInfo.environment["ASD_SKIP_CHECKSUMS"] == "1"
let debugMode = ProcessInfo.processInfo.environment["ASD_DEBUG"] == "1"

guard let root = getPackageRoot() else {
	fail("asd: 无法解析包根目录")
}

let checksumsPath = (root as NSString).appendingPathComponent("checksums.json")
var integrityVerified = false

// 如果开发者模式跳过校验，直接启动 Node
if skipChecksums {
	if debugMode {
		fputs("asd: 开发者模式，跳过完整性校验\n", stderr)
	}
	integrityVerified = false
} else if FileManager.default.fileExists(atPath: checksumsPath) {
	if !verifyIntegrity(root: root, checksumsPath: checksumsPath, debugMode: debugMode) {
		exit(1)
	}
	integrityVerified = true
}

exit(spawnNode(root: root, integrityVerified: integrityVerified))
