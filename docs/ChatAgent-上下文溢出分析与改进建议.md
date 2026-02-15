# ChatAgent 上下文溢出分析与改进建议

> 基于冷启动流程、v9 架构与业界 Code Agent 最佳实践的对比分析。

---

## 一、冷启动流程中 ChatAgent 上下文处理与压缩

### 1.1 整体链路

冷启动流程：Bootstrap → `fillDimensionsAsync` → 按维度调用 `ChatAgent.execute`。每个维度使用独立 `conversationId`（`bootstrap-{sessionId}-{dimId}`），维度间通过 `DimensionContext` 共享信息，不共享消息历史。

### 1.2 上下文构建（输入侧）

| 组件 | 位置 | 作用 |
|------|------|------|
| **DimensionContext** | `pipeline/dimension-context.js` | 维护 project + 已完成维度 digest + 已提交候选 |
| **buildDimensionProductionPrompt** | `pipeline/production-prompts.js` | 构建完整 user prompt：角色、项目、前序维度、信号、工作流、质量红线 |
| **buildSignalsSection** | 同上 | 为每个 signal 嵌入 distribution、topFiles、samples、metrics、searchHints |

### 1.3 实时压缩（ReAct 循环内）

| 机制 | 触发条件 | 策略 |
|------|----------|------|
| **ContextWindow L1** | usage 60–80% | 截断旧 tool results 内容 |
| **ContextWindow L2** | usage 80–95% | 摘要历史轮次，保留最后 2 轮 |
| **ContextWindow L3** | usage >95% | 仅保留 prompt + 最后 1 轮 |
| **ToolResultLimiter** | 动态配额 | usage 越高，maxChars/maxMatches 越小 |
| **resetToPromptOnly** | 连续 2 次 AI 错误 | 清空到仅 prompt |

---

## 二、设计问题与上下文溢出根因

### 2.1 首条 prompt 无上限（核心问题）

- **现状**：`buildSignalsSection` 将所有 signals 和代码样本全部放入 prompt，无 token 预算控制
- **后果**：单条 prompt 可达 50K–100K+ tokens，第一次 API 调用即 400
- **典型规模**：objc-deep-scan 30 signals × 4 samples × 30 行 ≈ 54K tokens（仅信号部分）

### 2.2 压缩逻辑不触碰首条 prompt

- **现状**：ContextWindow 设计为 "messages[0] 不可压缩"
- **后果**：当 prompt 本身超标时，任何压缩都无法挽救

### 2.3 信号数量无上限

- **现状**：`signals` 数组全量传入，无 `MAX_SIGNALS_PER_PROMPT`
- **后果**：objc-deep-scan / category-scan 可产出 30–50 个 signals，单维 prompt 极易膨胀

### 2.4 样本体积偏大

- **常量**：`MAX_SAMPLES_PER_SIGNAL = 4`，`MAX_BLOCK_LINES = 30`
- **规模**：每 signal 最多 120 行，无单样本字符截断

### 2.5 前序 digest / 已提交候选无 budget

- **现状**：`previousDimensions`、`existingCandidates` 随维度累积
- **后果**：到后面维度时，这两块可再增加数千 tokens

### 2.6 ToolResultLimiter 与工具返回结构不匹配

- **问题**：`limitSearchResult` 检查 `copy.lines`，而 `search_project_code` 返回 `{ file, line, code, context, score }`
- **后果**：按 match 的细粒度截断无效，仅依赖整体 maxChars

---

## 三、主流 Code Agent 设计参考

### 3.1 核心模式

| 模式 | 说明 |
|------|------|
| **动态上下文发现** | Agent 按需拉取，不一次性推送全量 |
| **检索优于全量** | 用 semantic search + grep 找 top-K，而非塞满仓库 |
| **工具大输出 → artifact** | 长 tool 结果转为引用，用 tail/grep 按需读取 |
| **最小高信号** | 保持少量、高相关度内容，避免上下文膨胀 |

