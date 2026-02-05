# AutoSnippet 集成测试项目

## 概览

这是一个全面的集成测试套件，涵盖 AutoSnippet Dashboard 的所有核心功能，包括：

- **Recipe API**: 完整的 CRUD 操作、搜索、权威度评分等
- **权限系统**: 权限检查、缓存机制、跨项目支持
- **跨项目功能**: 多项目支持、项目隔离、共享资源

## 项目结构

```
test/integration/
├── framework/
│   └── test-framework.js          # 测试基础框架（TestClient、TestAssert 等）
├── fixtures/
│   └── test-data.js                # 测试数据和 fixtures
├── suites/
│   ├── recipes.test.js             # Recipe API 测试（15 个测试）
│   ├── permissions.test.js         # 权限系统测试（12 个测试）
│   └── cross-project.test.js       # 跨项目功能测试（12 个测试）
├── run-tests.js                    # 主测试运行器
├── README.md                        # 本文件
└── reports/                        # 测试报告输出目录
  ├── report-*.json               # JSON 格式报告
  └── report-*.html               # HTML 格式报告
```

## 快速开始

### 1. 启动 Dashboard

```bash
npm run dashboard
# 或指定项目
npm run dashboard -- -d /path/to/project
```

Dashboard 应该在 `http://localhost:3100` 上运行。

### 2. 运行测试

```bash
# 运行所有测试
node test/integration/run-tests.js

# 运行特定测试套件（需修改 run-tests.js）
node test/integration/suites/recipes.test.js
```

### 3. 查看报告

测试完成后，报告会保存到 `test/integration/reports/` 目录：
- `report-*.json`: 机器可读的详细报告
- `report-*.html`: 人类可读的可视化报告

## 测试套件详情

### Recipe API 测试 (15 个测试)

涵盖以下功能：

| 测试 | 说明 |
|-----|------|
| 保存基础 Recipe | POST `/api/recipes/save` 基本操作 |
| 保存高级 Recipe | 支持元数据和 frontmatter |
| 获取已保存 Recipe | GET `/api/recipes/get` 检索 |
| 获取不存在 Recipe | 错误处理验证 |
| 设置权威度评分 | POST `/api/recipes/set-authority` |
| 权威度范围验证 | 值域检查 (0-5) |
| 记录使用 | POST `/api/recipes/record-usage` |
| 删除 Recipe | POST `/api/recipes/delete` |
| 删除不存在 Recipe | 错误处理 |
| 名称验证 (安全性) | 拒绝路径遍历 `../..` |
| 批量操作 | 连续保存多个 Recipe |
| Recipe 搜索 | GET `/api/recipes/search` |
| 权限缓存清除 | POST `/api/admin/clear-permission-cache` |
| Health 检查 | GET `/api/health` |
| 长期持久化 | 验证文件系统存储 |

### 权限系统测试 (12 个测试)

深度覆盖权限机制：

| 测试 | 说明 |
|-----|------|
| 基础权限检查 | git push --dry-run 验证 |
| 缓存机制验证 | 性能优化验证 |
| 缓存清除 | 手动清除缓存 |
| 权限错误消息 | 详细的诊断信息 |
| 并发权限检查 | 并发安全性 |
| 跨项目权限 | 项目间权限隔离 |
| 超时处理 | 超时场景处理 |
| 自动目录创建 | 缺失目录自动创建 |
| No-remote 支持 | 本地 git 仓库支持 |
| 旧子模块检测 | 迁移问题诊断 |
| 错误信息详细度 | 调试信息完整性 |
| 缓存 TTL | 24 小时过期验证 |

### 跨项目功能测试 (12 个测试)

验证多项目支持：

| 测试 | 说明 |
|-----|------|
| 识别 projectRoot | 获取当前项目路径 |
| 项目特定 Recipe | 独立项目 Recipe |
| 项目隔离 | Recipe 文件位置隔离 |
| 跨项目权限 | 多项目权限检查 |
| 共享 Recipe | 可复用的 Recipe |
| 项目元数据 | 访问项目配置 |
| 多实例支持 | 多个 Dashboard 实例 |
| 项目切换 | `-d` 参数机制 |
| 搜索范围 | 项目级搜索隔离 |
| 配置加载 | boxspec 配置读取 |
| 缓存隔离 | 项目级权限缓存 |
| 环境变量支持 | ASD_CWD 环境变量 |

## 测试框架 API

### TestClient

HTTP 请求客户端：

```javascript
const { TestClient } = require('./framework/test-framework');
const client = new TestClient('http://localhost:3100');

// GET 请求
const response = await client.get('/api/health');

// POST 请求
const response = await client.post('/api/recipes/save', {
  name: 'test',
  title: 'Test',
  content: '# Content'
});

// 设置请求头
client.setHeader('Authorization', 'Bearer token');
```

### TestAssert

断言工具：

```javascript
const { TestAssert } = require('./framework/test-framework');

TestAssert.assertEquals(actual, expected);
TestAssert.assertTrue(value);
TestAssert.assertExists(value);
TestAssert.assertStatusCode(response, 200);
TestAssert.assertObjectHasKeys(obj, ['key1', 'key2']);
```

