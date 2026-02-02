# Changelog

本文档记录 AutoSnippet 的版本变更，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

---

## [1.5.8] - 2025-02-02

### 变更

- 版本号更新至 1.5.8。

---

## [1.5.7] - 2025-02-02

### 新增

- **Recipe 保存频率限制**：按「项目根 + 客户端 IP」固定窗口限流，防止短时间内多次保存；超限返回 429，前端提示「保存过于频繁，请稍后再试」。配置：`ASD_RECIPE_SAVE_RATE_LIMIT`（默认 20）、`ASD_RECIPE_SAVE_RATE_WINDOW_SECONDS`（默认 60），设为 0 表示不限制。
- **Recipe 保存防重复点击**：编辑 Recipe 弹窗「Save Changes」、SPM 审核页「保存为 Recipe」、对比弹窗「审核候选」在请求进行中禁用按钮并显示「保存中...」，避免重复提交。
- **完整性校验入口（Swift）**：原生入口为 Swift 实现（`resources/asd-entry/main.swift`），仅 macOS 构建为 `bin/asd-verify`；使用 CryptoKit 做 SHA-256 校验。`bin/asd` 优先执行 `asd-verify`，不存在则回退 `node bin/asnip.js`。项目仅在 macOS 运行，故保留 Swift 入口。

### 文档

- **提交前检查清单**：`docs/提交前检查清单.md`，用于发布前自检。
- **权限设置说明重写**：精简为「写权限探针、频率控制、完整性校验」配置与行为；明确探针目的为「保证管理员能够正确提交 Recipe」；适用场景改为「Recipe 上传由 Git 服务端权限拦截」。
- **README / 权限表述**：Knowledge 与 Git 小节强调上传由 Git 拦截；`ASD_RECIPES_WRITE_DIR` 表述为「保证管理员能够正确提交 Recipe」。
- **context 配置说明**：新增「为什么 .autosnippet 里有两个 vector_index.json」「manifest.json 有什么用处」两节。

### 测试

- **完整性入口校验**：`test/unit/checksums-verify.test.js` 新增 `testEntryCheck()`，覆盖存在 checksums 时「无 ASD_VERIFIED 警告且 exit 0」「ASD_STRICT_ENTRY=1 拒跑」「ASD_VERIFIED/ASD_SKIP 无警告」四种场景。

---

## [1.5.6] - 2025-02-02

### 新增

- **写权限探针（阶段一）**：保存/删除 Recipe、保存/删除 Snippet 前在配置的探针目录（如子仓库 `auth-data`）执行 `git push --dry-run`，非零退出则返回 403（`RECIPE_WRITE_FORBIDDEN`）；探针通过后仍写主项目原路径。配置：`ASD_RECIPES_WRITE_DIR` 或 rootSpec `recipes.writeDir`，未设则不启用；`ASD_PROBE_TTL_SECONDS` 默认 24h，进程内缓存。
- **完整性校验（阶段二）**：`bin/asd` 优先执行原生入口 `bin/asd-verify`（Swift），存在 `checksums.json` 时对关键文件做 SHA-256 校验，不通过则 exit(1)，通过则 spawn `node bin/asnip.js`；无 checksums 或未构建 asd-verify 时回退到 `node bin/asnip.js`。发布前 `prepublishOnly` 自动生成 `checksums.json`。
- **Node 校验脚本**：`npm run verify-checksums` 复现 Swift 校验逻辑（无 Swift 环境/CI 可用）；拒绝 `..`、绝对路径与路径逃逸。
- **单元测试**：`test/unit/checksums-verify.test.js` 覆盖合法清单通过、错误哈希/无效 JSON/路径逃逸/缺失文件失败；已加入 `test/unit/run-all.js`。

### 文档

- **安全等级说明**：BiliDemo/docs 下新增 `AutoSnippet-安全等级说明.md`（防护范围、不防护、适用场景）；实现清单小结增加安全等级与文档引用。

---

## [1.5.5] - 2025-02-02

### 修复

- **asd status AI 配置**：getConfigSync 正确解析并返回 hasKey，修复「未配置 API Key」误报。
- **asd status 语义索引**：检测路径改为 `context/index/vector_index.json`、`context/index/lancedb/`、`manifest.json`，修复 embed 后仍提示「未构建」。
- **asd status Dashboard**：未运行时使用 ℹ️ 而非 ❌，文案为「需时请执行 asd ui」，属于正常情况。

### 变更

- **移除 bin/native-ui**：仅保留 `resources/native-ui/native-ui`（由 build 生成），bin/native-ui 为冗余且未被引用。

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
