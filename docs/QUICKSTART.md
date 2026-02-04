# 快速开始指南

**版本**: 1.0.0  
**目标用户**: 开发者、系统管理员  
**预计时间**: 5 分钟

---

## 📋 前置要求

- Node.js >= 14.0.0
- npm 或 yarn
- macOS / Linux / Windows (任何支持 Node.js 的操作系统)

---

## 🚀 快速启动

### 1. 启动 API 服务器

```bash
cd /path/to/AutoSnippet

# 启动服务器
node bin/api-server.js

# 输出
🚀 API Gateway started on http://localhost:8080
📝 API 文档: http://localhost:8080/api/docs
🏥 健康检查: http://localhost:8080/api/health

# 按 Ctrl+C 停止服务器
```

### 2. 验证服务可用

```bash
# 在另一个终端中测试
curl http://localhost:8080/api/health

# 预期输出
{"status":"healthy","timestamp":"2024-02-04T..."}
```

---

## 💡 常见任务

### 添加一个任务

```bash
curl -X POST http://localhost:8080/api/agent/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My First Task",
    "priority": "high"
  }'

# 响应示例
{
  "success": true,
  "data": {
    "id": "task_abc123",
    "name": "My First Task",
    "status": "pending",
    "priority": "high"
  }
}
```

### 查询系统统计

```bash
curl http://localhost:8080/api/agent/stats

# 响应
{
  "success": true,
  "data": {
    "totalTasks": 1,
    "completedTasks": 0,
    "failedTasks": 0,
    "state": "idle"
  }
}
```

### 批量添加任务

```bash
curl -X POST http://localhost:8080/api/agent/tasks/batch \
  -H "Content-Type: application/json" \
  -d '[
    { "name": "Task 1", "priority": "high" },
    { "name": "Task 2", "priority": "normal" },
    { "name": "Task 3", "priority": "low" }
  ]'
```

### 暂停和恢复

```bash
# 暂停 Agent
curl -X POST http://localhost:8080/api/agent/pause

# 恢复 Agent  
curl -X POST http://localhost:8080/api/agent/resume
```

---

## 🔧 高级配置

### 自定义端口和主机

```bash
# 启动在不同端口
node bin/api-server.js --port 9000 --host 0.0.0.0

# 现在可以访问
curl http://0.0.0.0:9000/api/health
```

### 使用配置文件（计划功能）

```bash
node bin/api-server.js --config config.json
```

---

## 📊 性能检查

### 运行性能测试

```bash
# 运行端到端测试（包括性能测试）
npm test

# 预期结果
E2E: 性能基准测试 - 单个请求延迟
  延迟统计: avg=0.70ms, min=0ms, max=1ms
  
E2E: 性能基准测试 - 吞吐量  
  吞吐量: 3333.33 请求/秒
```

### 性能基准

| 操作 | 延迟 | 吞吐量 | 评级 |
|------|------|--------|------|
| 单个请求 | 0.70ms | - | A+ |
| 批量 50 任务 | 5ms | - | A+ |
| 并发 100 | - | 3,333 req/s | A+ |

---

## 🐛 常见问题

### 问题 1: 端口已被占用

```
Error: listen EADDRINUSE: address already in use :::8080
```

**解决方案**:
```bash
# 使用不同的端口
node bin/api-server.js --port 9000

# 或者查找占用端口的进程 (macOS/Linux)
lsof -i :8080
kill -9 <PID>
```

### 问题 2: 无法连接到服务器

**检查清单**:
- [ ] 服务器是否在运行？ `curl http://localhost:8080/api/health`
- [ ] 端口是否正确？ 默认 8080
- [ ] 防火墙是否阻止？ 检查系统防火墙

### 问题 3: 请求超时

**解决方案**:
```javascript
// 增加超时时间
const timeout = 30000; // 30 秒

const req = http.request(options, callback);
req.setTimeout(timeout);
req.end();
```

---

## 📚 接下来

- 📖 [完整 API 参考](./API-Reference.md)
- 🔧 [部署指南](./DEPLOYMENT.md)  
- 💡 [最佳实践](./BEST-PRACTICES.md)
- 🐛 [故障排查](./TROUBLESHOOTING.md)

---

**需要帮助？** 查看 [常见问题](#常见问题) 或阅读完整文档。

