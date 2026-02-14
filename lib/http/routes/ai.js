/**
 * AI API 路由
 * AI 提供商管理、摘要、翻译、对话
 */

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getServiceContainer } from '../../injection/ServiceContainer.js';
import { createProvider } from '../../external/ai/AiFactory.js';
import { ValidationError } from '../../shared/errors/index.js';
import Logger from '../../infrastructure/logging/Logger.js';

const router = express.Router();
const logger = Logger.getInstance();

/** 获取 ChatAgent 实例（统一 AI 入口） */
function getChatAgent() {
  const container = getServiceContainer();
  return container.get('chatAgent');
}

/**
 * GET /api/v1/ai/providers
 * 获取可用的 AI 提供商列表
 */
router.get('/providers', asyncHandler(async (req, res) => {
  const providers = [
    { id: 'google', label: 'Google Gemini', defaultModel: 'gemini-2.0-flash' },
    { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o' },
    { id: 'deepseek', label: 'DeepSeek', defaultModel: 'deepseek-chat' },
    { id: 'claude', label: 'Claude', defaultModel: 'claude-3-5-sonnet-20240620' },
    { id: 'ollama', label: 'Ollama', defaultModel: 'llama3' },
    { id: 'mock', label: 'Mock (测试)', defaultModel: 'mock-l3' },
  ];

  res.json({ success: true, data: providers });
}));

/**
 * GET /api/v1/ai/config
 * 获取当前 AI 配置
 */
router.get('/config', asyncHandler(async (req, res) => {
  const container = getServiceContainer();
  const p = container.singletons?.aiProvider;
  res.json({
    success: true,
    data: {
      provider: p?.name || '',
      model: p?.model || '',
    },
  });
}));

/**
 * POST /api/v1/ai/config
 * 更新 AI 配置（切换提供商/模型）
 */
router.post('/config', asyncHandler(async (req, res) => {
  const { provider, model } = req.body;

  if (!provider || typeof provider !== 'string') {
    throw new ValidationError('provider is required');
  }

  // 创建新的 provider 实例验证配置有效
  let newProvider;
  try {
    newProvider = createProvider({
      provider: provider.toLowerCase(),
      model: model || undefined,
    });
  } catch (error) {
    throw new ValidationError(`Invalid provider: ${error.message}`);
  }

  // 同步到 DI 容器，使 SearchEngine / Agent / IndexingPipeline 等也使用新 provider
  try {
    const container = getServiceContainer();
    container.singletons.aiProvider = newProvider;
    logger.info('AI provider synced to DI container', { provider: provider.toLowerCase(), model: newProvider.model });
  } catch (err) {
    logger.debug('DI container 同步 AI provider 失败', { error: err.message });
  }

  res.json({
    success: true,
    data: {
      provider: provider.toLowerCase(),
      model: newProvider.model,
      name: newProvider.name,
    },
  });
}));

/**
 * POST /api/v1/ai/summarize
 * AI 摘要生成
 */
router.post('/summarize', asyncHandler(async (req, res) => {
  const { code, language } = req.body;

  if (!code) {
    throw new ValidationError('code is required');
  }

  const chatAgent = getChatAgent();
  const result = await chatAgent.executeTool('summarize_code', { code, language });

  if (result?.error) {
    throw new ValidationError(result.error);
  }

  res.json({ success: true, data: result });
}));

/**
 * POST /api/v1/ai/translate
 * AI 翻译（中文 → 英文）
 */
router.post('/translate', asyncHandler(async (req, res) => {
  const { summary, usageGuide } = req.body;

  if (!summary && !usageGuide) {
    return res.json({
      success: true,
      data: { summary_en: '', usageGuide_en: '' },
    });
  }

  try {
    const chatAgent = getChatAgent();
    const result = await chatAgent.executeTool('ai_translate', { summary, usageGuide });

    if (result?.error) {
      // AI 不可用，降级返回原文
      logger.warn('AI translate tool returned error', { error: result.error });
      return res.json({
        success: true,
        data: { summary_en: summary || '', usageGuide_en: usageGuide || '' },
        warning: result.error,
      });
    }

    res.json({ success: true, data: result });
  } catch (err) {
    logger.warn('AI translate failed, returning original text', { error: err.message });
    res.json({
      success: true,
      data: { summary_en: summary || '', usageGuide_en: usageGuide || '' },
      warning: `Translation failed: ${err.message}`,
    });
  }
}));

/**
 * POST /api/v1/ai/chat
 * AI 对话（RAG 模式，结合项目知识库）
 */
router.post('/chat', asyncHandler(async (req, res) => {
  const { prompt, history = [] } = req.body;

  if (!prompt) {
    throw new ValidationError('prompt is required');
  }

  const chatAgent = getChatAgent();
  const result = await chatAgent.execute(prompt, { history });

  res.json({
    success: true,
    data: {
      reply: result.reply,
      hasContext: result.hasContext,
      toolCalls: result.toolCalls,
    },
  });
}));

/**
 * POST /api/v1/ai/agent/tool
 * 程序化直接调用 Agent 工具（跳过 ReAct 循环）
 * Body: { tool: string, params: object }
 */
router.post('/agent/tool', asyncHandler(async (req, res) => {
  const { tool, params = {} } = req.body;

  if (!tool) {
    throw new ValidationError('tool name is required');
  }

  const chatAgent = getChatAgent();
  const result = await chatAgent.executeTool(tool, params);

  res.json({ success: true, data: result });
}));

/**
 * POST /api/v1/ai/agent/task
 * 执行预定义任务流（查重提交 / 批量关系发现 / 批量补全）
 * Body: { task: string, params: object }
 */
router.post('/agent/task', asyncHandler(async (req, res) => {
  const { task, params = {} } = req.body;

  if (!task) {
    throw new ValidationError('task name is required');
  }

  const chatAgent = getChatAgent();
  const result = await chatAgent.runTask(task, params);

  res.json({ success: true, data: result });
}));

/**
 * GET /api/v1/ai/agent/capabilities
 * 获取 Agent 能力清单（工具列表 + 任务列表）
 */
router.get('/agent/capabilities', asyncHandler(async (req, res) => {
  const chatAgent = getChatAgent();
  res.json({ success: true, data: chatAgent.getCapabilities() });
}));

/**
 * POST /api/v1/ai/format-usage-guide
 * 格式化 usageGuide 文本（纯文本处理，不涉及 AI 调用）
 * 注：虽非 AI 功能，但前端从 /ai/ 路径调用，保留以维持 API 兼容
 */
router.post('/format-usage-guide', asyncHandler(async (req, res) => {
  const { text, lang = 'cn' } = req.body;

  if (!text) {
    return res.json({ success: true, data: { formatted: '' } });
  }

  // 简单文本格式化处理
  let formatted = text.trim();
  // 确保段落间有空行
  formatted = formatted.replace(/\n{3,}/g, '\n\n');
  // 确保代码块格式
  formatted = formatted.replace(/```(\w+)?\n/g, '\n```$1\n');

  res.json({ success: true, data: { formatted } });
}));

export default router;
