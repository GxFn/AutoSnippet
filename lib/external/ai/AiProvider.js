/**
 * AiProvider - AI 提供商抽象基类
 * 所有具体 Provider 必须实现这3个方法
 */

export class AiProvider {
  constructor(config = {}) {
    this.model = config.model || '';
    this.apiKey = config.apiKey || '';
    this.baseUrl = config.baseUrl || '';
    this.timeout = config.timeout || 300_000; // 5min
    this.maxRetries = config.maxRetries || 3;
    this.name = 'abstract';
  }

  /**
   * 对话 - 发送 prompt + context，返回文本响应
   * @param {string} prompt
   * @param {object} context - {history: [], temperature, maxTokens}
   * @returns {Promise<string>}
   */
  async chat(prompt, context = {}) {
    throw new Error(`${this.name}.chat() not implemented`);
  }

  /**
   * 摘要 - 对代码/文档生成结构化摘要
   * @param {string} code
   * @returns {Promise<object>}
   */
  async summarize(code) {
    throw new Error(`${this.name}.summarize() not implemented`);
  }

  /**
   * 向量嵌入 - 返回浮点数组
   * @param {string|string[]} text
   * @returns {Promise<number[]|number[][]>}
   */
  async embed(text) {
    throw new Error(`${this.name}.embed() not implemented`);
  }

  /**
   * 探测 provider 是否可用（轻量级 API 调用验证连接性）
   * 子类可覆盖实现更具体的探测逻辑
   * @returns {Promise<boolean>}
   */
  async probe() {
    const result = await this.chat('ping', { maxTokens: 16, temperature: 0 });
    return !!result;
  }

  /**
   * 检查是否支持 embedding
   * @returns {boolean}
   */
  supportsEmbedding() {
    return true;
  }

  /**
   * 从源码文件批量提取 Recipe 结构（AI 驱动）
   * 默认实现使用 chat() + 标准提示词；子类可覆盖以使用专用 API
   * @param {string} targetName - SPM Target 名称
   * @param {Array<{name:string,content:string}>} filesContent
   * @returns {Promise<Array<object>>}
   */
  async extractRecipes(targetName, filesContent) {
    const prompt = this._buildExtractPrompt(targetName, filesContent);
    const response = await this.chat(prompt, { temperature: 0.3, maxTokens: 32768 });
    const parsed = this.extractJSON(response, '[', ']');
    return Array.isArray(parsed) ? parsed : [];
  }

  /**
   * 构建 extractRecipes 标准提示词（语言自适应）
   */
  _buildExtractPrompt(targetName, filesContent) {
    const files = filesContent.map(f => `--- FILE: ${f.name} ---\n${f.content}`).join('\n\n');

    // 检测文件主要语言
    const langProfile = this._detectLanguageProfile(filesContent);

    return `# Role
You are a ${langProfile.role} extracting production-quality reusable code patterns.

# Goal
Extract meaningful, complete code patterns from "${targetName}". Each recipe must provide real value to a developer.

# What makes a GOOD recipe
- A **complete function/method** or **logical code block** (10-40 lines typically), NOT individual statements
- Code that demonstrates a **real design pattern**: ${langProfile.patternExamples}
- Code that a developer would actually **copy-paste and adapt** for a new feature

# What makes a BAD recipe (AVOID these)
- Trivial 2-3 line snippets like just a single assignment or import
- Overly generic code that doesn't reflect the file's actual logic
- Breaking a single function into multiple tiny recipes

# Extraction Strategy
For each function/method/class in the file, ask: "Would a developer benefit from having this as a reusable template?" If yes, extract the **complete unit** with its full body.

${langProfile.extractionExamples}

# Rules
1. Each \`code\` field must contain a **complete function/method or logical unit** — include the signature and full body
2. Preserve the file's actual code. Use \`<#placeholder#>\` ONLY for literal strings/values a developer would customize
3. Every recipe must be traceable to real code in the file. Do NOT invent code
4. Include relevant \`headers\` (import/require lines) that the code depends on

# Output (JSON Array)
Each item:
- title (string): Descriptive English name
- summary_cn (string): Chinese description
- summary_en (string): English description
- trigger (string): @shortcut
- category: ${langProfile.categories}
- language: "${langProfile.primaryLanguage}"
- code (string): Complete function/method/class from the file
- headers (string[]): Required import/require lines
- tags (string[]): Search keywords
- usageGuide_cn (string): "何时使用" + "关键要点" (2-3 lines)
- usageGuide_en (string): "When to use" + "Key points" (2-3 lines)

Return ONLY a JSON array. If no meaningful patterns found, return [].

Files Content:
${files}`;
  }