### 3.2 与 AutoSnippet 对比

| 维度 | 主流 Code Agent | AutoSnippet 现状 |
|------|-----------------|------------------|
| 首条 prompt | 任务描述 + 少量元信息 | 大量 signals × 多 samples，易达数万 tokens |
| 上下文策略 | Agent-Pull 为主 | 部分 Pull，首条仍大量 Push |
| 压缩 | 自动摘要、分层、子 agent 隔离 | ContextWindow 只压中间轮，不压 prompt |

---

## 四、v9 架构与改进建议对比

### 4.1 v9 已实现

| 改进点 | v9 实现 | 效果 |
|--------|---------|------|
| ContextWindow 三层压缩 | L1/L2/L3 递进 | ReAct 累积得到控制 |
| PhaseRouter | EXPLORE→PRODUCE→SUMMARIZE | 流程清晰，阶段提示注入 systemPrompt |
| ToolResultLimiter 动态配额 | usage 越高配额越小 | 工具结果自适应截断 |
| resetToPromptOnly | 2 次 AI 错误后清空 | 400 恢复 |
| production-prompts 精简 | 质量红线 8→4 | 降低 prompt 体积 |
| Token 预算 | system 24K，user 16K | 有明确 budget |

### 4.2 v9 仍需改进

| 优先级 | 改进项 | 说明 |
|--------|--------|------|
| **P0** | 首条 prompt token 预算 + 截断 | 在 production-prompts 中增加 PROMPT_TOKEN_BUDGET，buildSignalsSection 按 budget 截断 signals/samples |
| **P1** | 限制 signals 数量 | MAX_SIGNALS_PER_PROMPT=12，按优先级取前 N，其余用简要列表引导按需拉取 |
| **P2** | 修复 limitSearchResult | 改为对 `context` 字段截断，与 search_project_code 返回结构对齐 |
| **P3** | 收紧样本参数 | MAX_SAMPLES_PER_SIGNAL 4→2，MAX_BLOCK_LINES 30→18–20 |
| **P4** | 前序 digest budget | 为 previousDimensions、existingCandidates 分配 token 预算 |
| **P5** | 提前压缩或首轮前预检 | L1 阈值 60%→50%，或首轮 AI 调用前检查 prompt 是否超标 |

---

## 五、LLM 上下文容量参考

### 5.1 主流模型

| 模型 | 输入上限 |
|------|----------|
| Gemini 2.5 Flash | 1,048,576 tokens |
| Gemini 2.0 Flash | 1,048,576 tokens |
| Gemini 1.5 Pro | 128,000 tokens |
| Gemini 1.0 Pro | 32,768 tokens |
| GPT-5 / Claude 4 | 200,000 tokens |

### 5.2 代码行数换算

- 1M tokens ≈ 30,000 行代码（官方口径）
- 约 12–15 tokens/行
- 32,768 tokens ≈ 2,000–2,700 行

---

## 六、配置建议（可选）

便于不同部署和模型调整：

```javascript
const CONTEXT_SAFETY = {
  promptTokenBudget: 24_000,      // 首条 prompt 上限
  maxSignalsPerDimension: 15,
  maxSamplesPerSignal: 2,
  maxBlockLines: 20,
  condenseTokenBudget: 15_000,   // 压缩触发
  toolResultMaxChars: 3500,      // 工具返回预裁剪
};
```

---

## 七、小结

- **根因**：首条 prompt 无 token 控制，叠加 ReAct 累积，易在 32K/128K 模型上触发 400
- **v9 优势**：ContextWindow、PhaseRouter、ToolResultLimiter 已较好控制 ReAct 与工具结果
- **待补**：输入侧（prompt 构建）需增加 budget 与截断逻辑
- **建议**：优先实现 P0（首条 prompt 预算截断）和 P1（限制 signals 数量）
