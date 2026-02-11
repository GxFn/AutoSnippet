/**
 * OpenAiProvider - OpenAI / DeepSeek / Ollama 兼容提供商
 * 使用标准 OpenAI Chat Completions API
 */

import { AiProvider } from '../AiProvider.js';
import Logger from '../../../infrastructure/logging/Logger.js';

const OPENAI_BASE = 'https://api.openai.com/v1';

export class OpenAiProvider extends AiProvider {
  constructor(config = {}) {
    super(config);
    this.name = config.name || 'openai';
    this.model = config.model || 'gpt-4o-mini';
    this.apiKey = config.apiKey || process.env.ASD_OPENAI_API_KEY || '';
    this.baseUrl = config.baseUrl || OPENAI_BASE;
    this.embedModel = config.embedModel || 'text-embedding-3-small';
    this.logger = Logger.getInstance();
  }

  async chat(prompt, context = {}) {
    return this._withRetry(async () => {
      const { history = [], temperature = 0.7, maxTokens = 4096 } = context;
      const messages = [];

      for (const h of history) {
        messages.push({ role: h.role, content: h.content });
      }
      messages.push({ role: 'user', content: prompt });

      const body = {
        model: this.model,
        messages,
        temperature,
        max_tokens: maxTokens,
      };

      const data = await this._post(`${this.baseUrl}/chat/completions`, body);
      return data?.choices?.[0]?.message?.content || '';
    });
  }

  async summarize(code) {
    const prompt = `请对以下代码生成结构化摘要，返回 JSON 格式 {title, description, language, patterns: [], keyAPIs: []}:\n\n${code}`;
    const text = await this.chat(prompt, { temperature: 0.3 });
    return this.extractJSON(text) || { title: '', description: text };
  }

  async embed(text) {
    const texts = Array.isArray(text) ? text : [text];

    try {
      const body = {
        model: this.embedModel,
        input: texts.map(t => t.slice(0, 8000)),
      };

      const data = await this._post(`${this.baseUrl}/embeddings`, body);
      const embeddings = (data?.data || [])
        .sort((a, b) => a.index - b.index)
        .map(d => d.embedding);

      if (embeddings.length === 0) return Array.isArray(text) ? [] : [];
      return Array.isArray(text) ? embeddings : embeddings[0];
    } catch (err) {
      this.logger.warn(`${this.name} embed failed, returning empty`, { error: err.message });
      return Array.isArray(text) ? texts.map(() => []) : [];
    }
  }

  async _post(url, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await this._fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = new Error(`${this.name} API error: ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

export default OpenAiProvider;
