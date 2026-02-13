# SignalCollector — 信号收集与 Skill 自动推荐

> 版本: 2.5.0+  
> 模块路径: `lib/service/skills/SignalCollector.js`

## 概述

SignalCollector 是一个后台定时服务，在 `asd ui` 启动时自动运行。它周期性分析用户与 Agent 的行为模式，生成 Skill 创建建议，并通过 Dashboard 推送通知。

**核心理念**：用户不需要主动思考"该创建哪些 Skill"，SignalCollector 通过持续观察行为信号，自动发现模式并给出建议。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│  asd ui 进程                                                 │
│                                                             │
│  ┌──────────┐  EventBus  ┌──────────────┐  onSuggestions()  │
│  │ Gateway   │ ────────► │ SignalCollector│ ──────────────┐  │
│  │ (audit)   │           │  (定时 30min)  │               │  │
│  └──────────┘            └───────┬──────┘               │  │
│                                  │                       │  │
│                     SkillAdvisor │ suggest()             │  │
│                    ┌─────────────┘                       │  │
│                    │  4 维度信号分析                      │  │
│                    │  ┌─ Guard 违规模式                   │  │
│                    │  ├─ Memory 偏好积累                  │  │
│                    │  ├─ Recipe 分布缺口                  ▼  │
│                    │  └─ 候选积压分析        ┌──────────────┐│
│                    │                        │RealtimeService││
│                    ▼                        │(Socket.io)    ││
│           signal-snapshot.json              └───────┬──────┘│
│           (.autosnippet/)                           │       │
│                                                     │       │
└─────────────────────────────────────────────────────┼───────┘
                                                      │
                                                      ▼
                                           ┌──────────────────┐
                                           │  Dashboard UI     │
                                           │  Skills 侧栏徽标  │
                                           │  推荐面板          │
                                           └──────────────────┘
```

## 工作模式

| 模式      | 行为                              | 使用场景               |
| --------- | --------------------------------- | ---------------------- |
| `off`     | 不启动，不收集                    | CI/CD、静默环境        |
| `suggest` | 收集信号，推送到 Dashboard（默认）| 日常开发               |
| `auto`    | 收集 + 自动创建高优先级 Skill     | 团队统一管理           |

**环境变量控制：**

```bash
# 设置模式（默认 suggest）
export ASD_SIGNAL_MODE=suggest

# 设置收集间隔毫秒（默认 30 分钟 = 1800000）
export ASD_SIGNAL_INTERVAL=1800000
```

## 信号维度

SignalCollector 委托 `SkillAdvisor` 进行 4 维度分析（零 AI 调用，纯规则引擎）：

### 1. Guard 违规模式
- **数据源**：`audit_log` 表 (`action = 'guard_rule:check_code'`)
- **条件**：同一规则违规 ≥ 3 次
- **推荐**：创建编码规范 Skill，让 AI 在编码时主动提醒

### 2. Memory 偏好积累
- **数据源**：`.autosnippet/memory.jsonl`
- **条件**：`type: 'preference'` 条目 ≥ 5 条
- **推荐**：创建项目约定总结 Skill，归纳团队偏好

### 3. Recipe 分布缺口
- **数据源**：`recipes` 表
- **条件**：最高频类别 Recipe ≥ 10 条
- **推荐**：创建该类别的设计模式 / 最佳实践 Skill

### 4. 候选积压分析
- **数据源**：`candidates` 表
- **条件**：被拒绝候选 ≥ 10 条
- **推荐**：创建候选提交质量指南 Skill

## 去重与持久化

每次 tick 的推荐结果与 `.autosnippet/signal-snapshot.json` 快照对比：

```json
{
  "lastRun": "2025-01-15T10:30:00.000Z",
  "totalRuns": 42,
  "pushedNames": ["project-conventions", "project-guard-no-force-unwrap"],
  "lastResult": {
    "totalSuggestions": 3,
    "newSuggestions": 1,
    "analysisContext": { ... }
  },
  "autoCreated": [
    { "name": "project-conventions", "createdAt": "2025-01-15T09:00:00.000Z" }
  ]
}
```

- 已推送过的 Skill 名称记录在 `pushedNames` 中，不会重复通知
- `resetPushed()` 方法可清除记录，使下次 tick 重新评估

## API 端点

### GET /api/v1/skills/signal-status

获取 SignalCollector 后台服务状态。

**响应示例：**

```json
{
  "success": true,
  "data": {
    "running": true,
    "mode": "suggest",
    "snapshot": {
      "lastRun": "2025-01-15T10:30:00.000Z",
      "totalRuns": 5,
      "pushedNames": ["project-conventions"],
      "lastResult": {
        "totalSuggestions": 2,
        "newSuggestions": 1
      }
    }
  }
}
```

### MCP list_skills `_meta`

`autosnippet_list_skills` 工具返回的 `_meta` 字段现包含：

```json
{
  "_meta": {
    "signalSuggestions": 2
  }
}
```

Agent 可据此在适当时机提示用户查看推荐。

## Dashboard 集成

### 侧栏徽标
Skills 导航按钮右侧显示 amber 色角标（✨ n），数字 > 0 时可见。

### 推荐面板
在 Skills 页面点击"推荐"按钮，展开推荐列表，可以 AI 一键创建。

### 轮询机制
Dashboard 每 5 分钟轮询 `/api/v1/skills/signal-status` 更新角标计数。

## EventBus 与 Gateway 集成

### EventBus
全局事件总线已恢复注册到 ServiceContainer：

```javascript
container.get('eventBus'); // EventBus 实例
```

### Gateway 事件
Gateway 每次操作完成/失败后发射事件：

- `gateway:action:completed` — 成功的 Gateway 请求
- `gateway:action:failed` — 失败的 Gateway 请求

事件载荷：

```javascript
{
  requestId, actor, action, resource,
  result: 'success' | 'failure',
  duration, timestamp
}
```

## 生命周期

```
CLI `asd ui` 启动
  ├── initContainer()
  ├── EventBus 注入 Gateway
  ├── HttpServer.start()
  ├── SignalCollector 创建 & start()
  │   ├── 延迟 10s 首次 tick
  │   ├── setInterval 定时 tick
  │   └── tick → SkillAdvisor.suggest() → 过滤 → 推送/自动创建
  └── FileWatcher.start()
```

## 开发调试

```bash
# 缩短间隔到 1 分钟，方便观察
ASD_SIGNAL_INTERVAL=60000 ASD_DEBUG=1 asd ui

# auto 模式（高优先级自动创建）
ASD_SIGNAL_MODE=auto asd ui

# 关闭 SignalCollector
ASD_SIGNAL_MODE=off asd ui
```

## 文件清单

| 文件 | 说明 |
| --- | --- |
| `lib/service/skills/SignalCollector.js` | 核心服务 |
| `lib/service/skills/SkillAdvisor.js` | 4 维度信号分析引擎 |
| `lib/infrastructure/event/EventBus.js` | 全局事件总线 |
| `lib/core/gateway/Gateway.js` | 统一网关（含事件发射） |
| `lib/injection/ServiceContainer.js` | DI 容器（EventBus 注册） |
| `lib/http/routes/skills.js` | HTTP 路由（signal-status） |
| `lib/external/mcp/handlers/skill.js` | MCP handler（_meta 扩展） |
| `bin/cli.js` | CLI 启动链（SignalCollector 接入） |
| `dashboard/src/api.ts` | 前端 API（getSignalStatus） |
| `dashboard/src/components/Layout/Sidebar.tsx` | 侧栏徽标 |
| `dashboard/src/App.tsx` | 轮询 + 状态传递 |