  /**
   * 根据文件扩展名检测语言特征，返回提示词适配参数
   */
  _detectLanguageProfile(filesContent) {
    const extCounts = {};
    for (const f of filesContent) {
      const ext = (f.name || '').split('.').pop()?.toLowerCase() || '';
      extCounts[ext] = (extCounts[ext] || 0) + 1;
    }

    const dominant = Object.entries(extCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    // iOS/macOS (Swift / Objective-C)
    if (['swift', 'm', 'mm', 'h'].includes(dominant)) {
      return {
        primaryLanguage: dominant === 'swift' ? 'swift' : 'objectivec',
        role: 'Senior iOS/macOS Architect',
        patternExamples: 'how to set up a ViewController, configure a TableView with delegate/datasource, build a login UI, handle network responses',
        extractionExamples: `Examples of good extractions:
- Complete \`init\` method with all tabBarItem/navigationItem configuration
- Complete \`viewDidLoad\` with all setup calls
- Complete \`setupUI\` method with subview creation and layout
- Complete UITableViewDataSource implementation
- Complete action handler method (e.g. loginButtonTapped)`,
        categories: 'View | Service | Tool | Model | Network | Storage | UI | Utility',
      };
    }

    // JavaScript / TypeScript
    if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'].includes(dominant)) {
      return {
        primaryLanguage: ['ts', 'tsx'].includes(dominant) ? 'typescript' : 'javascript',
        role: 'Senior Software Engineer',
        patternExamples: 'Express/Koa middleware, React component patterns, service class with dependency injection, data processing pipeline, error handling wrapper, factory/strategy patterns',
        extractionExamples: `Examples of good extractions:
- Complete class with constructor and key methods
- Express route handler with validation and error handling
- Utility function with edge case handling
- React component with hooks and event handlers
- Service method with retries and fallback logic`,
        categories: 'Service | Utility | Middleware | Component | Model | Config | Handler | Route',
      };
    }

    // Python
    if (['py'].includes(dominant)) {
      return {
        primaryLanguage: 'python',
        role: 'Senior Python Engineer',
        patternExamples: 'Django/Flask views, data processing with pandas, async handlers, decorator patterns, class-based services',
        extractionExamples: `Examples of good extractions:
- Complete class with __init__ and key methods
- Decorator factory function
- API endpoint handler with request validation
- Data processing pipeline function
- Context manager implementation`,
        categories: 'Service | Utility | Model | View | Handler | Middleware | Config | Pipeline',
      };
    }

    // Go
    if (['go'].includes(dominant)) {
      return {
        primaryLanguage: 'go',
        role: 'Senior Go Engineer',
        patternExamples: 'HTTP handler with middleware, goroutine patterns, interface implementations, struct methods with error handling',
        extractionExamples: `Examples of good extractions:
- Complete struct with constructor and methods
- HTTP handler function with error propagation
- Middleware function with context usage
- Interface implementation with all required methods`,
        categories: 'Service | Handler | Middleware | Model | Utility | Repository | Config',
      };
    }

    // Kotlin / Java
    if (['kt', 'java'].includes(dominant)) {
      return {
        primaryLanguage: dominant === 'kt' ? 'kotlin' : 'java',
        role: 'Senior Android/Backend Engineer',
        patternExamples: 'Activity/Fragment lifecycle, repository pattern, ViewModel with LiveData, Retrofit service, dependency injection setup',
        extractionExamples: `Examples of good extractions:
- Complete class with constructor and key methods
- Repository with CRUD operations
- ViewModel with state management
- API service interface definition
- Custom view with measurement and drawing`,
        categories: 'View | Service | Repository | Model | Network | Storage | UI | Utility',
      };
    }

    // Rust
    if (['rs'].includes(dominant)) {
      return {
        primaryLanguage: 'rust',
        role: 'Senior Rust Engineer',
        patternExamples: 'trait implementations, error handling with Result, async functions, builder patterns, iterator chains',
        extractionExamples: `Examples of good extractions:
- Complete impl block with key methods
- Trait implementation with all required methods
- Error type definition with From implementations
- Builder pattern struct and methods
- Async function with proper error handling`,
        categories: 'Service | Trait | Model | Handler | Utility | Config | Error | Pipeline',
      };
    }

    // Vue
    if (['vue'].includes(dominant)) {
      return {
        primaryLanguage: 'vue',
        role: 'Senior Frontend Engineer',
        patternExamples: 'Vue component with composition API, composable functions, Vuex/Pinia store modules, router guards',
        extractionExamples: `Examples of good extractions:
- Complete Vue component with setup/template
- Composable function with reactive state
- Store module with actions and getters
- Custom directive implementation`,
        categories: 'Component | Composable | Store | Directive | Service | Utility | Config',
      };
    }

    // Ruby
    if (['rb'].includes(dominant)) {
      return {
        primaryLanguage: 'ruby',
        role: 'Senior Ruby Engineer',
        patternExamples: 'Rails controller actions, model concerns, service objects, background jobs, API serializers',
        extractionExamples: `Examples of good extractions:
- Complete controller with CRUD actions
- Service object with call method
- Model with validations and scopes
- Concern module with included block`,
        categories: 'Controller | Service | Model | Concern | Job | Serializer | Utility | Config',
      };
    }

    // Default / mixed
    return {
      primaryLanguage: dominant || 'unknown',
      role: 'Senior Software Engineer',
      patternExamples: 'design patterns, service abstractions, data flow handling, error management, configuration setup',
      extractionExamples: `Examples of good extractions:
- Complete class/function with full implementation
- Service method with error handling and retries
- Configuration setup with all options
- Data processing pipeline`,
      categories: 'Service | Utility | Model | Handler | Config | Component | Pipeline',
    };
  }

