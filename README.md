# AutoSnippet

基于SPM的iOS模块管理工具。通过AutoSnippet可以将模块的使用示范写进Xcode的配置文件，支持分类查询和头文件引入。

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

## 命令选项

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

### create

创建 Xcode 代码片段的命令，在标记有 `// ACode` 代码的文件目录中：

```bash
$ asd c
```

代码示例：

```
// ACode
UIView *view = [[UIView alloc] init];
// ACode
```

### install

将共享的代码片段添加到 Xcode 环境：

```bash
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
$ asd s
```

### watch

在模块化项目中，识别代码片段并自动注入依赖头文件：

```bash
$ asd w
```

#### 追加头文件

开启监听后，如果想要追加头文件，请执行以下操作：

1. 向下箭头选择代码片段的 headerVersion
2. 按 `Enter` 键
3. `Command + S` 保存文件

在 1 秒内，头文件会自动添加到文件头部。

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