const Paths = require('../../../lib/infrastructure/config/Paths.js');

function registerAiRoutes(app, ctx) {
  const { projectRoot, path, fs, AiFactory, specRepository } = ctx;

  // API: 获取可用的 AI 提供商列表（供前端切换）
  app.get('/api/ai/providers', (req, res) => {
  try {
    const list = [
    { id: 'google', label: 'Google Gemini', defaultModel: 'gemini-2.0-flash' },
    { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o' },
    { id: 'deepseek', label: 'DeepSeek', defaultModel: 'deepseek-chat' },
    { id: 'claude', label: 'Claude', defaultModel: 'claude-3-5-sonnet-20240620' },
    { id: 'ollama', label: 'Ollama', defaultModel: 'llama3' },
    { id: 'mock', label: 'Mock (测试)', defaultModel: 'mock-l3' }
    ];
    res.json(list);
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
  });

  // API: 更新 AI 配置（写入 boxspec.ai，后续 getProvider 会优先读此配置）
  app.post('/api/ai/config', (req, res) => {
  try {
    const { provider, model } = req.body;
    if (!provider || typeof provider !== 'string') {
    return res.status(400).json({ error: 'provider is required' });
    }
    const rootSpecPath = Paths.getProjectSpecPath(projectRoot);
    let spec = specRepository.readSpecFile(rootSpecPath);
    if (!spec) spec = { list: [] };
    const finalModel = model && typeof model === 'string' ? model : AiFactory._defaultModel(provider);
    spec.ai = { provider: provider.toLowerCase(), model: finalModel };
    specRepository.writeSpecFile(rootSpecPath, spec);
    res.json({ provider: spec.ai.provider, model: spec.ai.model });
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
  });

  // API: AI 摘要
  app.post('/api/ai/summarize', async (req, res) => {
  try {
    const { code, language } = req.body;
    const ai = await AiFactory.getProvider(projectRoot);
    const result = await ai.summarize(code, language);
    res.json(result);
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
  });

  // API: 格式化 usageGuide
  app.post('/api/ai/format-usage-guide', (req, res) => {
  try {
    const { text, lang = 'cn' } = req.body;
    if (!text) {
    return res.json({ formatted: '' });
    }
    
    const formatter = require('../../../lib/candidate/usageGuideFormatter');
    const formatted = formatter.formatUsageGuide(text, lang);
    
    res.json({ formatted });
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
  });

  // API: AI 翻译（中文 → 英文，用于 Recipe summary/usageGuide）
  app.post('/api/ai/translate', async (req, res) => {
  try {
    const { summary, usageGuide } = req.body;
    if (!summary && !usageGuide) {
    return res.json({ summary_en: '', usageGuide_en: '' });
    }
    const ai = await AiFactory.getProvider(projectRoot);
    const sys = 'You are a technical translator. Translate the following from Chinese to English. Keep technical terms (e.g. API names, class names) unchanged. Return ONLY valid JSON: { "summary_en": "...", "usageGuide_en": "..." }. Use empty string for missing input. Preserve Markdown in usageGuide.';
    const parts = [];
    if (summary) parts.push(`summary (摘要):\n${summary}`);
    if (usageGuide) parts.push(`usageGuide (使用指南):\n${usageGuide}`);
    const prompt = parts.join('\n\n');
    const text = await ai.chat(prompt, [], sys);
    const raw = (text || '').replace(/```json?\s*/gi, '').replace(/```\s*$/g, '').trim();
    let out = { summary_en: '', usageGuide_en: '' };
    try {
    const parsed = JSON.parse(raw);
    if (parsed.summary_en != null) out.summary_en = String(parsed.summary_en);
    if (parsed.usageGuide_en != null) out.usageGuide_en = String(parsed.usageGuide_en);
    } catch (_) {
    // 若解析失败，尝试提取第一段作为 summary_en
    if (summary) out.summary_en = raw.split('\n')[0] || summary;
    }
    res.json(out);
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
  });

  // API: AI 聊天
  app.post('/api/ai/chat', async (req, res) => {
  try {
    const { prompt, history } = req.body;
    
    // 1. 获取所有数据
    const rootSpecPath = Paths.getProjectSpecPath(projectRoot);
    const fullSpec = specRepository.readSpecFile(rootSpecPath);
    const allSnippets = fullSpec.list || [];
    const recipesDir = Paths.getProjectRecipesPath(projectRoot, fullSpec);

    // 延迟加载避免循环依赖
    const contextModule = require('../../../lib/context');
    if (!contextModule || !contextModule.getInstance) {
    return res.status(503).json({ error: 'Context service not available' });
    }
    const contextService = contextModule.getInstance(projectRoot);
    const aiProvider = await AiFactory.getProvider(projectRoot);

    let filteredSnippets = [];
    let filteredRecipes = [];

    if (aiProvider) {
    try {
      const semanticResults = await contextService.search(prompt, { limit: 5, filter: { type: 'recipe' } });
      
      semanticResults.forEach(res => {
      if (res.metadata?.type === 'recipe') {
        const name = res.metadata?.name || res.metadata?.sourcePath || res.id;
        filteredRecipes.push(`--- RECIPE (Semantic): ${name} ---\n${res.content || ''}`);
      }
      });
    } catch (e) {
      console.warn('[Chat] Semantic search failed, falling back to keyword search:', e.message || e);
      const stats = await contextService.getStats();
      if (stats && stats.count === 0) {
      console.warn('[Chat] 提示: 运行 asd embed 可构建语义索引以启用语义检索');
      }
    }
    }

    // 2. 关键词预过滤 (回退或补全)
    if (filteredRecipes.length === 0) {
    const queryKeywords = prompt.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(w => w.length > 1);
    
    filteredSnippets = allSnippets.filter(s => {
      const text = `${s.title} ${s.summary} ${s.trigger} ${s.completion || ''}`.toLowerCase();
      return queryKeywords.some(kw => text.includes(kw));
    }).slice(0, 10);

    if (fs.existsSync(recipesDir)) {
      const recipeFiles = fs.readdirSync(recipesDir).filter(f => f.endsWith('.md') && f !== 'README.md');
      filteredRecipes = recipeFiles.filter(file => {
      const text = file.toLowerCase();
      return queryKeywords.some(kw => text.includes(kw));
      }).map(file => {
      return `--- RECIPE: ${file} ---\n${fs.readFileSync(path.join(recipesDir, file), 'utf8')}`;
      }).slice(0, 3);
    }
    }

    let readmeContent = '';
    const readmePath = path.join(recipesDir, 'README.md');
    if (fs.existsSync(readmePath)) {
    readmeContent = `[CORE PROJECT GUIDELINE]\n${fs.readFileSync(readmePath, 'utf8')}\n\n`;
    }

    const systemInstruction = `
    You are an expert iOS Development Assistant for this project.
    
    [CORE PROJECT GUIDELINE]
    ${readmeContent}
    
    [RELEVANT SNIPPETS]
    ${filteredSnippets.length > 0 ? filteredSnippets.map(s => `- ${s.title} (Trigger: ${s.completion || s.trigger}): ${s.summary}`).join('\n') : 'No specific snippets found.'}
    
    [RELEVANT RECIPES]
    ${filteredRecipes.length > 0 ? filteredRecipes.join('\n\n') : 'No specific recipes found.'}
    
    Rules:
    1. If a snippet exists for a task, MUST mention its trigger key.
    2. Prioritize project-specific patterns from RECIPES over general iOS knowledge.
    3. Response should be concise and professional.
    `;

    const result = await aiProvider.chat(prompt, history, systemInstruction);
    res.json({ text: result });
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
  });
}

module.exports = {
  registerAiRoutes,
};
