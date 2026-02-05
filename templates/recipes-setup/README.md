# AutoSnippet Recipe 格式说明（知识库与 AI Memory 对齐）

Recipe 是 AutoSnippet **语义记忆（Semantic Memory）** 的载体：以「代码片段 + 使用说明 + 语义元数据」的形式进入知识库，供 **检索（Search）**、**Guard（Lint）**、**代码生成（Generate）** 等能力使用。  
文档与设计详见：`copilotDocs/AI-Memory-Knowledge-Base-Architecture.md`、`Recipe管理与AI知识库优化.md`。

---

## 存放位置

- 项目内：**AutoSnippet/recipes/**（或由 boxspec 指定的知识库目录下的 `recipes/`）。
- 建议按模块或功能划分子目录，便于管理与检索过滤。

---

## 文件格式（必读）

每个 `.md` 文件须包含 **三段**，系统方可直接解析入库（无需 AI 重写）：

1. **Frontmatter**：`---` 包裹的 YAML，**title**、**trigger** 必填；其余字段用于 AI 检索、多信号排序与知识关联。
2. **## Snippet / Code Reference**：下一行起用 Markdown 代码块写出可引用/可运行的代码片段。
3. **## AI Context / Usage Guide**：适用场景、何时不用、使用步骤、最佳实践等，供 AI 与人类阅读。

---

## Frontmatter 字段（与架构对齐）

### 必填字段（7 个）

| 字段 | 类型 | 说明 | 格式要求 |
|------|------|------|----------|
| `title` | string | 标题（英文名，单行） | ≤50 字，建议动词开头 |
| `trigger` | string | 触发词 | **MUST** 以 `@` 开头，小写+下划线，无空格 |
| `category` | string | **分类（MUST 为 8 个标准值之一）** | `View`, `Service`, `Tool`, `Model`, `Network`, `Storage`, `UI`, `Utility` |
| `language` | string | 编程语言 | `swift` 或 `objectivec` |
| `summary_cn` | string | 中文概述 | ≤100 字 |
| `summary_en` | string | 英文概述 | ≤100 words |
| `headers` | array | **完整 import/include 语句** | Swift: `["import Foundation"]`<br/>ObjC: `["#import <UIKit/UIKit.h>"]` |

### 可选字段（强烈推荐）

| 字段 | 类型 | 说明 | AI 用途 |
|------|------|------|--------|
| `keywords` | array | 关键词列表，如 `["网络请求", "async", "缓存"]` | BM25/关键词搜索 |
| `whenToUse` | string 或 array | 何时应使用此 Recipe（场景列表） | 场景匹配、意图理解 |
| `whenNotToUse` | string 或 array | 何时不应使用（排除场景） | 负向过滤、避免误推荐 |
| `difficulty` | string | 难度：`beginner` / `intermediate` / `advanced` | 难度匹配、学习路径 |
| `authority` | number | 权威分 1～5 | 多信号排序 |
| `relatedRecipes` | array | 关联 Recipe 的 trigger，如 `["@error_handling"]` | 知识图谱、推荐 |
| `version` | string | 版本号，如 `"1.0.0"` | 版本追踪 |
| `updatedAt` | number | 最后更新时间戳 | 新鲜度 |
| `author` | string | 作者或团队名 | 归属信息 |
| `deprecated` | boolean | 是否已过时 | 过滤过时内容 |

### 扩展字段（可选）

| 字段 | 类型 | 说明 |
|------|------|------|
| `tags` | array | 标签，如 `[production-ready, guard-rule]` |
| `deps` | object | 依赖：`targets`、`imports` 等 |
| `alternatives` | string 或 array | 替代方案说明或其它 Recipe 的 trigger |
| `quality` | object | 质量信号：如 `codeReviewStatus`、`hasUnitTest` |
| `performance` | object | 性能：如 `timeComplexity`、`spaceComplexity` |
| `security` | object | 安全：如 `riskLevel`、`bestPractices` |
| `deprecationReason` | string | 过时原因（配合 `deprecated: true` 使用） |
| `replacedBy` | string | 替代 Recipe 的 trigger（配合 `deprecated: true` 使用） |

---

## 正文：AI Context / Usage Guide 建议结构

为便于 AI 与人类一致理解，Usage Guide 建议包含（可酌情删减）：

- **什么时候用**：3～5 条适用场景。
- **何时不用**：2～3 条排除场景（负向说明对检索很重要）。
- **使用步骤**：简要步骤或调用方式。
- **关键点 / 注意事项**：易错点、线程/内存等约束。
- **最佳实践**：推荐做法与反例（❌ 不要…）。
- **替代方案**：与其它 Recipe 或方案的对比（可与 frontmatter 的 `alternatives` 呼应）。

---

## Recipe 生命周期（简要）

- **Draft**：编写、自测，可先不发布。
- **Review**：Guard/人工检查，更新权威分与质量信号。
- **Published**：进入知识库，参与检索与排序。
- **Maintenance**：根据使用反馈、依赖与最佳实践演进更新。
- **Deprecated**：标记过时并填写 `replacedBy`，保留供历史查询。

---

## 参考文件

- **example.md**：包含扩展 frontmatter 与完整 Usage Guide 结构的标准示例（Swift 网络请求）。
- **_template.md**：空白模板，复制后改名、填空即可新建 Recipe。

---

## 延伸阅读

- `copilotDocs/AI-Memory-Knowledge-Base-Architecture.md` — AI Memory 类型、知识库架构、Recipe 元数据与检索排序。
- `copilotDocs/Recipe管理与AI知识库优化.md` — Recipe 对 AI 最优化的字段设计、检索场景与编写规范。
