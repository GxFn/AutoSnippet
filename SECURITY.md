# 安全说明

## Postinstall 脚本

`npm install` 会执行 `postinstall` 中的**可选**脚本：

- `scripts/postinstall-safe.js` — 入口脚本，按需调用以下构建：
  - Swift 解析器构建（仅当 `ASD_BUILD_SWIFT_PARSER=1` 时）
  - `scripts/build-native-ui.js` — 仅在 macOS 上本地编译 `resources/native-ui/main.swift`
  - `scripts/build-asd-entry.js` — 仅在 macOS 上本地编译 `resources/asd-entry/main.swift`

所有脚本均为本包内源码、本地构建，不拉取外部资源、不执行 `eval` 或用户输入。未安装或跳过不影响核心功能。

详见 [README#Postinstall 脚本说明](./README.md#postinstall-脚本说明npm-install-时)。

## 报告问题

若发现安全问题，请通过 GitHub Issues 或私下联系维护者。
