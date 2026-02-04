/**
 * DraftHandler - 处理 _draft_ 文件
 */

const path = require('path');
const AutomationOrchestrator = require('../../automation/AutomationOrchestrator');

const automationOrchestrator = new AutomationOrchestrator();

class DraftHandler {
  async handle(specFile, fullPath, relativePath, content) {
    return automationOrchestrator.run(
      {
        type: 'draft',
        handler: (context) => this._handleDraft(context)
      },
      { specFile, fullPath, relativePath, content }
    );
  }

  async _handleDraft(context) {
    const { specFile, fullPath, relativePath, content } = context;
    // projectRoot 应该是 specFile 的父目录的父目录（包含知识库目录的目录）
    // 例如：specFile = /path/to/project/AutoSnippet/AutoSnippet.boxspec.json
    //       projectRoot = /path/to/project
    const projectRoot = path.dirname(path.dirname(specFile));

    if (!content || content.trim().length < 20) return;

    try {
      const parseRecipeMd = require('../../recipe/parseRecipeMd');
      const candidateService = require('../../ai/candidateService');

      const allRecipes = parseRecipeMd.parseRecipeMdAll(content);
      const normalized = (arr) => arr.map(r => ({
        title: r.title,
        summary: r.summary || r.summary_cn || '',
        trigger: r.trigger,
        category: r.category || 'Utility',
        language: r.language === 'swift' ? 'swift' : 'objc',
        code: r.code,
        usageGuide: r.usageGuide || '',
        headers: r.headers || []
      }));

      if (allRecipes.length > 0) {
        const items = normalized(allRecipes);
        await candidateService.appendCandidates(projectRoot, '_draft', items, 'draft-file');
        const msg = allRecipes.length === 1
          ? `已创建候选「${allRecipes[0].title}」，请在 Dashboard Candidates 页审核`
          : `已创建 ${allRecipes.length} 条候选，请在 Dashboard Candidates 页审核`;
        console.log(`✅ [_draft] ${msg}`);
        this._notify(msg);
        return;
      }

      let result = null;
      if (parseRecipeMd.isCompleteRecipeMd(content)) {
        result = parseRecipeMd.parseRecipeMd(content);
        if (result) {
          result = {
            title: result.title,
            summary: result.summary || result.summary_cn || '',
            trigger: result.trigger,
            category: result.category || 'Utility',
            language: result.language === 'swift' ? 'swift' : 'objc',
            code: result.code,
            usageGuide: result.usageGuide || '',
            headers: result.headers || []
          };
        }
      }
      if (!result) {
        const AiFactory = require('../../ai/AiFactory');
        const ai = await AiFactory.getProvider(projectRoot);
        if (ai) {
          const lang = /\.swift$/i.test(relativePath) ? 'swift' : 'objc';
          const extracted = await ai.summarize(content, lang);
          if (extracted && !extracted.error && extracted.title && extracted.code) {
            result = {
              title: extracted.title,
              summary: extracted.summary || extracted.summary_cn || '',
              trigger: extracted.trigger || '@' + (extracted.title || 'recipe'),
              category: extracted.category || 'Utility',
              language: (extracted.language || 'objc').toLowerCase().startsWith('swift') ? 'swift' : 'objc',
              code: extracted.code,
              usageGuide: extracted.usageGuide_cn || extracted.usageGuide_en || '',
              headers: extracted.headers || []
            };
          }
        }
      }
      if (result) {
        await candidateService.appendCandidates(projectRoot, '_draft', [result], 'draft-file');
        console.log(`✅ [_draft] 已创建候选「${result.title}」，请在 Dashboard Candidates 页审核`);
        this._notify(`已创建候选「${result.title}」，请在 Candidates 页审核`);
      }
    } catch (e) {
      console.warn('[Watcher] 草稿文件解析失败:', e.message);
    }
  }

  _notify(msg) {
    if (process.platform === 'darwin') {
      try {
        const { execSync } = require('child_process');
        execSync(`osascript -e 'display notification "${msg.replace(/"/g, '\\"')}" with title "AutoSnippet"'`, { encoding: 'utf8' });
      } catch (_) {}
    }
  }
}

module.exports = new DraftHandler();
