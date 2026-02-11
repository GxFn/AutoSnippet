/**
 * GuardHandler — 处理 // as:a (audit/guard/lint) 指令
 */

import { basename } from 'node:path';

/**
 * @param {string} fullPath
 * @param {string} code
 * @param {string} guardLine
 */
export async function handleGuard(fullPath, code, guardLine) {
  const rest = guardLine.replace(/^\/\/\s*as:(?:audit|a|lint|l|guard|g)\s*/, '').trim();
  console.log(`\n🛡️  [Guard] 正在检查文件: ${basename(fullPath)}`);

  try {
    const { detectLanguage } = await import('../../guard/GuardCheckEngine.js');
    const { ServiceContainer } = await import('../../../injection/ServiceContainer.js');
    const container = ServiceContainer.getInstance();
    const engine = container.get('guardCheckEngine');
    const language = detectLanguage(fullPath);
    const violations = engine.checkCode(code, language);

    if (violations.length === 0) {
      console.log(`  ✅ 无违规`);
    } else {
      const errors = violations.filter((v) => v.severity === 'error');
      const warnings = violations.filter((v) => v.severity === 'warning');
      console.log(`  🛡️ ${errors.length} errors, ${warnings.length} warnings`);
      for (const v of errors) {
        console.log(`  ❌ L${v.line} [${v.ruleId}] ${v.message}`);
      }
      for (const v of warnings.slice(0, 5)) {
        console.log(`  ⚠️  L${v.line} [${v.ruleId}] ${v.message}`);
      }
    }

    // 如果有关键词，也做语义搜索
    if (rest) {
      try {
        const searchEngine = container.get('searchEngine');
        const results = await searchEngine.search(rest, { limit: 3, mode: 'keyword' });
        if (results.length > 0) {
          console.log(`  🧠 相关规范 (${results.length}条):`);
          for (const r of results) {
            console.log(`     - ${r.title || r.id}`);
          }
        }
      } catch {
        // 搜索失败不阻塞
      }
    }
  } catch (err) {
    console.warn(`  ⚠️ Guard 检查失败: ${err.message}`);
  }
}
