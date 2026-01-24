# AutoSnippet

基于 SPM 的 iOS 模块 Snippet 工具。通过 AutoSnippet 可以把模块的使用示范写进 Xcode 的 CodeSnippets，并支持分类检索、链接跳转与（可选）依赖头文件注入。

[![npm version](https://img.shields.io/npm/v/autosnippet.svg?style=flat-square)](https://www.npmjs.com/package/autosnippet)
[![npm downloads](https://img.shields.io/npm/dm/autosnippet.svg?style=flat-square)](https://www.npmjs.com/package/autosnippet)
[![npm total downloads](https://img.shields.io/npm/dt/autosnippet.svg?style=flat-square)](https://www.npmjs.com/package/autosnippet)
[![GitHub stars](https://img.shields.io/github/stars/GxFn/AutoSnippet.svg?style=flat-square)](https://github.com/GxFn/AutoSnippet)
[![GitHub forks](https://img.shields.io/github/forks/GxFn/AutoSnippet.svg?style=flat-square)](https://github.com/GxFn/AutoSnippet)
[![License](https://img.shields.io/npm/l/autosnippet.svg?style=flat-square)](https://github.com/GxFn/AutoSnippet/blob/main/LICENSE)

## 使用

模块开发者提供了Toast模块，可以将这一段使用代码写入模块的配置文件（参照下文命令）

```objectivec
[[ASUIKitAlertToast sharedInstance] alertWithMessage:@"<#object#>"];
```

模块被工程引入时，业务开发者可以在Xcode里，敲击`@toast`来获取这段标准的使用代码

Toast模块添加配置时可以选择分类，使用者可以通过`@view`或者`@tool`联想出同类别模块列表

代码量大的UI模块，能一键获取全部标准代码

## 安装

```bash
$ npm install -g autosnippet
```

## 快速开始

建议在**项目根目录**执行（能找到 `AutoSnippetRoot.boxspec.json`）。

```bash
# 1) 一键初始化（等价于 init + root）
asd setup

# 2) 在代码里用新标记圈出 snippet 内容，然后创建
asd create

# 3) 安装到 Xcode CodeSnippets
asd install

# 4) 开启监听（用于头文件注入/依赖补齐/ALink 跳转）
asd watch
```

## 全局选项（推荐）

- **`--preset <path>`**：指定预置输入（非交互/自动化最常用）。
- **`--yes`**：非交互模式；缺少必要输入会直接报错退出。

也支持环境变量（方便 CI / 测试脚本）：

- **`ASD_PRESET` / `ASD_TEST_PRESET`**：预置输入 json 路径（优先级低于 `--preset`）

## 命令

请在当前 Xcode 项目文件目录下使用以下所有命令。

### root

在 Xcode 项目的根目录执行此命令以创建工作空间：

```bash
$ asd root
```

创建工作空间时，会将子工作空间的 Snippet 配置信息收集到当前工作空间。

### init

在 Xcode 项目的spm模块目录执行此命令以创建模块工作空间：

```bash
$ asd init
```

### setup（推荐）

初始化快捷命令，等价于 `asd init` + `asd root`：

```bash
$ asd setup
```

### create

创建 Xcode 代码片段（支持从文件标记提取，或直接从剪贴板生成）。

```bash
$ asd create
# 或短别名
$ asd c
```

#### 从文件标记提取

在任意 `.m/.h/.swift` 文件中使用标记圈出代码块（推荐短写法）：

```
// as:code
UIView *view = [[UIView alloc] init];
// as:code
```

然后在该文件所在目录（或通过 preset 指定文件）执行 `asd create`。

#### 从剪贴板创建

```bash
# 默认按 objc 处理
asd create --clipboard

# 短写法
asd c -p

# Swift
asd create --clipboard --lang swift
```

### install

将共享的代码片段添加到 Xcode 环境：

```bash
$ asd install
# 或短别名
$ asd i
```

使用代码片段示例：

```
// view 是创建时输入的代码键
@view 
```

### share

共享本地代码片段：

```bash
$ asd share
# 或短别名
$ asd s
```

### update

更新已创建的 snippet（按 trigger 查找，例如 `cover` 或 `@cover`）：

```bash
asd update <word> [key] [value]
# 或短别名
asd u <word> [key] [value]
```

### watch

在模块化项目中监听文件变更，识别 `autosnippet:*` 指令并执行：
- 头文件注入（ObjC `#import` / Swift `import`）
- ALink 跳转
-（可选）SPM 依赖自动补齐（见下文）

```bash
$ asd watch
# 或短别名
$ asd w
```

常用参数：

```bash
# 只监听某个子目录/文件/后缀
asd watch --path Services/Services/ASNetworkCheck --ext m,h
asd watch --file ./Services/Services/ASNetworkCheck/Code/ASSimplePing.m

# 降噪/退出时打印汇总
asd watch --quiet --summary
```

#### 追加头文件

开启监听后，如果想要追加头文件，请执行以下操作：

1. 向下箭头选择代码片段的 headerVersion
2. 按 `Enter` 键
3. `Command + S` 保存文件

在 1 秒内，头文件会自动添加到文件头部。

#### 新指令格式（重要）

- ObjC / C / C++：注入头文件

```
// as:include <ModuleName/Header.h> [optional/relative/path/Header.h]
```

- Swift：注入 import

```
// as:import ModuleName
```

#### 浏览器查看

开启监听后，如果想要在浏览器中查看模块的更多信息，请执行以下操作：

1. 输入 `@` 和 `模块键`
2. 输入 `#` 和 `ALink`
3. `Command + S` 保存文件

会自动跳转到浏览器打开创建时配置的链接，如果没有链接则打开 README.md 文件。

使用 ALink 示例：

```
@view#ALink
```

## SPM 依赖自动补齐（可选）

当 `watch` 触发跨 target 引用时，AutoSnippet 可以（按配置）检查/补齐 `Package.swift` 里的依赖关系（target / product / package）。

- 开关：通过环境变量控制
  - **`ASD_FIX_SPM_DEPS_MODE=off`**：只提示（默认行为）
  - **`ASD_FIX_SPM_DEPS_MODE=suggest`**：输出可复制的补丁建议
  - **`ASD_FIX_SPM_DEPS_MODE=fix`**：直接修改 `Package.swift` 自动补齐

- 跨包 product/package 依赖需要映射文件（项目内维护）：
  - `AutoSnippet.spmmap.json`

## 其他

### 占位符快捷键

您也可以在代码片段中添加占位符，使用以下标签：

```
<#placeholder#>
```

例如：上面的占位符可以写成：

```
<#view: UIView#>
```

Xcode 会检测 `<#` 和 `#>` 标记，并将它们之间的文本作为占位符。我们可以通过按 `Tab` 键在多个占位符之间切换。

当有多个相同的占位符时，使用 `⌥⌘E` 连续选择多个占位符：

1. 选择一个占位符
2. `⌥⌘E` 选择下一个占位符，`⌥⇧⌘E` 选择上一个占位符
3. 输入修改的内容，所有选中的占位符都会被修改

## 📝 贡献

欢迎提交 Issues 和 Pull Requests 来帮助改进 AutoSnippet！

## 📄 许可证

本项目采用 MIT 许可证。详情请参阅 [LICENSE](LICENSE) 文件。