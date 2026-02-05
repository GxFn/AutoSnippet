# Dashboard 服务器架构

## 概述

Dashboard 是 AutoSnippet 的 Web UI，已通过模块化重构实现了清晰的路由和服务分离。

## 目录结构

```
lib/dashboard/
├── DashboardServer.js      # Express 应用入口
├── routes/                 # API 路由
│   ├── recipeRoutes.js     # /api/recipes/* 端点
│   ├── snippetRoutes.js    # /api/snippets/* 端点
│   ├── targetRoutes.js     # /api/targets/* 端点
│   ├── indexRoutes.js      # /api/index/* 端点
│   └── statusRoutes.js     # /api/status/* 端点
└── services/               # 业务逻辑服务
  ├── RecipeSearchService.js
  ├── SnippetManagementService.js
  └── IndexManagementService.js

bin/
└── dashboard-server.js     # 启动脚本（简化版）
```

## 核心组件

### DashboardServer

Express 应用初始化和中间件配置：

```javascript
const DashboardServer = require('../lib/dashboard/DashboardServer');

const server = new DashboardServer({
  port: 3000,
  projectRoot: '/path/to/project'
});

await server.start();
```

### 路由模块

每个路由文件导出一个 Express Router：

```javascript
// lib/dashboard/routes/recipeRoutes.js
const express = require('express');
const router = express.Router();

router.get('/search', async (req, res) => {
  // 处理搜索请求
});

router.post('/:id', async (req, res) => {
  // 处理更新请求
});

module.exports = router;
```

### 服务层

服务层包含业务逻辑，与路由分离：

```javascript
// lib/dashboard/services/RecipeSearchService.js
class RecipeSearchService {
  async search(keyword, options) {
  // 搜索逻辑
  }

  async getById(id) {
  // 获取详情逻辑
  }
}

module.exports = RecipeSearchService;
```

## API 端点

### 食谱 API（Recipes）

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/recipes/search` | 搜索食谱 |
| GET | `/api/recipes/:id` | 获取食谱详情 |
| POST | `/api/recipes/:id` | 更新食谱 |
| DELETE | `/api/recipes/:id` | 删除食谱 |

### 代码片段 API（Snippets）

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/snippets` | 列出代码片段 |
| GET | `/api/snippets/:id` | 获取片段详情 |
| POST | `/api/snippets` | 创建片段 |
| POST | `/api/snippets/:id` | 更新片段 |
| DELETE | `/api/snippets/:id` | 删除片段 |

### 目标 API（Targets）

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/targets` | 列出 SPM 目标 |
| GET | `/api/targets/:name` | 获取目标详情 |

### 索引 API（Index）

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/index/status` | 获取索引状态 |
| POST | `/api/index/rebuild` | 重建向量索引 |

### 状态 API（Status）

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/status` | 获取系统状态 |

## 使用示例

### 启动 Dashboard

```bash
node bin/dashboard-server.js --port 3000
```

或在 CLI 中：
```bash
asd ui --port 3000
```

### 添加新的 API 端点

1. 创建新的路由文件或在现有文件中添加路由
2. 在 DashboardServer 中注册路由
3. 为业务逻辑创建相应的服务类

```javascript
// lib/dashboard/routes/myRoutes.js
const express = require('express');
const router = express.Router();

router.get('/my-endpoint', async (req, res) => {
  try {
  const result = await myService.doSomething();
  res.json({ success: true, data: result });
  } catch (error) {
  res.status(500).json({ error: error.message });
  }
});

module.exports = router;
```

## 中间件

### 错误处理

所有路由都应该有适当的错误处理：

```javascript
router.get('/endpoint', async (req, res, next) => {
  try {
  const result = await service.getData();
  res.json(result);
  } catch (error) {
  next(error);  // 交给全局错误处理中间件
  }
});
```

### 日志记录

使用统一的日志记录格式：

```javascript
router.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});
```

## 测试

### 单元测试

```javascript
// test/unit/dashboard/services/RecipeSearchService.test.js
const RecipeSearchService = require('../../../lib/dashboard/services/RecipeSearchService');

describe('RecipeSearchService', () => {
  let service;

  beforeEach(() => {
  service = new RecipeSearchService();
  });

  it('should search recipes by keyword', async () => {
  const results = await service.search('async');
  expect(results).toBeArray();
  });
});
```

### 集成测试

```javascript
// test/integration/dashboard.test.js
const request = require('supertest');
const app = require('../../../lib/dashboard/DashboardServer');

describe('Dashboard API', () => {
  it('GET /api/recipes/search should return results', async () => {
  const res = await request(app)
    .get('/api/recipes/search')
    .query({ q: 'async' });
  
  expect(res.statusCode).toBe(200);
  expect(res.body).toHaveProperty('data');
  });
});
```

## 性能优化

### 缓存

使用 lib/infrastructure/cache/CacheStore 缓存常用数据：

```javascript
const cache = require('../../infrastructure/cache/CacheStore');

async search(keyword) {
  const cacheKey = `recipe_search_${keyword}`;
  let results = cache.get(cacheKey);
  
  if (!results) {
  results = await this.queryDatabase(keyword);
  cache.set(cacheKey, results, 3600);  // 缓存 1 小时
  }
  
  return results;
}
```

### 分页

大数据集应支持分页：

```javascript
router.get('/snippets', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 20;
  
  const result = await service.getSnippets((page - 1) * pageSize, pageSize);
  res.json(result);
});
```

## 常见问题

### Q: 如何访问项目根目录？
A: 从 DashboardServer 实例获取：
```javascript
const projectRoot = this.options.projectRoot;
```

### Q: 如何处理异步操作？
A: 使用 async/await：
```javascript
router.get('/endpoint', async (req, res, next) => {
  try {
  const data = await service.fetchData();
  res.json(data);
  } catch (error) {
  next(error);
  }
});
```

### Q: 如何添加认证？
A: 创建认证中间件：
```javascript
const authMiddleware = (req, res, next) => {
  // 验证请求...
  next();
};

router.use(authMiddleware);
```

## 后续改进

- [ ] WebSocket 实时更新
- [ ] GraphQL API 支持
- [ ] OAuth 认证
- [ ] 请求速率限制
- [ ] API 文档生成（OpenAPI/Swagger）
