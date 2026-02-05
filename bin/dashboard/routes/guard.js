function registerGuardRoutes(app, ctx) {
  const { projectRoot, AiFactory } = ctx;

  // API: Guard 规则表
  app.get('/api/guard/rules', (req, res) => {
  try {
    const guardRules = require('../../../lib/guard/guardRules');
    const data = guardRules.getGuardRules(projectRoot);
    res.json(data);
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
  });

  // API: 新增或更新一条 Guard 规则（Dashboard / AI 写入规则）
  app.post('/api/guard/rules', (req, res) => {
  try {
    const { ruleId, message, severity, pattern, languages, note, dimension } = req.body;
    if (!ruleId || !message || !severity || !pattern || !languages) {
    return res.status(400).json({ error: 'ruleId、message、severity、pattern、languages 为必填' });
    }
    const guardRules = require('../../../lib/guard/guardRules');
    const result = guardRules.addOrUpdateRule(projectRoot, ruleId, {
    message,
    severity,
    pattern,
    languages: Array.isArray(languages) ? languages : [languages].filter(Boolean),
    note,
    ...(dimension === 'file' || dimension === 'target' || dimension === 'project' ? { dimension } : {})
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
  });

  // API: 根据用户语义描述由 AI 生成一条 Guard 规则（返回表单用，用户可修改后确认写入）
  app.post('/api/guard/rules/generate', async (req, res) => {
  try {
    const { description } = req.body;
    if (!description || typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: '请提供语义描述（description）' });
    }
    const ai = await AiFactory.getProvider(projectRoot);
    if (!ai) {
    return res.status(400).json({ error: 'AI 未配置，无法生成规则。请先在项目根配置 .env 或 boxspec.ai' });
    }
    const prompt = `用户希望添加一条 Guard 静态检查规则，语义描述如下：

「${description.trim()}」

请根据上述描述，生成一条规则。你只能回复一个合法的 JSON 对象，不要包含任何其他文字、markdown 或代码块标记。JSON 必须包含且仅包含以下字段：
- ruleId: 字符串，英文、短横线格式，如 no-main-thread-sync
- message: 字符串，违反时提示的说明（中文或英文）
- severity: 字符串，只能是 "error" 或 "warning"
- pattern: 字符串，用于对代码每一行匹配的正则表达式；在 JSON 中反斜杠需双写，如 "dispatch_sync\\s*\\("
- languages: 数组，元素为 "objc" 和/或 "swift"，如 ["objc","swift"]
- note: 字符串，可选，备注说明
- dimension: 字符串，可选，审查规模。只能是 "file"、"target"、"project" 之一，或不写该字段（表示任意规模均运行）。file=仅同文件内审查，target=仅同 SPM target 内，project=仅整个项目内。根据规则语义选择合适规模。

只输出这一份 JSON，不要解释。`;
    const raw = await ai.chat(prompt);
    let text = (raw && typeof raw === 'string' ? raw : String(raw)).trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) text = jsonMatch[0];
    text = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    const rule = JSON.parse(text);
    if (!rule.ruleId || !rule.message || !rule.pattern) {
    return res.status(400).json({ error: 'AI 返回的规则缺少 ruleId、message 或 pattern' });
    }
    const out = {
    ruleId: String(rule.ruleId).trim().replace(/\s+/g, '-'),
    message: String(rule.message || '').trim(),
    severity: rule.severity === 'error' ? 'error' : 'warning',
    pattern: String(rule.pattern || '').trim(),
    languages: Array.isArray(rule.languages) ? rule.languages.filter(l => l === 'objc' || l === 'swift') : ['objc', 'swift'],
    note: rule.note != null ? String(rule.note).trim() : '',
    dimension: rule.dimension === 'file' || rule.dimension === 'target' || rule.dimension === 'project' ? rule.dimension : ''
    };
    if (out.languages.length === 0) out.languages = ['objc', 'swift'];
    res.json(out);
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message || 'AI 生成规则失败' });
  }
  });

  // API: Guard 违反记录
  app.get('/api/guard/violations', (req, res) => {
  try {
    const guardViolations = require('../../../lib/guard/guardViolations');
    const data = guardViolations.getGuardViolations(projectRoot);
    res.json(data);
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
  });

  // API: 清空 Guard 违反记录
  app.post('/api/guard/violations/clear', (req, res) => {
  try {
    const guardViolations = require('../../../lib/guard/guardViolations');
    guardViolations.clearRuns(projectRoot);
    res.json({ success: true });
  } catch (err) {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  }
  });
}

module.exports = {
  registerGuardRoutes,
};
