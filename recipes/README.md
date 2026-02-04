# AutoSnippet Recipe（配方）规范（2026 升级版）

AutoSnippet Recipe 使用 **Markdown + YAML Frontmatter** 格式存储。这种格式既方便人类阅读和编辑，也便于 AI 解析和工具链处理。最新规范强调 **统一结构**、**可批量解析** 与 **可审计引用**。

## 目录结构

Recipes 存放在项目根目录下的 `Knowledge/recipes/` 文件夹中，建议按模块或功能划分子目录：

```
Knowledge/recipes/
├── README.md
├── BDNetworkControl/
│   └── RequestTemplate.md
└── Foundation/
    └── KVC-Safety.md
```

## 文件格式标准

每个 `.md` 文件必须包含 **完整 Recipe 结构**：

1. **Frontmatter**（`---` 包裹的 YAML，`title`、`trigger` 必填）
2. **## Snippet / Code Reference**（下接代码块）
3. **## AI Context / Usage Guide**（使用说明）

> 当内容已是完整 Recipe Markdown（含以上三段），系统可直接解析入库，无需 AI 重写。

### Frontmatter 字段说明

| 字段 | 类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `id` | String | 唯一标识符（建议使用反向域名格式） | `com.bilibili.network.request` |
| `title` | String | 标题 | `基础网络请求模板` |
| `language` | String | 编程语言 (`swift`, `objectivec`) | `swift` |
| `trigger` | String | Xcode 触发词 | `@request` |
| `tags` | Array | 标签，用于分类和搜索 | `[network, template]` |
| `summary` | String | 简短摘要 | `标准化的网络请求封装` |
| `category` | String | **分类（必须使用标准值）**：`View` / `Service` / `Tool` / `Model` / `Network` / `Storage` / `UI` / `Utility` | `Network` |
| `headers` | Array | **完整的 import/include 语句**（Swift: `import Xxx`; ObjC: `#import <Xxx/Yyy.h>`） | `["#import <BDUtils/BDUtils.h>"]` |
| `deps` | Object | 依赖关系（可选） | `{ "targets": ["BDNetworkControl"], "imports": ["BDNetworkControl"] }` |
| `author` | String | 作者（可选） | `gaoxuefeng` |
| `updatedAt` | Number | 最后更新时间戳 | `1706515200` |

### 正文内容

正文分为两个核心区块：

1.  **Snippet / Code Reference**：使用标准 Markdown 代码块包裹的代码片段。
2.  **AI Context / Usage Guide**：对该片段的深度解释、适用场景、注意事项等，供 AI 检索和生成。

### 多段 Recipe（批量解析）

在同一文本中可包含多段 Recipe：使用「空行 + `---` + 下一段 Frontmatter」分隔。解析器仅在检测到 **换行 + `---` + 换行 + frontmatter 键** 时拆分，避免误判代码块中的 `---`。

## 示例文件

```markdown
---
id: com.bilibili.foundation.kvc-safe
title: KVC 安全访问封装
language: objectivec
trigger: @kvcsave
tags: [foundation, safety]
summary: 防止 KVC 访问不存在的 Key 导致 Crash
category: Foundation
headers: ["#import <BDUtils/BDUtils.h>"]
deps:
  imports: ["BDUtils"]
updatedAt: 1706515200
---

## Snippet / Code Reference

```objectivec
@try {
    [self setValue:value forKey:key];
} @catch (NSException *exception) {
    NSLog(@"KVC Error: %@", exception);
}
```

## AI Context / Usage Guide

### 适用场景
- 当处理来自服务端动态下发的字典并尝试通过 KVC 绑定模型时使用。
- 尤其适用于那些可能包含未知字段或字段名变动频繁的业务模块。

### 约束与建议
- 不要滥用 @try-catch，仅在 Key 不确定时使用。
- 建议配合 `BDUtils` 中的 `validateValue:forKey:error:` 一起使用。
```
