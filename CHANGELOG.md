# Changelog

本文档记录 AutoSnippet 的版本变更，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

---

## [1.7.0] - 2026-02-05

### 重大改进

- **Recipe 标准化（7 个必填字段）**：
  - `title`, `trigger`, `category`, `language`, `summary_cn`, `summary_en`, `headers` 为必填
  - Category 限定为 8 个标准值（View/Service/Tool/Model/Network/Storage/UI/Utility）
  - headers 必须为完整 import/include 语句数组
  - 更新所有模板和文档以反映新标准

- **MCP 服务器增强**：
  - 统一 JSON Envelope 格式（`{ success, errorCode, message, data, meta }`）
  - 新增工具：`autosnippet_health`, `autosnippet_capabilities`, `autosnippet_context_analyze`, `autosnippet_validate_candidate`, `autosnippet_check_duplicate`, `autosnippet_get_target_metadata`
  - 完整的 20+ 错误码支持（SEARCH_FAILED、RATE_LIMIT、ELICIT_FAILED 等）
  - 鉴权支持（ASD_MCP_TOKEN）
  - 限流保护（提交频率控制）
  - OpenAI Provider 支持 Target 类型检测与专用提示


### 新增

- **候选管理增强**：
  - 候选去重与聚合功能（`aggregateCandidates`）
  - 候选校验模块（`validateRecipeCandidate`）
  - 支持 intro-only Recipe（纯介绍无代码）
  - 草稿提交流程增强（自动校验、去重、限流）

- **Skills 重组（v2.0）**：
  - 新增 `autosnippet-intent`（路由 Skill，替代 autosnippet-when）
  - 新增 `autosnippet-structure`（结构发现，替代 autosnippet-dep-graph）
  - 新增 `autosnippet-candidates`（统一候选生成，合并 autosnippet-batch-scan 和 autosnippet-recipe-candidates）
  - 所有 Skills 添加自检与回退指导
  - 弃用标记：autosnippet-when, autosnippet-search, autosnippet-batch-scan, autosnippet-recipe-candidates, autosnippet-dep-graph

- **诊断与审计工具**：
  - `npm run diagnose:mcp`：MCP 健康诊断脚本
  - `scripts/demo-candidates-submit.js`：候选提交演示
  - `scripts/recipe-audit.js`：Recipe 审计脚本（检查必填字段与格式）
  - `docs/Recipe-审核检查清单.md`：人工审核标准
  - `docs/交付自检说明.md`：交付前自检清单

### 修复

- **Dashboard 修复**：
  - RecipeEditor headers 验证逻辑（移除引号误报）
  - SPMExplorerView 和 CandidatesView 相似度点击 404（规范化 .md 后缀）
  - Snippet 删除 API 方法错误（改用 readSpecFile/deleteSnippet）
  - 重新构建 Dashboard（3 次，确保所有更新生效）

- **术语统一**：
  - `// as:guard` → `// as:audit`（guardViolations.js、statusCommand.js、test/README.md）
  - 文档与代码保持一致

### 改进

- **文档完善**：
  - `.github/copilot-instructions.md`：Recipe 字段详细说明（7 个必填 + 格式要求）
  - `templates/cursor-rules/autosnippet-conventions.mdc`：英文版 Recipe 规则
  - `templates/recipes-setup/`：三个模板文件完全更新（_template.md, example.md, README.md）
  - `skills/` 目录：14 个 Skills 文件更新（Envelope 读取、错误码处理、自检回退）

- **测试完善**：
  - 新增 `test-current-features.js`：快速功能验证测试（10/10 通过）
  - `TEST_REPORT.md`：集成测试报告
  - 集成测试全部通过（39/39，100% 成功率）

---

## [1.6.2] - 2026-02-05

### 新增

- **UI 优化增强**：
  - Dashboard AI Assistant 支持完整 Markdown 渲染（代码块、列表、标题等）
  - 搜索结果显示优化，移除冗余的百分比和图标展示
  - 改进搜索服务 V2 结果标题格式
  - 更新模式预览中的结果展示逻辑

- **原生 UI 改进**：
  - 移除列表项中的文件图标，简化视觉设计
  - 调整文本布局位置，提升界面整洁度
  - 改进窗口控制器的单元格视图配置

### 修复

- **浏览器打开机制优化**：
  - 修复 macOS 上重复弹出浏览器选择对话框的问题
  - 增加应用程序安装检查，避免系统错误
  - 改进 AppleScript 调用的稳定性
  - 移除强制打开 Safari 的逻辑

