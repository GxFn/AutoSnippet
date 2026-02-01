# Native UI Helper (macOS)

为 AutoSnippet 提供高级原生弹窗交互，解决 Xcode 无内置终端的问题。

## 构建

```bash
npm run build:native-ui
# 或
swiftc resources/native-ui/main.swift -o resources/native-ui/native-ui -framework AppKit
```

`asd install:full` 在 macOS 上会自动构建。

## 用法

```bash
# 列表选择（返回选中的索引，stdout 输出 0-based 数字）
./resources/native-ui/native-ui list "选项1" "选项2" "选项3"

# 预览确认（展示代码块，用户确认后 exit 0）
./resources/native-ui/native-ui preview "标题" "代码内容"
```

## 集成

- `lib/infra/nativeUi.js` 默认优先使用 Swift Helper 高级弹窗
- 未构建时回退到 AppleScript (`osascript`) 或 `inquirer`，并提示 `npm run build:native-ui`
- 强制使用 AppleScript（如弹窗无响应时）：`ASD_USE_APPLESCRIPT=1`