### TestContext

测试上下文管理：

```javascript
runner.test('测试名称', async (ctx) => {
  // 存储数据
  ctx.set('key', value);
  const value = ctx.get('key');
  
  // 注册清理函数
  ctx.onCleanup(async () => {
  // 清理代码
  });
  
  // 计时
  ctx.startTimer();
  // ... 操作 ...
  const duration = ctx.endTimer();
});
```

### TestRunner

测试组织器：

```javascript
const { TestRunner } = require('./framework/test-framework');
const runner = new TestRunner('测试套件名称');

runner.test('测试说明', async (ctx) => {
  // 测试代码
});

runner.skip('跳过的测试', async (ctx) => {
  // 不会执行
});

const results = await runner.run();
```

## 测试数据和 Fixtures

### testRecipes

预定义的测试 Recipe：
- `basicRecipe`: 基础 Recipe
- `advancedRecipe`: 高级 Recipe（含元数据）
- `minimalRecipe`: 最小 Recipe
- `invalidRecipe`: 非法 Recipe（用于负测试）

### permissionTests

权限检查测试数据：
- `validDirectory`: 有效目录
- `invalidDirectory`: 无效目录
- `noRemoteRepo`: 无 remote 的仓库

### 生成函数

```javascript
const { generateRandomRecipe, generateTestCombinations } = require('./fixtures/test-data');

// 生成随机 Recipe
const recipe = generateRandomRecipe(1);

// 生成测试用例组合
const combinations = generateTestCombinations();
```

## 运行示例

### 单个测试运行

```bash
# 启动 Dashboard
npm run dashboard

# 在另一个终端运行测试
node test/integration/run-tests.js
```

### 持续集成

在 CI/CD 管道中集成：

```yaml
# GitHub Actions 示例
- name: 启动 Dashboard
  run: npm run dashboard &
  
- name: 等待 Dashboard 就绪
  run: sleep 5
  
- name: 运行集成测试
  run: node test/integration/run-tests.js
```

## 故障排查

### Dashboard 无法连接

```bash
# 检查 Dashboard 是否运行
curl http://localhost:3100/api/health

# 启动 Dashboard
npm run dashboard
```

### 权限问题

```bash
# 检查写入权限
ls -la AutoSnippet/recipes/

# 验证 git 配置
git config -l | grep remote
```

### 缓存问题

清除权限缓存：

```bash
curl -X POST http://localhost:3100/api/admin/clear-permission-cache
```

## 性能基准

典型运行时间：

| 操作 | 时间 | 备注 |
|-----|------|------|
| 保存 Recipe | 50-100ms | 包含权限检查 |
| 获取 Recipe | 10-20ms | 从磁盘读取 |
| 搜索 Recipe | 100-200ms | 语义搜索 |
| 权限检查 (缓存命中) | <5ms | 内存查询 |
| 权限检查 (缓存未命中) | 500-1000ms | git push --dry-run |

## 最佳实践

### 1. 测试隔离

每个测试应该：
- 创建独立的资源
- 在 cleanup 中清理资源
- 不依赖其他测试的执行顺序

```javascript
runner.test('测试', async (ctx) => {
  // 创建资源
  const name = 'test-' + Date.now();
  
  // 注册清理
  ctx.onCleanup(async () => {
  await client.post('/api/recipes/delete', { name });
  });
});
```

### 2. 断言明确

使用具体的断言：

```javascript
// ❌ 不够明确
TestAssert.assertTrue(response);

// ✓ 清晰
TestAssert.assertEquals(response.status, 200, 'HTTP 状态应该是 200');
TestAssert.assertTrue(response.body.success, 'API 应该返回成功');
```

### 3. 错误处理

总是处理可能的错误：

```javascript
try {
  const response = await client.get('/api/missing');
  TestAssert.assertTrue(response.status !== 200);
} catch (error) {
  // 处理网络错误等
}
```

## 扩展测试

### 添加新的测试套件

1. 创建新文件 `test/integration/suites/new-feature.test.js`
2. 导入测试框架
3. 定义测试
4. 在 `run-tests.js` 中导入并添加到 `allTestSuites`

```javascript
const newTests = require('./suites/new-feature.test');
const allTestSuites = [
  recipesTests,
  permissionsTests,
  crossProjectTests,
  newTests  // 添加
];
```

## 常见问题

**Q: 如何测试异步操作？**
A: 使用 `await` 关键字等待 Promise 完成。

**Q: 如何处理测试中的随机性？**
A: 使用 `Date.now()` 或 `Math.random()` 生成唯一标识符。

**Q: 如何跳过某些测试？**
A: 使用 `runner.skip('描述', fn)` 代替 `runner.test()`。

## 贡献指南

欢迎添加更多测试！请确保：
1. 遵循现有的测试风格
2. 提供清晰的测试描述
3. 添加必要的 cleanup
4. 更新本 README

## 许可证

MIT

---

**最后更新**: 2025-01-04
**维护者**: AutoSnippet Team
