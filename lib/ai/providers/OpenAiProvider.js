const AiProvider = require('../AiProvider');
const { parseJsonArray, parseJsonObject } = require('../jsonParse');

/**
 * OpenAI 兼容的 AI Provider (支持 OpenAI, DeepSeek 等)
 */
class OpenAiProvider extends AiProvider {
  constructor(config) {
  super(config);
  this.apiKey = config.apiKey;
  this.modelName = config.model || 'gpt-4o';
  this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  
  // 处理代理逻辑 - 使用客户端级别的代理而非全局
  this.isDeepSeek = /deepseek/i.test(this.baseUrl);
  const isHttps = /^https:/i.test(this.baseUrl);
  const isOpenAi = /openai/i.test(this.baseUrl);
  const isOllama = /ollama/i.test(this.baseUrl);
  const providerProxyHttp = this.isDeepSeek
    ? process.env.ASD_DEEPSEEK_PROXY_HTTP
    : isOpenAi
    ? process.env.ASD_OPENAI_PROXY_HTTP
    : isOllama
      ? process.env.ASD_OLLAMA_PROXY_HTTP
      : process.env.ASD_OPENAI_PROXY_HTTP;
  const providerProxyHttps = this.isDeepSeek
    ? process.env.ASD_DEEPSEEK_PROXY_HTTPS
    : isOpenAi
    ? process.env.ASD_OPENAI_PROXY_HTTPS
    : isOllama
      ? process.env.ASD_OLLAMA_PROXY_HTTPS
      : process.env.ASD_OPENAI_PROXY_HTTPS;
  const schemeProxyFromConfig = isHttps ? config.proxyHttpsUrl : config.proxyHttpUrl;
  const schemeProxyFromEnv = isHttps ? providerProxyHttps : providerProxyHttp;
  this.proxyUrl = schemeProxyFromConfig || config.proxyUrl || schemeProxyFromEnv || process.env.https_proxy || process.env.http_proxy;
  this.dispatcher = null;

  if (this.proxyUrl) {
    try {
    const { ProxyAgent } = require('undici');
    this.dispatcher = new ProxyAgent(this.proxyUrl);
    console.log(`[AI] 为 ${this.baseUrl} 启用代理: ${this.proxyUrl}`);
    } catch (e) {
    console.warn('[AI] 尝试启用代理失败');
    }
  } else if (this.isDeepSeek) {
    if (process.env.ASD_DEBUG === '1') {
    console.log(`[AI] DeepSeek 将绕过代理直连 API`);
    }
  }
  }

  _isRateLimitError(err) {
  if (!err) return false;
  if (err.status === 429 || err.response?.status === 429) return true;
  const msg = (err.message || err.toString() || '').toLowerCase();
  return /429|rate limit|quota|too many requests/i.test(msg);
  }

