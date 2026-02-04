/**
 * GuardHandler - 处理 // as:audit 代码审计触发
 * 支持作用域：file（默认）、target、project
 * 支持关键词搜索
 */

const fs = require('fs');
const path = require('path');
const Paths = require('../../infrastructure/config/Paths.js');
const AutomationOrchestrator = require('../../automation/AutomationOrchestrator');

const automationOrchestrator = new AutomationOrchestrator();

class GuardHandler {
  async handle(specFile, fullPath, code, guardLine) {
    return automationOrchestrator.run(
      {
        type: 'guard',
        handler: (context) => this._handleGuard(context)
      },
      { specFile, fullPath, code, guardLine }
    );
  }

  async _handleGuard(context) {
    const { specFile, fullPath, code, guardLine } = context;
    const AiFactory = require('../../ai/AiFactory');
    const { getInstance } = require('../../context');
    const findPath = require('../../infrastructure/paths/PathFinder');

    const rest = guardLine.replace(/^\/\/\s*as:(?:lint|l|guard|g)\s*/, '').trim();
    const scopeMatch = rest.toLowerCase().match(/^(file|target|project)$/);
    const scope = scopeMatch ? scopeMatch[1] : null;
    const keyword = scope ? '' : rest;
    console.log(`\n🛡️  [Lint Check] 正在检查文件: ${path.basename(fullPath)}${scope ? ` [范围: ${scope}]` : ' [范围: file]'}${keyword ? ` (关键词: ${keyword})` : ''}`);

    // findProjectRoot 已经会正确处理 specFile 路径，返回包含知识库目录的父目录
    const projectRoot = await findPath.findProjectRoot(specFile);
    let recipesContent = '';
    const guardUsedRecipes = [];

    if (projectRoot) {
      const service = getInstance(projectRoot);
      const ai = await AiFactory.getProvider(projectRoot);
      const { getTriggerFromContent } = require('../../recipe/parseRecipeMd');

      if (ai) {
        const queryText = keyword || code.substring(0, 500);
        try {
          const semanticResults = await service.search(queryText, { limit: 3, filter: { type: 'recipe' } });
          
          if (semanticResults.length > 0) {
            console.log(`🧠 已通过语义检索找到 ${semanticResults.length} 条相关规范...`);
            semanticResults.forEach(res => {
              const name = res.metadata?.name || res.metadata?.sourcePath || res.id;
              const content = res.content || '';
              recipesContent += `\n--- Recipe (Semantic Match): ${name} ---\n${content}\n`;
              guardUsedRecipes.push({
                trigger: getTriggerFromContent(content) || undefined,
                recipeFilePath: name
              });
            });
          }
        } catch (e) {
          console.warn('[Guard] 语义搜索失败，回退到关键字搜索');
        }
      }

      if (!recipesContent) {
        let rootSpec = null;
        try {
          const specPath = Paths.getProjectSpecPath(projectRoot);
          if (fs.existsSync(specPath)) rootSpec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
        } catch (_) {}
        const recipesDir = Paths.getProjectRecipesPath(projectRoot, rootSpec);
        
        if (fs.existsSync(recipesDir)) {
          const recipeFiles = fs.readdirSync(recipesDir).filter(f => f.endsWith('.md'));
          for (const file of recipeFiles) {
            if (!keyword || file.toLowerCase().includes(keyword.toLowerCase())) {
              const content = fs.readFileSync(path.join(recipesDir, file), 'utf8');
              recipesContent += `\n--- Recipe (Keyword Match): ${file} ---\n${content}\n`;
              guardUsedRecipes.push({
                trigger: getTriggerFromContent(content) || undefined,
                recipeFilePath: file
              });
            }
          }
        }
      }
    }

    if (!recipesContent) {
      const msg = '未找到匹配的 Recipe 知识，跳过 Guard 检查';
      console.log(`ℹ️  ${msg}。`);
      this._notify(msg);
      return;
    }

    // 埋点
    try {
      const recipeStats = require('../../recipe/recipeStats');
      for (const r of guardUsedRecipes) {
        recipeStats.recordRecipeUsage(projectRoot, {
          trigger: r.trigger,
          recipeFilePath: r.recipeFilePath,
          source: 'guard'
        });
      }
    } catch (_) {}

    // 静态规则检查
    const ext = path.extname(fullPath).toLowerCase();
    const language = ext === '.swift' ? 'swift' : (ext === '.m' || ext === '.h' ? 'objc' : null);
    const effectiveScope = scope || 'file';
    let staticViolations = [];
    if (language) {
      try {
        const guardRules = require('../../guard/guardRules');
        if (effectiveScope === 'file') {
          staticViolations = guardRules.runStaticCheck(projectRoot, code, language, scope);
        } else {
          staticViolations = await guardRules.runStaticCheckForScope(projectRoot, effectiveScope, fullPath, scope);
        }
        const relativeFilePath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
        const fileAuditViolations = await guardRules.runFileAudit(projectRoot, code, language, relativeFilePath, fullPath, effectiveScope);
        if (fileAuditViolations.length > 0) {
          staticViolations = staticViolations.concat(fileAuditViolations);
        }
        if (staticViolations.length > 0) {
          console.log(`\n⚠️  [Guard 静态规则] 发现 ${staticViolations.length} 处${effectiveScope !== 'file' ? `（范围: ${effectiveScope}）` : ''}：`);
          staticViolations.forEach(v => {
            const loc = v.filePath ? `${v.filePath}:${v.line}` : `L${v.line}`;
            console.log(`   [${v.severity}] ${v.ruleId} ${loc}: ${v.message}`);
          });
        }
      } catch (e) {
        console.warn('[Guard] 静态规则检查失败:', e.message);
      }
    }

    const runId = 'run-' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const relativeFilePath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
    const run = {
      id: runId,
      filePath: relativeFilePath,
      triggeredAt: new Date().toISOString(),
      violations: staticViolations
    };
    try {
      const guardViolations = require('../../guard/guardViolations');
      guardViolations.appendRun(projectRoot, run);
    } catch (_) {}

    // AI 检查
    try {
      const ai = await AiFactory.getProvider(projectRoot);
      const prompt = `你是一个资深的 iOS 架构师和代码审查员。
请根据以下“项目知识库(Recipes)”中的规范和最佳实践，审查提供的“源代码”。

项目知识库：
${recipesContent}

待审查源代码：
${code}

任务：
1. 检查代码是否违反了知识库中的任何准则、模式或约束。
2. 如果存在风险或改进点，请给出具体的、建设性的建议。
3. 如果代码表现优秀，请简要说明符合了哪些准则。
4. 请直接输出结果，保持简洁。`;

      console.log('AI 正在分析规范合规性...');
      const result = await ai.chat(prompt);
      
      console.log('\n--- 🛡️  Guard 审查结果 ---');
      console.log(result);
      console.log('------------------------\n');
    } catch (err) {
      console.error('❌ Guard 检查出错:', err.message);
    }
  }

  _notify(msg) {
    if (process.platform === 'darwin') {
      try {
        const notifier = require('../../infrastructure/notification/Notifier');
        notifier.notify(msg, { title: 'AutoSnippet', subtitle: 'Guard' });
      } catch (_) {}
    }
  }
}

module.exports = new GuardHandler();
