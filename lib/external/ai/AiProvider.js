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

    // ── CircuitBreaker 状态 ──
    this._circuitState = 'CLOSED';       // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
    this._circuitFailures = 0;           // 连续失败计数
    this._circuitThreshold = config.circuitThreshold || 5;  // 触发熔断的连续失败次数
    this._circuitOpenedAt = 0;           // 熔断打开时间
    this._circuitCooldownMs = 30_000;    // 初始冷却 30 秒
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
   * 是否支持原生结构化函数调用（非文本解析）
   * 子类（如 GoogleGeminiProvider）覆盖返回 true
   * @returns {boolean}
   */
  get supportsNativeToolCalling() {
    return false;
  }

  /**
   * 带工具声明的结构化对话 — 原生函数调用 API
   *
   * 支持原生函数调用的 Provider（Gemini / OpenAI / Claude）覆盖此方法,
   * 返回结构化 functionCall 而非文本，ChatAgent 据此跳过正则解析。
   *
   * 默认实现降级为 chat()，由 ChatAgent 进行文本解析。
   *
   * 统一消息格式 (Provider-Agnostic):
   *   - { role: 'user', content: 'text' }
   *   - { role: 'assistant', content: 'text or null', toolCalls: [{id, name, args}] }
   *   - { role: 'tool', toolCallId: 'id', name: 'tool_name', content: 'result string' }
   *
   * @param {string} prompt — 用户消息（仅在 messages 为空时使用）
   * @param {object} opts
   * @param {Array} opts.messages — 统一格式消息历史
   * @param {Array} opts.toolSchemas — [{name, description, parameters}]
   * @param {string} opts.toolChoice — 'auto' | 'required' | 'none'
   * @param {string} [opts.systemPrompt] — 系统指令
   * @param {number} [opts.temperature=0.7]
   * @param {number} [opts.maxTokens=8192]
   * @returns {Promise<{text: string|null, functionCalls: Array<{id: string, name: string, args: object}>|null}>}
   */
  async chatWithTools(prompt, opts = {}) {
    // 默认降级: 忽略 tools/toolChoice，走纯文本 chat()
    const messages = opts.messages || [];
    const history = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' }));
    const text = await this.chat(prompt, {
      history,
      systemPrompt: opts.systemPrompt,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
    });
    return { text, functionCalls: null };
  }

  /**
   * 从源码文件批量提取 Recipe 结构（AI 驱动）
   * 默认实现使用 chat() + 标准提示词；子类可覆盖以使用专用 API
   * @param {string} targetName - SPM Target 名称
   * @param {Array<{name:string,content:string}>} filesContent
   * @param {object} [options] - 可选参数
   * @param {string} [options.skillReference] - 业界最佳实践参考内容（来自 Skills）
   * @returns {Promise<Array<object>>}
   */
  async extractRecipes(targetName, filesContent, options = {}) {
    const prompt = this._buildExtractPrompt(targetName, filesContent, options);
    const response = await this.chat(prompt, { temperature: 0.3, maxTokens: 32768 });
    if (!response || response.trim().length === 0) {
      this._log('warn', `[extractRecipes] AI returned empty response for target: ${targetName}`);
      return [];
    }
    const parsed = this.extractJSON(response, '[', ']');
    if (!Array.isArray(parsed)) {
      // JSON 解析失败 — 记录原始响应尾部用于调试（截断诊断更有用）
      const tail = response.length > 300 ? response.substring(response.length - 300) : response;
      this._log('warn', `[extractRecipes] JSON parse failed for target: ${targetName}, response length: ${response.length}, tail: ${tail}`);
      return [];
    }
    if (parsed.length === 0) {
      this._log('info', `[extractRecipes] AI returned empty array for target: ${targetName}`);
    }
    return parsed;
  }

  /**
   * 内部日志辅助（子类可通过 this.logger 覆盖）
   */
  _log(level, message) {
    try {
      if (this.logger && typeof this.logger[level] === 'function') {
        this.logger[level](message);
      } else {
        console[level === 'warn' ? 'warn' : 'log'](message);
      }
    } catch { /* best effort */ }
  }

  /**
   * 构建 extractRecipes 标准提示词（语言自适应 + Skill 增强）
   */
  _buildExtractPrompt(targetName, filesContent, options = {}) {
    const files = filesContent.map(f => `--- FILE: ${f.name} ---\n${f.content}`).join('\n\n');

    // 检测文件主要语言
    const langProfile = this._detectLanguageProfile(filesContent);

    // Skill 业界参考标准注入
    const skillSection = options.skillReference
      ? `\n# Industry Best Practice Reference\nUse the following industry standards as quality benchmarks. Extracted recipes should align with these practices when applicable:\n\n${options.skillReference.substring(0, 2000)}\n`
      : '';

    // AST 代码结构分析注入 — 帮助 AI 理解继承体系、设计模式、代码规模
    const astSection = options.astContext
      ? `\n# Code Structure Analysis (AST)\nThe following is a Tree-sitter AST analysis of the project. Use this structural context to better understand class hierarchies, design patterns, and code quality when extracting recipes:\n\n${options.astContext.substring(0, 3000)}\n`
      : '';

    return `# Role
You are a ${langProfile.role} extracting production-quality reusable code patterns.

# Goal
Extract meaningful, complete code patterns from "${targetName}". Each recipe must provide real value to a developer.
${skillSection}${astSection}

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
2. **knowledgeType** (string): One of: "code-standard", "code-pattern", "architecture", "best-practice", "code-relation", "inheritance", "call-chain", "data-flow", "module-dependency", "boundary-constraint", "code-style", "solution", "anti-pattern".
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
   * 支持截断修复：当 AI 输出被 token 限制截断时，尝试关闭未完成的 JSON 结构
   */
  extractJSON(text, openChar = '{', closeChar = '}') {
    if (!text) return null;
    // 去除 markdown 代码块
    const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
    const start = cleaned.indexOf(openChar);
    if (start === -1) return null;
    const end = cleaned.lastIndexOf(closeChar);

    // 1. 常规路径：找到完整的 JSON 边界
    if (end > start) {
      try {
        let jsonStr = cleaned.slice(start, end + 1);
        jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(jsonStr);
      } catch {
        // 常规解析失败，尝试截断修复
      }
    }

    // 2. 截断修复：AI 输出被 token 限制截断，尝试回收已完成的条目
    if (openChar === '[') {
      return this._repairTruncatedArray(cleaned.slice(start));
    }
    return null;
  }

  /**
   * 修复被截断的 JSON 数组 — 回收已完成的对象
   * 策略 1（主路径）: 字符级解析找到最后一个完整的顶层 {...} 对象
   * 策略 2（回退路径）: 正则 + 渐进 JSON.parse 尝试（应对代码段中未转义引号导致 inString 追踪失效）
   */
  _repairTruncatedArray(text) {
    // ── 策略 1：字符级深度追踪 ──
    const charResult = this._repairByCharTracking(text);
    if (charResult) return charResult;

    // ── 策略 2：正则回退 — 找所有 "}," 或 "}\n" 位置，从后向前逐一尝试 JSON.parse ──
    const regexResult = this._repairByRegexFallback(text);
    if (regexResult) return regexResult;

    return null;
  }

  /**
   * 字符级深度追踪修复（原逻辑，处理标准 JSON）
   */
  _repairByCharTracking(text) {
    let depth = 0;
    let inString = false;
    let escape = false;
    let lastCompleteObjEnd = -1;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        // depth === 1 表示回到数组顶层，刚关闭了一个完整对象
        if (depth === 1 && ch === '}') {
          lastCompleteObjEnd = i;
        }
      }
    }

    if (lastCompleteObjEnd === -1) return null;
    return this._tryRepairAt(text, lastCompleteObjEnd);
  }

  /**
   * 正则回退修复 — 不依赖 inString 追踪
   * 寻找所有 "},\s*{" 或 "}\s*]" 边界，从后往前尝试 JSON.parse
   */
  _repairByRegexFallback(text) {
    // 收集所有 "}" 后跟 "," 或空白的位置（可能是对象边界）
    const candidates = [];
    const re = /\}[\s,]*(?=\s*[\[{]|$)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      candidates.push(m.index); // "}" 的位置
    }

    // 从后往前尝试
    for (let i = candidates.length - 1; i >= 0; i--) {
      const result = this._tryRepairAt(text, candidates[i]);
      if (result) return result;
    }
    return null;
  }

  /**
   * 在指定位置截断并尝试闭合 JSON 数组
   */
  _tryRepairAt(text, endPos) {
    let repaired = text.slice(0, endPos + 1);
    // 去掉尾逗号
    repaired = repaired.replace(/,\s*$/, '');
    repaired += ']';
    // 修复尾逗号（对象/数组末尾多余逗号）
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');

    try {
      const result = JSON.parse(repaired);
      if (Array.isArray(result) && result.length > 0) {
        this._log('warn', `[extractJSON] Repaired truncated JSON array: recovered ${result.length} items from truncated response`);
        return result;
      }
    } catch { /* this position didn't work, try next */ }
    return null;
  }

  /**
   * 指数退避重试 + 熔断器（受 Cline 三级错误恢复启发）
   *
   * 熔断器三态:
   *   CLOSED  — 正常工作，计数连续失败
   *   OPEN    — 连续 N 次失败，直接拒绝请求（快速失败），持续 cooldownMs
   *   HALF_OPEN — 冷却期后尝试一次，成功则恢复，失败则重新 OPEN
   *
   * 这避免了 AI 服务宕机时无意义的重试风暴。
   */
  async _withRetry(fn, retries = this.maxRetries, baseDelay = 2000) {
    // ── 熔断器检查 ──
    if (this._circuitState === 'OPEN') {
      const elapsed = Date.now() - (this._circuitOpenedAt || 0);
      if (elapsed < (this._circuitCooldownMs || 30000)) {
        const err = new Error(`AI 服务熔断中 (连续 ${this._circuitFailures} 次失败)，${Math.ceil(((this._circuitCooldownMs || 30000) - elapsed) / 1000)}s 后恢复`);
        err.code = 'CIRCUIT_OPEN';
        throw err;
      }
      // 冷却期结束 → HALF_OPEN
      this._circuitState = 'HALF_OPEN';
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await fn();
        // 成功 → 重置熔断器
        this._circuitFailures = 0;
        this._circuitState = 'CLOSED';
        return result;
      } catch (err) {
        // 连接超时提示代理配置
        if (err.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' || err.code === 'UND_ERR_CONNECT_TIMEOUT') {
          const hasProxy = process.env.ASD_AI_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY;
          if (!hasProxy) {
            err.message += ' — 💡 可能需要配置代理: export HTTPS_PROXY=http://127.0.0.1:7890';
          }
        }
        const isRetryable = err.status === 429 || err.status === 503 || err.code === 'ECONNRESET';
        if (attempt >= retries || !isRetryable) {
          // 累计熔断失败计数
          this._circuitFailures = (this._circuitFailures || 0) + 1;
          if (this._circuitFailures >= (this._circuitThreshold || 5)) {
            this._circuitState = 'OPEN';
            this._circuitOpenedAt = Date.now();
            // 逐级递增冷却时间: 30s → 60s → 120s（最大 5 分钟）
            this._circuitCooldownMs = Math.min(
              (this._circuitCooldownMs || 15000) * 2,
              300_000,
            );
            this._log?.('warn', `[CircuitBreaker] OPEN — ${this._circuitFailures} consecutive failures, cooldown ${this._circuitCooldownMs / 1000}s`);
          }
          throw err;
        }
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
}

export default AiProvider;