  /**
   * AI 语义字段补全 — 分析候选代码，填补缺失的语义字段
   * @param {Array<object>} candidates - 候选对象数组，每项至少含 {code, language, title?}
   * @returns {Promise<Array<object>>} enriched 候选数组（仅含补全的字段）
   */
  async enrichCandidates(candidates) {
    const prompt = this._buildEnrichPrompt(candidates);
    const response = await this.chat(prompt, { temperature: 0.3 });
    const parsed = this.extractJSON(response, '[', ']');
    return Array.isArray(parsed) ? parsed : [];
  }

  /**
   * 构建 enrichCandidates 提示词
   */
  _buildEnrichPrompt(candidates) {
    const items = candidates.map((c, i) => {
      const existing = [];
      if (c.rationale) existing.push(`rationale: ${c.rationale}`);
      if (c.knowledgeType) existing.push(`knowledgeType: ${c.knowledgeType}`);
      if (c.complexity) existing.push(`complexity: ${c.complexity}`);
      if (c.scope) existing.push(`scope: ${c.scope}`);
      if (c.steps?.length) existing.push(`steps: [${c.steps.length} steps already]`);
      if (c.constraints?.preconditions?.length) existing.push(`preconditions: [${c.constraints.preconditions.length} items]`);
      const existingStr = existing.length > 0 ? `\nAlready filled: ${existing.join(', ')}` : '\nNo semantic fields filled yet.';

      return `--- CANDIDATE #${i + 1} ---
Title: ${c.title || '(untitled)'}
Language: ${c.language || 'unknown'}
Category: ${c.category || ''}
Description: ${c.description || c.summary || ''}
${existingStr}
Code:
${(c.code || '').substring(0, 2000)}`;
    }).join('\n\n');

    return `# Role
You are a Senior Software Architect performing deep semantic analysis on code candidates.

# Goal
For each candidate below, analyze the code and fill in MISSING semantic fields only.
Do NOT overwrite fields that are already filled (listed under "Already filled").

# Fields to Fill (only if missing)

1. **rationale** (string): Why this pattern exists; what design intent or problem it solves. 2-3 sentences.
2. **knowledgeType** (string): One of: "code-standard", "code-pattern", "architecture", "best-practice", "code-relation", "inheritance", "call-chain", "data-flow", "module-dependency", "boundary-constraint", "code-style", "solution".
3. **complexity** (string): "beginner" | "intermediate" | "advanced". Evaluate usage difficulty.
4. **scope** (string): "universal" (reusable anywhere) | "project-specific" (specific to this project) | "target-specific" (specific to one module/target).
5. **steps** (array): Implementation steps. Each: { "title": "Step N title", "description": "What to do", "code": "optional code" }.
6. **constraints** (object): { "preconditions": ["iOS 15+", "需先配置 X", ...], "boundaries": ["Cannot be used with Y"], "sideEffects": ["Modifies global state"] }.

# Output Schema
Return a JSON array with one object per candidate. Each object contains ONLY the fields that were missing and you have now filled.
Include an "index" field (0-based) to match each result to its candidate.

Example:
[
  { "index": 0, "rationale": "...", "steps": [...], "constraints": { "preconditions": [...] } },
  { "index": 1, "knowledgeType": "architecture", "complexity": "advanced" }
]

Return ONLY a JSON array. No markdown, no explanation.

# Candidates

${items}`;
  }

