# AutoSnippet 集成测试系统

本目录包含 AutoSnippet 的自动化集成测试脚本，用于验证核心指令和 AI 辅助能力的稳定性。

## 🧪 测试原则
1. **纯净性**：测试脚本仅保留逻辑，不存放临时数据。
2. **环境隔离**：测试在外部工程（默认 `AutoSnippetTestHome`）中运行，所有的临时 Xcode Snippets 和缓存都会重定向到该工程下的 `.asd_test_temp` 目录中，不污染开发者真实的 Xcode 环境。
3. **痕迹清理**：测试完成后自动删除生成的配置文件和临时重定向目录。
4. **基础优先**：优先保证非 AI 核心功能的稳定性。

### 测试覆盖概览
- **basic**：`asd -v`、`asd init`、`asd root`。
- **create**：在**自建临时项目**中测试 AI 模式和预置模式，全方位覆盖 **Swift** 和 **OC**。
- **install**：在自建项目中校验重定向目录下生成至少一个 `.codesnippet` 文件。
- **search**：验证检索功能。
- **update**：验证 Snippet 信息更新能力。
- **spm-map**：验证 SPM 映射扫描功能。
- **watch**：在**自建临时项目**中验证 AI 审查输出与标记清理，全方位覆盖 **Swift** 和 **OC**。
- **embed**：在自建项目中验证 `asd embed --clear`（Mock AI），索引写入 `Knowledge/.autosnippet/context/`。
- **install-skill**：在自建项目中验证 `install:cursor-skill` 生成 `by-category/`、`project-recipes-context.md` 等。
- **embed-real**：在**真实环境** BiliDiliForTest 中验证 `asd embed`，多 Recipe/多模块场景。
- **install-skill-real**：在**真实环境** BiliDiliForTest 中验证 `install:cursor-skill`，多 Skills 与 by-category 切片。

### 单元测试（无外部依赖）
- **test:unit**：`defaults.inferCategory`、`chunker` 各策略、`context` 常量与 JsonAdapter。

### 根据修改内容选择测试（`--changed`）
- **AI 修改完代码后请执行**：`npm run test:changed`（按 git 变更选测），或传入本次修改的文件路径只跑相关测试：`node test/runner.js --changed -- bin/create.js lib/snippet/specRepository.js`。
- **变更来源**（优先级）：1) 命令行 `--` 后的路径；2) 环境变量 `ASD_TEST_CHANGED_FILES`（逗号或换行分隔）；3) `git diff --name-only HEAD`。
- **路径→套件映射**：`runner.js` 内 `PATH_TO_SUITES` 定义（如 `bin/create.js` → create/update，`lib/watch/fileWatcher.js` → watch）。AI 修改代码后可将本次改动的文件列表写入 `ASD_TEST_CHANGED_FILES`，再执行 `node test/runner.js --changed` 只跑相关测试。
- **依赖**：若选中的套件包含 create/install/update/search/spmmap/watch 之一，会自动加入 basic，保证 `asd init` 已执行。

## 🛠️ 配置说明
测试环境路径通过环境变量 `ASD_TEST_HOME` 配置。

```bash
# 默认路径为 ../AutoSnippetTestHome/BiliDiliForTest
export ASD_TEST_HOME=/path/to/your/test/project
```

## 🚀 运行测试

```bash
# 运行全量测试 (使用本地 bin/asnip.js)
npm test

# 根据修改内容自动选择测试（AI 修改完代码后可直接跑对应测试）
npm run test:changed
# 或：node test/runner.js --changed
# 变更来源（优先级）：1) 命令行 -- 后的路径；2) 环境变量 ASD_TEST_CHANGED_FILES；3) git diff --name-only HEAD
# 示例（仅跑与修改文件相关的测试）：node test/runner.js --changed -- bin/create.js lib/snippet/specRepository.js

# 仅运行指定模块
node test/runner.js --basic         # 仅 asd -v / init / root
node test/runner.js --create        # 仅 create：AI 模式 + 预置模式
node test/runner.js --install       # 仅 asd install（校验 .codesnippet 写入）
node test/runner.js --search        # 仅 asd search（关键词 / 无关键词）
node test/runner.js --update        # 仅 asd update（修改 snippet summary）
node test/runner.js --spmmap        # 仅 asd spm-map --dry-run
node test/runner.js --watch         # 仅 asd watch（含 as:guard / as:create）
node test/runner.js --embed           # 仅 asd embed（Mock AI，自建项目）
node test/runner.js --install-skill   # 仅 install:cursor-skill（自建项目）
node test/runner.js --embed-real      # 仅 asd embed（真实环境 BiliDiliForTest）
node test/runner.js --install-skill-real  # 仅 install:cursor-skill（真实环境）
npm run test:unit                   # 单元测试（defaults、chunker、context）
```

## 🌍 全局同步开发 (Local-to-Global)
如果你需要将本地修改覆盖到全局 `asd` 命令进行实际环境测试：

```bash
# 1. 将当前本地代码链接到全局
npm run dev:link

# 2. 验证全局 asd 是否指向本地
npm run dev:verify

# 3. 运行测试（验证全局环境）
node test/runner.js --global

# 4. 启动 UI 前自动构建 Dashboard（本地改完前端后无需先手动 build）
ASD_UI_BUILD=1 asd ui
# 或在仓库内：npm run dev:ui
```

## 📂 目录结构
- `runner.js`: 集成测试运行器（basic / create / install / search / update / spmmap / watch / embed / install-skill）。
- `unit/`: 单元测试（defaults、chunker、context），无外部依赖。
- `README.md`: 本说明。

临时目录与杂物均不在本目录：测试时 Xcode Snippets 与缓存重定向到测试工程下的 `.asd_test_temp`，测试结束会清理。
