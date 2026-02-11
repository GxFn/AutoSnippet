/**
 * GoogleGeminiProvider - Google Gemini AI 提供商
 * 直接调用 REST API（不依赖 SDK）
 */

import { AiProvider } from '../AiProvider.js';
import Logger from '../../../infrastructure/logging/Logger.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const EMBED_MODEL = 'models/gemini-embedding-001';

export class GoogleGeminiProvider extends AiProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'google-gemini';
    this.model = config.model || 'gemini-2.0-flash';
    this.apiKey = config.apiKey || process.env.ASD_GOOGLE_API_KEY || '';
    this.logger = Logger.getInstance();
  }

  async chat(prompt, context = {}) {
    return this._withRetry(async () => {
      const { history = [], temperature = 0.7, maxTokens = 8192 } = context;
      const contents = [];

      for (const h of history) {
        contents.push({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] });
      }
      contents.push({ role: 'user', parts: [{ text: prompt }] });

      const body = {
        contents,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      };

      const url = `${GEMINI_BASE}/models/${this.model}:generateContent?key=${this.apiKey}`;
      const data = await this._post(url, body);
      return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    });
  }

  async summarize(code) {
    const prompt = `请对以下代码生成结构化摘要，返回 JSON 格式 {title, description, language, patterns: [], keyAPIs: []}:\n\n${code}`;
    const text = await this.chat(prompt, { temperature: 0.3 });
    return this.extractJSON(text) || { title: '', description: text };
  }

  async embed(text) {
    const texts = Array.isArray(text) ? text : [text];
    const results = [];

    for (let i = 0; i < texts.length; i += 100) {
      const batch = texts.slice(i, i + 100);
      const requests = batch.map(t => ({
        model: EMBED_MODEL,
        content: { parts: [{ text: t.slice(0, 8000) }] },
      }));

      const url = `${GEMINI_BASE}/${EMBED_MODEL}:batchEmbedContents?key=${this.apiKey}`;
      const data = await this._post(url, { requests });
      if (data?.embeddings) {
        results.push(...data.embeddings.map(e => e.values));
      }
    }

    return Array.isArray(text) ? results : results[0] || [];
  }

  async _post(url, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await this._fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = new Error(`Gemini API error: ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

export default GoogleGeminiProvider;