  // ─── 网络 / 代理 ────────────────────────────

  /**
   * 解析当前 Provider 应使用的代理 URL。
   * 优先级（从高到低）:
   *   1. Provider 专属: ASD_{PROVIDER}_PROXY_HTTPS / ASD_{PROVIDER}_PROXY_HTTP
   *   2. 全局 ASD 专属: ASD_AI_PROXY
   *   3. 系统通用: HTTPS_PROXY / HTTP_PROXY / ALL_PROXY
   *
   * Provider 名称映射: google-gemini → GOOGLE, openai → OPENAI, claude → CLAUDE, deepseek → DEEPSEEK
   */
  _resolveProxyUrl() {
    // Provider-specific vars: ASD_GOOGLE_PROXY_HTTPS, ASD_OPENAI_PROXY_HTTPS, etc.
    const tag = (this.name || '')
      .replace(/-gemini$/, '')   // google-gemini → google
      .replace(/-/g, '_')        // 其他连字符 → 下划线
      .toUpperCase();            // google → GOOGLE

    if (tag) {
      const specific = process.env[`ASD_${tag}_PROXY_HTTPS`]
        || process.env[`ASD_${tag}_PROXY_HTTP`];
      if (specific) return specific;
    }

    return process.env.ASD_AI_PROXY
      || process.env.HTTPS_PROXY || process.env.https_proxy
      || process.env.HTTP_PROXY || process.env.http_proxy
      || process.env.ALL_PROXY || process.env.all_proxy
      || '';
  }

  /**
   * 代理感知的 fetch — 自动检测代理并使用 undici ProxyAgent。
   * 子类的 _post() 应调用此方法替代全局 fetch()。
   */
  async _fetch(url, options = {}) {
    const proxyUrl = this._resolveProxyUrl();

    if (proxyUrl) {
      try {
        const undici = await import('undici');
        options.dispatcher = new undici.ProxyAgent(proxyUrl);
        return await undici.fetch(url, options);
      } catch {
        // undici 不可用，fallback 到全局 fetch
      }
    }
    return globalThis.fetch(url, options);
  }

  // ─── 工具方法 ─────────────────────────────

  /**
   * 从 LLM 响应提取 JSON (extractJSON kept below)
   */
  extractJSON(text, openChar = '{', closeChar = '}') {
    if (!text) return null;
    // 去除 markdown 代码块
    const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
    const start = cleaned.indexOf(openChar);
    const end = cleaned.lastIndexOf(closeChar);
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      let jsonStr = cleaned.slice(start, end + 1);
      // 修复尾逗号
      jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }

  /**
   * 指数退避重试
   */
  async _withRetry(fn, retries = this.maxRetries, baseDelay = 2000) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        // 连接超时提示代理配置
        if (err.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' || err.code === 'UND_ERR_CONNECT_TIMEOUT') {
          const hasProxy = process.env.ASD_AI_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY;
          if (!hasProxy) {
            err.message += ' — 💡 可能需要配置代理: export HTTPS_PROXY=http://127.0.0.1:7890';
          }
        }
        const isRetryable = err.status === 429 || err.status === 503 || err.code === 'ECONNRESET';
        if (attempt >= retries || !isRetryable) throw err;
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
}

export default AiProvider;
