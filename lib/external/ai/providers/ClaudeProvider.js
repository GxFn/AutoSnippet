/**
 * ClaudeProvider - Anthropic Claude AI 提供商
 */

import { AiProvider } from '../AiProvider.js';
import Logger from '../../../infrastructure/logging/Logger.js';

const CLAUDE_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

export class ClaudeProvider extends AiProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'claude';
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.apiKey = config.apiKey || process.env.ASD_CLAUDE_API_KEY || '';
    this.maxRetries = 0; // Claude 不做重试
    this.logger = Logger.getInstance();
  }

  async chat(prompt, context = {}) {
    const { history = [], temperature = 0.7, maxTokens = 4096 } = context;
    const messages = [];

    for (const h of history) {
      messages.push({ role: h.role, content: h.content });
    }
    messages.push({ role: 'user', content: prompt });

    const body = {
      model: this.model,
      messages,
      max_tokens: maxTokens,
      temperature,
    };

    const data = await this._post(`${CLAUDE_BASE}/messages`, body);
    const textBlock = (data?.content || []).find(c => c.type === 'text');
    return textBlock?.text || '';
  }

  async summarize(code) {
    const prompt = `请对以下代码生成结构化摘要，返回 JSON 格式 {title, description, language, patterns: [], keyAPIs: []}:\n\n${code}`;
    const text = await this.chat(prompt, { temperature: 0.3 });
    return this.extractJSON(text) || { title: '', description: text };
  }

  async embed(_text) {
    // Claude 不支持嵌入 API，返回空数组触发降级
    return [];
  }

  supportsEmbedding() {
    return false;
  }

  async _post(url, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await this._fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = new Error(`Claude API error: ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

export default ClaudeProvider;
