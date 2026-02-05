# AutoSnippet 发布清单（AI Quick Reference）

> **快速参考**：用于 AI Agent 执行发布任务时的命令速查  
> **完整指南**：参见 `docs/AI发布指南.md`  
> **发布方式**：通过 Git Tag 触发 GitHub 自动发布

---

## 🚀 快速发布命令序列

### 标准 Patch 发布（Bug 修复）

```bash
# 1. 前置检查
git status && git pull origin main

# 2. 切换生产环境
cp .env .env.backup
# 手动编辑 .env: NODE_ENV=production, VITE_API_BASE_URL=生产URL

# 3. 构建前端
cd dashboard && npm run build && cd ..

# 4. 测试
npm run test:unit && npm run test:integration

# 5. 构建其他
npm run build:native-ui

# 6. 版本升级（1.7.0 → 1.7.1）
npm version patch

# 7. 更新 CHANGELOG（手动编辑）
# ... 编辑 CHANGELOG.md ...

# 8. 提交所有变更
git add .
git commit --amend -m "chore: release v1.7.1"
git tag -f v1.7.1

# 9. 推送触发发布
git push origin main --tags

# 10. 恢复开发环境
cp .env.backup .env

# 11. 验证（等待 GitHub Actions）
npm view autosnippet version
```

---

## 📋 分阶段命令

### Phase 1: 检查（Check）

```bash
# 环境
git branch --show-current  # 期望: main
git status                 # 期望: clean
node -v                    # 期望: >=16

# 测试
npm run test:unit
npm run diagnose:mcp

# 切换生产环境
cp .env .env.backup
# 编辑 .env: NODE_ENV=production

# 前端构建
cd dashboard && npm run build && cd ..
ls -lh dashboard/dist/index.html

# 其他构建
npm run build:native-ui
ls -lh dashboard/dist/index.html
ls -lh resources/native-ui/native-ui
```

---

### Phase 2: 版本（Version）

```bash
# 查看当前版本
npm version

# 查看最近变更
git log v1.7.0..HEAD --oneline

# 执行版本升级
npm version patch   # 1.7.0 → 1.7.1
npm version minor   # 1.7.0 → 1.8.0
npm version major   # 1.7.0 → 2.0.0

# 编辑 CHANGELOG（模板）
cat >> CHANGELOG.md << 'EOF'
## [1.7.1] - $(date +%Y-%m-%d)

### 修复
- 修复描述

EOF

# 修正提交
git add CHANGELOG.md
git commit --amend -m "chore: release v1.7.1"
git tag -f v1.7.1
```

---

### Phase 3: 发布（Publish）

```bash
# 提交所有变更
git add .
git status  # 确认包含 dist/ 等构建产物
git commit --amend -m "chore: release v1.7.1"
git tag -f v1.7.1

# 推送触发 GitHub 自动发布
git push origin main --tags

# 恢复开发环境
cp .env.backup .env
```

---

### Phase 4: 验证（Verify）

```bash
# 验证 npm
npm view autosnippet version
npm view autosnippet

# 本地测试安装
cd /tmp && mkdir test-asd && cd test-asd
npm init -y && npm install autosnippet@latest
npx asd -v
cd .. && rm -rf test-asd

# 创建 GitHub Release（使用 gh CLI）
gh release create v1.7.1 \
  --title "v1.7.1" \
  --notes-file <(sed -n '/## \[1.7.1\]/,/## \[/p' CHANGELOG.md | head -n -1)
```

---

## 🔧 常用辅助命令

### 版本查询

```bash
# 当前版本
npm version

# npm 上的最新版本
npm view autosnippet version

# 查看所有版本
npm view autosnippet versions

# 查看 Git tags
git tag -l
```

---

### Git 变更查询

```bash
# 上次发布后的提交
git log v1.7.0..HEAD --oneline

# 上次发布后的文件变更统计
git diff --stat v1.7.0..HEAD

# 查看特定文件的变更
git log --follow -- lib/recipe/RecipeManager.js
```

---

### CHANGELOG 辅助

```bash
# 提取最近提交作为起草
git log v1.7.0..HEAD --pretty=format:"- %s (%h)" --no-merges

# 按类型分类提交（需手动调整）
git log v1.7.0..HEAD --pretty=format:"%s" --no-merges | \
  grep -iE "^(feat|fix|docs|perf|refactor|test|chore):"
```

