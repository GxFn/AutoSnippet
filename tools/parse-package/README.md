# ParsePackage

Swift 全解析器：解析 `Package.swift`，通过 STDIO JSON 与 Node 侧 `swiftParserClient.js` 通信。

## 依赖

- Swift 5.9+
- [swift-syntax](https://github.com/swiftlang/swift-syntax)（SPM 自动拉取）

## 构建

```bash
cd tools/parse-package
swift build -c release
```

产物路径：`.build/release/ParsePackage`。首次构建会拉取并编译 swift-syntax，约需数分钟。

## 使用

由 Node 侧按协议调用，无需单独运行。调用方：`lib/service/spm/PackageSwiftParser.js`。

- **输入**（stdin 一行 JSON）：`{ "schemaVersion": 1, "command": "parsePackage", "packageSwiftPath": "/abs/path/to/Package.swift", "options": { ... } }`
- **输出**（stdout 一行 JSON）：`{ "schemaVersion": 1, "ok": true, "package": { "name", "packageDir", "targets": [ { "name", "path", "sources", "dependencies": [ { "kind", "name", "package?" } ] } ] } }`

## 启用方式

在项目根目录 `.env` 中设置（可选）：

- `ASD_SWIFT_PARSER_BIN`：指向可执行文件路径（如 `tools/parse-package/.build/release/ParsePackage` 或绝对路径）
- 未设置时，Node 会尝试 `tools/parse-package/.build/release/ParsePackage`；若不存在则回退 AST-lite。
