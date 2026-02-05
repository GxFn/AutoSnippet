# 项目结构优化执行计划

## 📋 任务概览

**目标**: 优化项目文件结构，提高可维护性和可浏览性

**排除项**: docs 和 copilotDocs（保持原样）

---

## 🔴 **第一阶段：必须修复的问题**

### Task 1.1: 合并 test/ 和 tests/ 目录
**当前状态**:
- `test/` - unit/, integration/, fixtures/, manual/, temp/, runner.js, README.md
- `tests/` - e2e/, benchmarks/, coverage/

**执行步骤**:
1. 移动 `tests/e2e/*` → `test/e2e/`
2. 移动 `tests/benchmarks/*` → `test/benchmarks/`
3. 移动 `tests/coverage/*` → `test/coverage/`
4. 删除空的 `tests/` 目录
5. 更新所有引用 `tests/` 的路径为 `test/`
6. Git commit: "refactor: merge tests/ into test/ directory"

**影响的文件** (需要检查和更新):
- package.json scripts
- README.md
- CI/CD 配置
- 测试引用路径

---

### Task 1.2: 合并 lib/infra/ 和 lib/infrastructure/
**当前状态**:
- `lib/infra/` - 1个文件
- `lib/infrastructure/` - 11个文件

**执行步骤**:
1. 检查 `lib/infra/` 中的 1 个文件的用途
2. 移动到 `lib/infrastructure/` 或删除
3. 删除空的 `lib/infra/` 目录
4. 更新所有导入: `require('lib/infra')` → `require('lib/infrastructure')`
5. Git commit: "refactor: merge lib/infra into lib/infrastructure"

**影响的文件** (需要搜索和更新):
- lib/ 中的所有引用 infra 的文件
- 配置文件

---

### Task 1.3: 删除根目录的空 recipes/ 目录
**当前状态**:
- 根目录 `recipes/` - 4个几乎为空的文件
- `AutoSnippet/recipes/` - 实际的知识库

**执行步骤**:
1. 确认根目录 recipes/ 内容已迁移或不需要
2. 删除根目录 `recipes/` 目录
3. 更新文档中对 recipes/ 的引用
4. Git commit: "refactor: remove deprecated root recipes/ directory"

---

## 🟡 **第二阶段：强烈建议改进**

### Task 2.1: 重组 scripts/ 目录
**当前状态**: 28个文件平铺在 scripts/ 中

**目标结构**:
```
scripts/
  ├── build/
  │   ├── build-asd-entry.js
  │   ├── build-knowledge-graph.js
  │   ├── build-native-ui.js
  │   └── build.mjs
  ├── setup/
  │   ├── init-vector-db.js
  │   ├── init-xcode-snippets.js
  │   ├── init-spec.js
  │   ├── install-*.js (3个文件)
  │   └── ensure-parse-package.js
  ├── migration/
  │   ├── (已有)
  ├── cursor-rules/
  │   ├── (已有)
  ├── release.js
  ├── verify-*.js (3个)
  ├── diagnose-*.js (2个)
  └── mcp-server.js (MCP相关)
```

**执行步骤**:
1. 创建 scripts/build/ 目录
2. 创建 scripts/setup/ 目录
3. 移动相应文件
4. 更新 package.json 中的所有脚本路径
5. 验证所有脚本仍可正常运行
6. Git commit: "refactor: organize scripts/ into functional categories"

---

### Task 2.2: 规划 lib/ 重构（分层架构）
**当前状态**: lib/ 有 31 个子目录，混合了多种分层方式

**目标结构**:
```
lib/
  ├── core/              (基础工具)
  │   ├── ConfigManager.js
  │   ├── bootstrap.js
  │   └── ...
  ├── domain/            (业务实体、规则)
  │   ├── entities/
  │   ├── metrics/       (← from business/)
  │   ├── recipe/        (← from business/)
  │   ├── search/        (← from business/)
  │   └── ...
  ├── application/       (应用服务)
  │   ├── services/
  │   └── ...
  ├── infrastructure/    (外部调用、合并)
  │   ├── (当前的 infrastructure/)
  │   └── (当前的 infra/ 内容)
  └── features/          (特定功能)
      ├── ai/
      ├── candidate/
      ├── guard/
      ├── mcp/
      ├── recipe/
      ├── search/
      ├── snippet/
      ├── spm/
      ├── automation/
      ├── agent/
      └── watch/
```

**执行步骤** (分步骤，避免一次改动过多):
1. 从 lib/business/ 移动文件到 lib/domain/
2. 删除空的 lib/business/
3. 更新所有导入路径
4. 进一步的重构（如需）

---

## 🟢 **第三阶段：可选改进**

### Task 3.1: 分离 bin/ 中的服务脚本
**当前状态**:
```
bin/
  ├── api-server.js       (应在 scripts/)
  ├── dashboard-server.js (应在 scripts/)
  └── (命令行工具)
```

**执行步骤** (可选，需谨慎):
1. 移动 api-server.js → scripts/
2. 移动 dashboard-server.js → scripts/
3. 更新 package.json 引用
4. 验证功能

---

### Task 3.2: 命名统一为 lowercase + plural
**影响**:
- copilotDocs → 保持不变（用户已要求）
- infra → infrastructure（已在 Task 1.2）
- test vs tests → test（已在 Task 1.1）

---

## 📅 **执行日程**

| 优先级 | 任务 | 复杂度 | 工时 | 状态 |
|--------|------|--------|------|------|
| 🔴 | Task 1.3: 删除 root recipes/ | ⭐ | 10分钟 | ⏳ |
| 🔴 | Task 1.1: 合并 test/tests | ⭐⭐ | 30分钟 | ⏳ |
| 🔴 | Task 1.2: 合并 lib/infra | ⭐⭐ | 30分钟 | ⏳ |
| 🟡 | Task 2.1: 重组 scripts/ | ⭐⭐ | 45分钟 | ⏳ |
| 🟡 | Task 2.2: 规划 lib 重构 | ⭐⭐⭐ | 120分钟 | ⏳ |
| 🟢 | Task 3.1: 分离 bin 脚本 | ⭐ | 20分钟 | ⏳ |

**总时间估计**: 4-5 小时（分阶段执行）

---

## ✅ **执行清单**

### Phase 1 (必须)
- [ ] Task 1.3: 删除根目录 recipes/
- [ ] Task 1.1: 合并 test/ 和 tests/
- [ ] Task 1.2: 合并 lib/infra 和 infrastructure/

### Phase 2 (强烈建议)
- [ ] Task 2.1: 重组 scripts/ 目录
- [ ] Task 2.2: 规划 lib/ 重构

### Phase 3 (可选)
- [ ] Task 3.1: 分离 bin 中的服务脚本

---

## 🎯 **预期收益**

**改进前**:
- 31个 lib/ 子目录，层级不清
- 28个脚本文件平铺
- 双重 test/tests 难以区分
- 双重 infra/infrastructure 混淆

**改进后**:
- 清晰的分层架构，易于导航
- 脚本按功能分类，易于查找
- 统一的测试目录结构
- 消除命名重复和混淆

---

## 🔄 **回滚策略**

每一步都通过 git commit 记录，可随时回滚：
```bash
git revert <commit-hash>
```

---

## 📝 **开始执行**

准备好开始 Phase 1 吗？