---

## 🚨 错误修复

### 撤销版本提交（未推送）

```bash
# 删除 tag
git tag -d v1.7.1

# 撤销 commit（保留变更）
git reset --soft HEAD~1

# 恢复开发环境
cp .env.backup .env

# 完全撤销（丢弃变更）
git reset --hard HEAD~1
```

---

### 环境变量错误

```bash
# 检查当前环境
cat .env | grep NODE_ENV

# 恢复备份
cp .env.backup .env

# 或手动修改
echo "NODE_ENV=development" >> .env
echo "VITE_API_BASE_URL=http://localhost:3100" >> .env
```

---

### 前端构建失败

```bash
# 清理缓存重新构建
cd dashboard
rm -rf node_modules dist
npm install
npm run build
cd ..
```

---

### 推送后发现问题

```bash
# 删除远程 tag (⚠️ 慎用)
git push origin :refs/tags/v1.7.1

# 立即发布修复版本
npm version patch
# 重复完整发布流程
```

---

## 🎯 AI 决策树

```
用户请求发布
  ↓
检查工作区状态
  ├─ 有未提交变更 → 提示先提交/stash
  └─ 干净 → 继续
    ↓
  询问版本类型
    ├─ Patch → 备份 .env → 切换生产环境
    ├─ Minor → 同上
    └─ Major → 警告破坏性变更 → 确认 → 同上
      ↓
    构建前端 → npm run build:dashboard
      ↓
    运行测试 → npm version [type]
      ↓
    提示编辑 CHANGELOG
      ↓
    确认无误后 → git add . → commit --amend → tag -f
      ↓
    推送到 GitHub → git push --tags
      ↓
    恢复开发环境 → cp .env.backup .env
      ↓
    等待 GitHub Actions → 验证发布
      ↓
    创建 Release → 输出成功摘要
```

---

## 📝 版本号规则

| 类型 | 示例 | 何时使用 | 命令 |
|------|------|----------|------|
| **Major** | 1.7.0 → 2.0.0 | 破坏性变更（API 不兼容） | `npm version major` |
| **Minor** | 1.7.0 → 1.8.0 | 新增功能（向后兼容） | `npm version minor` |
| **Patch** | 1.7.0 → 1.7.1 | Bug 修复（向后兼容） | `npm version patch` |
| **Prerelease** | 1.7.0 → 1.7.1-beta.0 | 测试版本 | `npm version prerelease --preid=beta` |

---

## 🔍 发布前自检（30 秒）

```bash
# 一键自检脚本
{
  echo "=== 环境检查 ==="
  echo "分支: $(git branch --show-current)"
  echo "状态: $(git status --short | wc -l) 个未提交文件"
  echo "Node: $(node -v)"
  echo "环境: $(grep NODE_ENV .env)"
  
  echo -e "\n=== 版本信息 ==="
  echo "当前: $(npm version | grep autosnippet)"
  echo "远程: $(npm view autosnippet version 2>/dev/null || echo '待确认')"
  
  echo -e "\n=== 构建产物 ==="
  ls -lh dashboard/dist/index.html 2>/dev/null | awk '{print "Dashboard:", $5}' || echo "Dashboard: 未构建"
  ls -lh resources/native-ui/native-ui 2>/dev/null | awk '{print "NativeUI:", $5}' || echo "NativeUI: 未构建"
  
  echo -e "\n=== 备份检查 ==="
  [ -f .env.backup ] && echo "✓ .env.backup 存在" || echo "⚠️  未找到 .env.backup"
}
```

---

## 📞 发布注意事项

**关键检查**：
- ✅ 环境变量已切换到生产模式
- ✅ 前端已构建且包含在 commit 中
- ✅ .env 备份已创建
- ✅ 推送后记得恢复开发环境

**GitHub 自动发布**：
- Tag 推送后，GitHub Actions 自动触发
- CI/CD 流程自动发布到 npm
- 发布完成后可在 Releases 页面查看

**紧急问题**：
- 立即通知项目维护者
- 检查 GitHub Actions 日志
- 必要时回滚 tag 或发布修复版本

---

**最后更新**：2026-02-05  
**适用版本**：AutoSnippet >= 1.7.0