  async _withRetry(fn, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
    return await fn();
    } catch (err) {
    const is429 = this._isRateLimitError(err);
    if (is429 && i < retries - 1) {
      const waitTime = delay * Math.pow(2, i); // 指数退避，首轮 2s
      console.warn(`[AI] 触发频率限制 (429)，${Math.round(waitTime / 1000)}s 后进行第 ${i + 1} 次重试...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      continue;
    }
    throw err;
    }
  }
  }

  async _fetch(path, body) {
  const url = `${this.baseUrl}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000); // 增加到 5 分钟超时

  try {
    const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    },
    body: JSON.stringify(body),
    signal: controller.signal
    };
    
    // 如果设置了代理，在请求时指定
    if (this.dispatcher) {
    fetchOptions.dispatcher = this.dispatcher;
    }
    
    const response = await fetch(url, fetchOptions);

    clearTimeout(timeoutId);

    if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`AI Request failed (${response.status}): ${errorData.error?.message || response.statusText}`);
    }

    return response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
    throw new Error('AI Request timed out after 5 minutes. Local model might be too slow.');
    }
    throw err;
  }
  }

  async chat(prompt, history = [], systemInstruction = '') {
  return this._withRetry(async () => {
    const messages = [];
    if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
    }
    
    history.forEach(msg => {
    messages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    });
    });

    messages.push({ role: 'user', content: prompt });

    // 部分模型（如 gpt-5-nano）仅支持 temperature=1
    const temperature = (this.modelName && this.modelName.toLowerCase().includes('nano')) ? 1 : 0.3;
    const result = await this._fetch('/chat/completions', {
    model: this.modelName,
    messages: messages,
    temperature
    });

    return result.choices[0].message.content;
  });
  }

  async summarize(code, language = 'auto') {
  return this._withRetry(async () => {
    const prompt = `
    # Role
    You are an expert iOS architect and senior developer.
    Analyze the following code and generate a structured summary for a knowledge base.
    
    # Goals
    1. Detect the language correctly (objectivec or swift).
    2. Prioritize README or Header files to understand the **public API**.
    3. The \`code\` field MUST be a **standardized usage example** (how to call the API), NOT the implementation.
    4. Use \`<#placeholder#>\` in code for Xcode compatibility.
    
    # Requirements
    - Provide title, summary, and usageGuide in BOTH Chinese (Simplified) and English.
    - Category: [View, Service, Tool, Model, Network, Storage, UI, Utility].
    
    Provide the result in JSON format:
    - title: Concise name (English).
    - title_cn: Concise name (Chinese).
    - summary_cn: Description (Chinese).
    - summary_en: Description (English).
    - trigger: Short shortcut (starts with @).
    - category: One of the above.
    - language: "swift" or "objectivec".
    - tags: Array of tags.
    - usageGuide_cn: Markdown guide (Chinese).
    - usageGuide_en: Markdown guide (English).
    - code: Reusable usage example (with placeholders).

    Code/Context to Analyze:
    ${code}
  `;

    const result = await this.chat(prompt);
    const parsed = parseJsonObject(result);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return { error: 'Failed to parse AI response', raw: result };
  });
  }

  async extractRecipes(targetName, filesContent) {
  return this._withRetry(async () => {
    const targetType = this._detectTargetType(targetName, filesContent);
    const prompt = this._buildExtractPrompt(targetName, filesContent, targetType);

    const result = await this.chat(prompt);
    const parsed = parseJsonArray(result);
    if (Array.isArray(parsed)) return parsed;
    console.error('[AI] extractRecipes JSON 解析失败，返回空数组。原始文本前 500 字符:', result.slice(0, 500));
    return [];
  });
  }

  _buildExtractPrompt(targetName, filesContent, targetType) {
  const base = `
    # Role
    You are a Senior iOS Architect and technical documentation expert.

    # Goal
    Extract high-quality reusable patterns (Snippets) and usage guides (Recipes) from the SPM target: "${targetName}".

    # Guidelines
    1. **Prioritize README.md and Header (.h) files** to identify the public API and standard usage.
    2. The \`code\` field MUST be a **usage example** (how a developer calls the API), NOT internal implementation.
    3. Use \`<#placeholder#>\` in code blocks for Xcode Snippet compatibility.
    4. Provide all textual descriptions in both Chinese (Simplified) and English.
    5. **IMPORTANT**: usageGuide fields MUST use structured format with explicit newlines (\\n) between sections.

    # Output Schema (JSON Array)
    - title: Concise name (English).
    - summary_cn: Description in Chinese (single line).
    - summary_en: Description in English (single line).
    - trigger: Shortcut (starts with @).
    - category: [View, Service, Tool, Model, Network, Storage, UI, Utility].
    - language: "swift" or "objectivec".
    - code: Reusable usage example (with placeholders).
    - headers: Array of full import lines.
    - usageGuide_cn: Structured guide in Chinese. Use format: "何时用：\\n- point1\\n- point2\\n\\n关键点：\\n- point1\\n\\n依赖：\\n- dep1".
    - usageGuide_en: Structured guide in English. Use format: "When to use:\\n- point1\\n- point2\\n\\nKey points:\\n- point1\\n\\nDependencies:\\n- dep1".

    Files Content:
    ${filesContent.map(f => `--- FILE: ${f.name} ---\n${f.content}`).join('\n\n')}
  `;

  const typeHints = this._getTypeHints(targetType);
  return `${base}\n\n${typeHints}`;
  }

  _getTypeHints(targetType) {
  switch (targetType) {
    case 'ui-framework':
    return `
## Target Type: UI Framework
Focus on:
1. View initialization & configuration
2. Lifecycle methods & transitions
3. Gesture handling & user interaction
4. Custom view composition patterns
5. Theme / styling application

For each UI component, extract:
- Initialization code (with placeholders for common properties)
- Configuration example
- Usage in view controller
- Common customizations / subclassing
`;
    case 'network':
    return `
## Target Type: Network Library
Focus on:
1. Request construction (URL, headers, body)
2. Response handling & parsing
3. Error cases & retry strategies
4. Authentication & security
5. Performance (caching, timeout)

For each API endpoint / request type:
- Minimal code example to make a request
- Common variations (parameters, headers)
- Error handling pattern
- Performance tips (cache, timeout values)
`;
    case 'storage':
    return `
## Target Type: Storage / Cache
Focus on:
1. Read/write lifecycle
2. Cache invalidation and TTL
3. Thread-safety patterns
4. Data schema or key conventions

For each storage API:
- Minimal usage snippet
- Common options (policy, scope, namespace)
- Error handling and fallback
`;
    case 'service':
    return `
## Target Type: Service / Manager
Focus on:
1. Service initialization and configuration
2. Core public methods
3. Dependency injection / setup
4. Error handling and callbacks

For each service:
- Minimal usage example
- Setup / teardown steps
- Common integration patterns
`;
    case 'utility':
    return `
## Target Type: Utility / Helper
Focus on:
1. Pure functions and helpers
2. Extensions and convenience wrappers
3. Input validation and edge cases

For each utility:
- Minimal usage example
- Common variants
- Typical pitfalls
`;
    default:
    return '';
  }
  }

  _detectTargetType(targetName, filesContent) {
  const text = [targetName, ...filesContent.map(f => `${f.name}\n${f.content}`)]
    .join('\n')
    .toLowerCase();

  const score = {
    'ui-framework': 0,
    network: 0,
    storage: 0,
    service: 0,
    utility: 0
  };

  const bump = (type, keywords) => {
    for (const k of keywords) {
    if (text.includes(k)) score[type] += 1;
    }
  };

  bump('ui-framework', ['ui', 'view', 'uikit', 'layout', 'controller', 'gesture', 'theme']);
  bump('network', ['network', 'http', 'request', 'response', 'api', 'websocket']);
  bump('storage', ['storage', 'cache', 'database', 'db', 'persist', 'disk', 'userdefaults']);
  bump('service', ['service', 'manager', 'coordinator', 'provider', 'module']);
  bump('utility', ['util', 'utility', 'helper', 'extension', 'formatter']);

  let best = 'generic';
  let bestScore = 0;
  for (const [type, val] of Object.entries(score)) {
    if (val > bestScore) {
    bestScore = val;
    best = type;
    }
  }

  return bestScore > 0 ? best : 'generic';
  }

  async embed(text) {
  return this._withRetry(async () => {
    const isArray = Array.isArray(text);
    const input = isArray ? text : [text];
    
    // DeepSeek 和 Ollama 不支持 embedding API，需要返回空向量以使用关键词搜索降级
    if (this.baseUrl && (this.baseUrl.includes('deepseek') || this.baseUrl.includes('ollama'))) {
    const provider = this.baseUrl.includes('deepseek') ? 'DeepSeek' : 'Ollama';
    if (process.env.ASD_DEBUG === '1') {
      console.warn(`[AI] ⚠️  ${provider} 不支持 Embedding API，将使用纯关键词搜索`);
    }
    return isArray ? [] : [];
    }
    
    try {
    const result = await this._fetch('/embeddings', {
      model: this.config.embeddingModel || 'text-embedding-3-small',
      input: input
    });

    if (isArray) {
      return result.data.map(d => d.embedding);
    } else {
      return result.data[0].embedding;
    }
    } catch (err) {
    // 如果 embedding 失败，返回空以触发关键词搜索降级
    if (process.env.ASD_DEBUG === '1') {
      console.warn('[AI] ⚠️  Embedding 请求失败，将使用纯关键词搜索:', err.message);
    }
    throw err;
    }
  });
  }
}

module.exports = OpenAiProvider;