- **日志系统优化**：
  - 将 AI Provider（DeepSeek）的冗余日志改为条件输出
  - 仅在 `ASD_DEBUG=1` 环境变量设置时显示调试信息
  - 减少测试执行时的日志噪声

### 改进

- **测试框架稳定性**：
  - 修正跨项目测试中的路径判断逻辑
  - 增加对环境变量的灵活支持（ASD_TEST_PROJECT_ROOT、ASD_TEST_PROJECT_BASENAME）
  - 所有 39 个集成测试保持 100% 通过率

- **开发体验**：
  - .gitignore 更新，避免版本控制中包含临时文件和缓存
  - 删除不必要的测试脚本，保持项目结构清洁
  - 改进版本管理与发布流程

---

## [1.6.0] - 2026-02-04

### 新增

- **CLI 版本选项**：新增 `-v, --version` 选项，方便快速查看当前版本。
- **完整的集成测试框架**：新增全面的 Dashboard API 集成测试套件，提供零依赖的测试基础设施。相关内容：
  - 新增 `test/integration/` 目录，包含完整测试框架和 39 个测试用例
  - 框架组件：TestClient（HTTP 客户端）、TestAssert（13+ 断言方法）、TestContext（数据管理）、TestRunner（测试执行）、TestResults（报告生成）
  - 测试覆盖：Recipe API（15 个测试）、权限系统（12 个测试）、跨项目功能（12 个测试），总体 92% 覆盖率
  - 自动报告生成：JSON + HTML 格式，含详细的执行统计和失败分析
  - npm 脚本：`npm run test:integration` 及其变体（recipes/permissions/cross-project）
  - 文档：[测试指南](docs/TESTING.md)、[快速参考](docs/TESTING_QUICKREF.md)、[项目文档](test/integration/README.md)、[速查表](test/integration/QUICKSTART.md)
  - 详见：`test/integration/README.md` 和 `docs/TESTING.md`

- **Dashboard 智能复用**：运行 `asd ui` 时会自动检测端口 3000 是否已运行 Dashboard 服务。如果已运行，则直接复用并打开浏览器标签页，避免启动多个服务实例。相关实现：
  - 新增端口检测和 Dashboard 识别逻辑（`isPortAvailable`、`isDashboardRunning`）
  - 新增健康检查接口 `GET /api/health`
  - 端口被其他服务占用时提示使用 `--port` 参数
  - 详见：[Dashboard 复用功能文档](docs/dashboard-reuse.md)

### 修复

- **GitHub Actions CI 集成测试支持**：修复集成测试在 CI 环境下的兼容性问题：
  - 新增 `ASD_DISABLE_WRITE_GUARD` 环境变量，允许 CI 环境跳过 git push --dry-run 权限检查
  - 新增 `ASD_DISABLE_RATE_LIMIT` 环境变量，允许测试环境跳过速率限制
  - Recipe API 接口规范化：record-usage 支持 `name` 参数，get 接口返回一致的错误格式
  - Recipe 名称验证：拒绝路径遍历攻击（`..`、`/`、`\`）
  - 更新 `.github/workflows/ci.yml` 配置，确保 Dashboard 在后台启动并通过健康检查
  - 所有 39 个集成测试在 CI 环境 100% 通过

- **候选文件存储位置**：修复 `candidateService` 硬编码 `Knowledge` 目录的问题。现在会根据 `AutoSnippet.boxspec.json` 中的 `recipes.dir` 配置来决定候选文件（`candidates.json`）的存储位置。例如：
  - 如果 `recipes.dir` 为 `\"AutoSnippet/recipes\"`，候选文件保存到 `AutoSnippet/.autosnippet/candidates.json`
  - 如果 `recipes.dir` 为 `"docs/recipes"`，候选文件保存到 `docs/.autosnippet/candidates.json`
  - 这确保了项目的所有 AutoSnippet 相关文件都在统一的目录结构下

### 改进

- **单元测试改进**：修复 checksums-verify 测试在不同环境下的稳定性问题：
  - 测试环境变量隔离：确保测试不受当前 shell 环境变量影响
  - 更新测试命令：使用 `help` 替代已废弃的 `status` 命令
  - 改进测试断言：更准确地验证预期行为

---

## [待发布] - 2026-02-04

### 新增

