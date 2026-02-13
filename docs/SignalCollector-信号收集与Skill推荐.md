# SignalCollector — AI 驱动的后台行为分析与 Skill 推荐

> 版本: 2.5.0+
> 模块路径: `lib/service/skills/SignalCollector.js`

## 概述

SignalCollector 是 AutoSnippet 的**后台 AI 分析引擎**。在 `asd ui` 启动时自动运行，周期性收集用户行为的多维度信号，通过 **ChatAgent（AI ReAct 循环）** 进行深度分析，生成 Skill 推荐并通过 Dashboard 推送。

**核心理念**：所有分析决策都由 AI（ChatAgent）完成，而非硬编码规则。AI 综合 6 个维度的信号，判断用户开发状态，给出精准推荐，并自主决定下次分析时间。

## 与旧版的对比

| 维度 | 旧版（v2.5.0 初始） | 新版（AI 驱动） |
|------|---------------------|-----------------|
| 分析引擎 | SkillAdvisor 规则引擎 | ChatAgent AI ReAct |
| 信号维度 | 4 维度 | 6 维度（+对话记忆 +代码变更） |
| 决策方式 | 硬编码阈值规则 | AI 自主分析决策 |
| 执行频率 | 固定定时器 | AI 动态调整（5min ~ 24h） |
| 自动创建 | 回调函数 | AI 直接调用 create_skill 工具 |
| Token 消耗 | 零 | 每次 tick 消耗 AI tokens |

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                     asd ui 启动                              │
│                                                             │
│  ┌──────────────┐    ┌──────────────────────────────────┐   │
│  │ SignalCollector│    │          ChatAgent                │   │
│  │               │    │  ┌─────────────────────────────┐ │   │
│  │  收集 6 维度  │───▶│  │    AI ReAct 循环             │ │   │
│  │  构造 prompt  │    │  │                             │ │   │
│  │               │◀───│  │  1. 分析多维度信号           │ │   │
│  │  解析响应     │    │  │  2. 可调用 suggest_skills    │ │   │
│  │  推送建议     │    │  │  3. 可调用 create_skill      │ │   │
│  │  调整间隔     │    │  │  4. 输出 JSON 推荐          │ │   │
│  │               │    │  └─────────────────────────────┘ │   │
│  └──────┬───────┘    └──────────────────────────────────┘   │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────┐    ┌──────────────┐                       │
│  │ RealtimeService│   │   Dashboard   │                       │
│  │  WebSocket 推送│──▶│  Sidebar 徽章  │                       │
│  └──────────────┘    └──────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

## 6 大信号维度

### 1. Guard 冲突信号
- **来源**：`skills` 表中 `conflict_count > 0` 的记录
- **含义**：存在冲突的 Skill 需要关注或修复

### 2. 对话记忆信号
- **来源**：`.autosnippet/memory.jsonl`（最近 20 条）
- **含义**：用户近期与 AI 的对话主题，反映当前关注点

### 3. Recipe 健康信号
- **来源**：`recipes` 表（最近 30 条，按更新时间排序）
- **含义**：模板使用频率、成功/失败率，发现低质量模板

### 4. Candidate 堆积信号
- **来源**：`candidates` 表中 `status = 'pending'` 的记录
- **含义**：待处理候选 Skill 堆积，可能需要批量审核

### 5. 操作日志信号
- **来源**：`audit_logs` 表（上次运行以来的最近 50 条）
- **含义**：用户近期操作模式，发现重复行为和高频操作

### 6. 代码变更信号
- **来源**：`git diff --stat HEAD~1`
- **含义**：项目代码变更情况，识别需要新 Skill 覆盖的领域

## AI 决策流程

```
tick() 执行流程：

1. 收集 → 6 个维度并行收集原始信号
2. 构造 → #buildAnalysisPrompt(signals) 生成完整 prompt
3. AI 分析 → chatAgent.execute(prompt, {history: []})
   ├── AI ReAct 循环（最多 6 轮）
   ├── 可能调用 suggest_skills 工具获取规则建议
   └── 可能调用 create_skill 工具（auto 模式）
4. 解析 → #parseAiResponse(reply) 提取 JSON
   ├── 策略1: 最后一行 JSON
   ├── 策略2: markdown code block
   └── 策略3: 正则匹配
5. 去重 → 过滤已推送的建议
6. 推送 → onSuggestions(newSuggestions)
7. 调频 → AI 指定 nextIntervalMinutes → 动态调整
8. 持久化 → #saveSnapshot()
9. 调度 → setTimeout(#tick, intervalMs)
```

## 动态间隔机制

SignalCollector 使用 `setTimeout`（而非 `setInterval`）实现自适应调度：

- **初始值**：1 小时（可通过环境变量配置）
- **AI 调整**：每次 tick 后，AI 在响应中指定 `nextIntervalMinutes`
- **范围限制**：5 分钟 ~ 24 小时
- **退避策略**：tick 出错时，间隔翻倍（不超过上限）
- **信号密集时**：AI 可能建议缩短到 15-30 分钟
- **信号平静时**：AI 可能建议延长到 4-8 小时

## 三种工作模式

| 模式 | 行为 |
|------|------|
| `off` | 不启动，不收集 |
| `suggest` | 收集 + AI 分析 + 推送推荐（默认） |
| `auto` | 收集 + AI 分析 + 推送推荐 + AI 自动创建高优先级 Skill |

在 `auto` 模式下，ChatAgent 在 ReAct 循环中可以直接调用 `create_skill` 工具创建 Skill，无需人工干预。

## 前提条件

- **AI Provider 必须可用**：`chatAgent.hasAI === true`
- 如果没有配置 AI Provider，SignalCollector 不会启动
- SkillAdvisor 规则引擎仍然可用（通过 `suggest_skills` 工具），但不再是 SignalCollector 的直接依赖

## 配置

通过环境变量配置：

```bash
# 工作模式
ASD_SIGNAL_MODE=suggest   # off | suggest | auto

# 初始间隔（毫秒），后续由 AI 动态调整
ASD_SIGNAL_INTERVAL=3600000  # 默认 1 小时
```

## 快照文件

位置：`.autosnippet/signal-snapshot.json`

```json
{
  "lastRun": "2025-01-15T10:30:00.000Z",
  "totalRuns": 42,
  "pushedNames": ["auto-import-helper", "error-handler-template"],
  "lastResult": {
    "totalSuggestions": 3,
    "newSuggestions": 1,
    "aiToolCalls": 2
  },
  "lastAiSummary": "项目近期大量修改了 API 路由，建议创建路由模板 Skill",
  "autoCreated": [
    { "name": "api-route-template", "createdAt": "2025-01-15T10:30:00.000Z" }
  ]
}
```

## API

```javascript
import { SignalCollector } from './lib/service/skills/SignalCollector.js';

const collector = new SignalCollector({
  projectRoot: '/path/to/project',
  database: db,
  chatAgent: container.get('chatAgent'),  // 必须注入 ChatAgent
  mode: 'suggest',
  intervalMs: 3600000,
  onSuggestions: (suggestions) => {
    realtimeService.broadcast('signal:suggestions', suggestions);
  },
});

collector.start();       // 启动（需要 chatAgent.hasAI === true）
collector.stop();        // 停止
await collector.collect(); // 手动触发一次
collector.getSnapshot(); // 获取快照
collector.setMode('auto'); // 切换模式
collector.resetPushed(); // 清除已推送记录
```
