# Changelog

本文档记录 AutoSnippet 的版本变更，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

---

## [1.5.4] - 2025-02-02

### 新增

- **asd status 增强**：Dashboard 未运行时明确提示「as:create、as:guard、as:search 保存后不会触发」；新增「下一步建议」汇总，根据当前状态给出具体操作建议。
- **asd setup 引导**：setup 完成后输出下一步建议（asd ui、.env、embed、install:cursor-skill）。
- **as:search / Guard 无结果通知**：macOS 上无匹配时弹出系统通知，避免用户漏看终端输出。
- **检索 language filter**：`// as:search` 根据当前文件扩展名（.m/.h→objc、.swift→swift）自动过滤 Recipe；索引时从 Recipe frontmatter 写入 category、language 到 metadata。

### 变更

- **IndexingPipeline**：Recipe 索引时解析 frontmatter，写入 category、language 到 chunk metadata。
- **searchService**：semanticSearch 支持 options.filter（language、category）；关键词搜索回退时不受 filter 影响。
- **JsonAdapter / LanceAdapter**：_applyFilter 支持 language、category；language 支持 objc/objectivec 别名。
- **parseRecipeMd**：导出 parseFrontmatter 供 IndexingPipeline 使用。

---

## [1.5.3] - 2025-02-02

### 新增

- **候选 vs Recipe 对比弹窗**：删除候选、审核候选、审核 Recipe 操作；复制候选/Recipe 内容；快速切换相似 Recipe（top3 标签）；候选格式与 Recipe 一致（Snippet / Code Reference + AI Context / Usage Guide）。
- **审核页相似度**：SPM 审核页（深度扫描、当前页进入审核）支持相似 Recipe 展示与对比；深度扫描结果（无 candidateId）也可计算相似度。
- **相似度 API**：`POST /api/candidates/similarity` 支持 `candidate` 对象入参，用于无 candidateId 的项。

### 变更

- **对比弹窗**：加宽至 95vw/1600px；Recipe 侧移除 frontmatter 元数据展示；CSS Grid 实现左右 header 等高、Snippet / Code Reference 对齐。
- **CodeBlock**：增加 `objective-c`、`obj-c` 语言映射，修复 Cursor 批量候选高亮。
- **Guard 页**：移除前置条件提示条。
- **质量分**：候选质量分仅用于排序，不再展示。

---

## [1.5.2] - 2025-02-01

### 新增

- **Guard 页面**：增加「提交误报/建议」入口，链接到 GitHub Issues 预填标题，便于反馈误报或规则建议。
- **文档**：新增 [Guard-误报与排除策略](docs/Guard-误报与排除策略.md)，汇总误报场景、排除策略与 Knowledge 目录说明；文档内增加前置条件说明。
- **使用文档**：增加前置条件小节（环境、项目根、watch/ui、Dashboard/MCP）；文档索引补充 Guard-误报与排除策略。
- **CHANGELOG**：新增本文件。

### 变更

- **Guard 规则**：block 循环引用排除扩展为枚举（`enumerateObjectsUsingBlock:` 等）、`performWithoutAnimation:`、`addOperationWithBlock:`；init 检查支持委托初始化 `[self initWith...]`；Swift ui-off-main 规则移除对 `DispatchQueue.main.async` 的误报。
- **Guard 页**：增加前置条件提示条（需 `asd ui`、违反记录由 `// as:guard` 触发）。
- **asnip setup**：成功提示文案由「AutoSnippet.boxspec.json」改为「AutoSnippetRoot.boxspec.json」，与实际文件名一致。

### 文档

- 补全 [context 配置说明](docs/context配置说明.md)、[MCP 配置说明](docs/MCP配置说明.md)，消除文档索引死链。
- 文档索引中移除不存在的 `guard-checks-catalog.json` 条目，规则示例改为指向 Dashboard Guard 页或 `Knowledge/.autosnippet/guard-rules.json`。

### 修复

- **LanceDB 适配器**：where/delete 谓词使用 `"id"` 导致查询与删除失效；改为 `id = '...'`（列名不加双引号）以符合 LanceDB/DataFusion SQL 语法，修复 getById、searchByFilter、remove。

### 新增（候选质量与相似度）

- **质量评估**：`lib/candidate/qualityRules.js` 对候选打分，仅用于 Candidates 列表排序（高分靠前），不展示。
- **相似度分析**：`lib/candidate/similarityService.js` 基于向量检索；Dashboard Candidates 展开时展示相似 Recipe，点击可打开双栏对比弹窗（候选 vs Recipe）。
- **API**：`POST /api/candidates/similarity`、`GET /api/recipes/get?name=xxx`。

历史变更未在此逐条列出，可参考 Git 提交记录与各版本 Release 说明。