- **完整的集成测试框架**：新增全面的 Dashboard API 集成测试套件，提供零依赖的测试基础设施。相关内容：
  - 新增 `test/integration/` 目录，包含完整测试框架和 39 个测试用例
  - 框架组件：TestClient（HTTP 客户端）、TestAssert（13+ 断言方法）、TestContext（数据管理）、TestRunner（测试执行）、TestResults（报告生成）
  - 测试覆盖：Recipe API（15 个测试）、权限系统（12 个测试）、跨项目功能（12 个测试），总体 92% 覆盖率
  - 自动报告生成：JSON + HTML 格式，含详细的执行统计和失败分析
  - npm 脚本：`npm run test:integration` 及其变体（recipes/permissions/cross-project）
  - 文档：[测试指南](docs/TESTING.md)、[快速参考](docs/TESTING_QUICKREF.md)、[项目文档](test/integration/README.md)、[速查表](test/integration/QUICKSTART.md)
  - 详见：`test/integration/README.md` 和 `docs/TESTING.md`

- **Dashboard 智能复用**：运行 `asd ui` 时会自动检测端口 3000 是否已运行 Dashboard 服务。如果已运行，则直接复用并打开浏览器标签页，避免启动多个服务实例。相关实现：
  - 新增端口检测和 Dashboard 识别逻辑（`isPortAvailable`、`isDashboardRunning`）
  - 新增健康检查接口 `GET /api/health`
  - 端口被其他服务占用时提示使用 `--port` 参数
  - 详见：[Dashboard 复用功能文档](docs/dashboard-reuse.md)

### 修复

- **候选文件存储位置**：修复 `candidateService` 硬编码 `AutoSnippet` 目录的问题。现在会根据 `AutoSnippet.boxspec.json` 中的 `recipes.dir` 配置来决定候选文件（`candidates.json`）的存储位置。例如：
  - 如果 `recipes.dir` 为 `"AutoSnippet/recipes"`，候选文件保存到 `AutoSnippet/.autosnippet/candidates.json`
  - 如果 `recipes.dir` 为 `"docs/recipes"`，候选文件保存到 `docs/.autosnippet/candidates.json`
  - 这确保了项目的所有 AutoSnippet 相关文件都在统一的目录结构下

---

## [1.5.9] - 2025-02-02

### 修复

- **asd status 项目根未找到**：CMD_PATH 改为优先使用 `process.env.ASD_CWD`（asd 脚本传入的调用目录），避免 dev:link 等场景下 process.cwd() 与用户所在目录不一致导致找不到 AutoSnippet.boxspec.json。
- **asd ui 端口占用**：asd-verify 收到 SIGINT/SIGTERM 时转发给 Node 子进程，避免 Ctrl+C 后仅 Swift 退出、Node 成为孤儿进程占用 3000 端口。

### 测试

- **Swift 二进制**：`test/unit/checksums-verify.test.js` 新增 `testSwiftVerifyBinary()`，在存在 bin/asd-verify 时运行 `asd-verify -v` 并断言通过。
- **Node 回退路径**：新增 `testNodeFallbackStatus()`，验证无 asd-verify 时 ASD_CWD 仍生效、status 能正确找到项目根。

---

## [1.5.8] - 2025-02-02

### 变更

- 版本号更新至 1.5.8。

---

## [1.5.7] - 2025-02-02

### 新增

- **Recipe 保存频率限制**：按「项目根 + 客户端 IP」固定窗口限流，防止短时间内多次保存；超限返回 429，前端提示「保存过于频繁，请稍后再试」。配置：`ASD_RECIPE_SAVE_RATE_LIMIT`（默认 20）、`ASD_RECIPE_SAVE_RATE_WINDOW_SECONDS`（默认 60），设为 0 表示不限制。
- **Recipe 保存防重复点击**：编辑 Recipe 弹窗「Save Changes」、SPM 审核页「保存为 Recipe」、对比弹窗「审核候选」在请求进行中禁用按钮并显示「保存中...」，避免重复提交。
- **完整性校验入口（Swift）**：原生入口为 Swift 实现（`resources/asd-entry/main.swift`），仅 macOS 构建为 `bin/asd-verify`；使用 CryptoKit 做 SHA-256 校验。`bin/asd` 优先执行 `asd-verify`，不存在则回退 `node bin/asd-cli.js`。项目仅在 macOS 运行，故保留 Swift 入口。

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
- **完整性校验（阶段二）**：`bin/asd` 优先执行原生入口 `bin/asd-verify`（Swift），存在 `checksums.json` 时对关键文件做 SHA-256 校验，不通过则 exit(1)，通过则 spawn `node bin/asd-cli.js`；无 checksums 或未构建 asd-verify 时回退到 `node bin/asd-cli.js`。发布前 `prepublishOnly` 自动生成 `checksums.json`。
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
