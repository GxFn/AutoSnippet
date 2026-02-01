# 安全说明

## Postinstall 脚本

自 1.4.3 起，`npm install` 会执行 `postinstall` 中的两个**可选**脚本：

- `scripts/ensure-parse-package.js` — 仅当 `ASD_BUILD_SWIFT_PARSER=1` 时构建 Swift 解析器；否则打印跳过说明并退出。
- `scripts/build-native-ui.js` — 仅在 macOS 上本地编译 `resources/native-ui/main.swift`，无网络、无动态执行。

二者均为本包内源码、本地构建，不拉取外部资源、不执行 `eval` 或用户输入。未安装或跳过不影响核心功能。

详见 [README#Postinstall 脚本说明](./README.md#postinstall-脚本说明npm-install-时)。

## 报告问题

若发现安全问题，请通过 GitHub Issues 或私下联系维护者。
