/**
 * Bootstrap — 微观维度提取器
 *
 * 3 个 candidateOnly 维度 + 1 个废弃维度：
 *   code-pattern, best-practice, event-and-data-flow, anti-pattern
 *
 * v5 核心变更：
 *   - 展示 **项目特征** — 不是功能的通用示例，而是当前项目的实际写法
 *   - 每种功能按写法变体分组，按使用频次排序，全部列举
 *   - 代码块来自真实项目文件，标注来源文件:行号
 *   - Agent 注意事项指出「项目首选写法」和应遵循的变体
 */

import { inferFilePriority } from '../TargetClassifier.js';
import {
  getBestPracticePatterns,
  getCallChainPatterns,
  getDataFlowPatterns,
} from './patterns.js';
import { _buildCandidateDoc, _makeTitle } from './dimensions.js';
import { CANONICAL_EXAMPLES, checkCompleteness } from './canonical-examples.js';
import { getCodePatternVariants } from './shared/patterns/code-patterns.js';
import { getBestPracticeVariants } from './shared/patterns/practice-patterns.js';
import { getEventFlowVariants } from './shared/patterns/event-patterns.js';
import { scanVariants } from './shared/scanner.js';
import { buildVariantBody } from './shared/rendering.js';

// Internal aliases — scanVariants and buildVariantBody come from shared modules
const _scanVariants = scanVariants;
const _buildVariantBody = buildVariantBody;

// ═══════════════════════════════════════════════════════════
//  code-pattern — 设计模式与代码惯例
//  v5: 每种模式展示项目内所有写法变体，按频次排序
// ═══════════════════════════════════════════════════════════

export function _extractCodePattern(allFiles, lang, ast, projectPrefix = '') {
  const results = [];

  // ── 每种模式的变体定义（按语言） ──
  const patternVariants = getCodePatternVariants(lang);

  for (const [patternName, pDef] of Object.entries(patternVariants)) {
    // 先用 AST 补充计数
    let astCount = 0;
    let astInstances = [];
    if (ast && ast.patternStats[patternName]) {
      astCount = ast.patternStats[patternName].count;
      astInstances = ast.patternStats[patternName].instances || [];
    }

    // 用主正则预过滤
    const matchingFiles = allFiles.filter(f => pDef.mainRegex.test(f.content));
    const totalCount = Math.max(matchingFiles.length, astCount);
    if (totalCount < (pDef.minCount || 1)) continue;

    // 扫描写法变体
    const scanResult = _scanVariants(allFiles, pDef.mainRegex, pDef.variants, lang);
    const bodyLines = _buildVariantBody(scanResult, lang, { patternKey: patternName, projectPrefix });

    // AST 增强信息
    if (patternName === 'singleton' && astInstances.length > 0) {
      bodyLines.push('### AST 检测到的单例实例', '');
      bodyLines.push(astInstances.map(i => `- \`${i.className || ''}.${i.methodName || ''}\``).join('\n'), '');
    }
    if (patternName === 'protocol-delegate' && ast) {
      const delegateProps = (ast.fileSummaries || []).flatMap(fs => (fs.properties || []).filter(p => /delegate/i.test(p.name)));
      if (delegateProps.length > 0) {
        const weakCount = delegateProps.filter(p => (p.attributes || []).includes('weak')).length;
        bodyLines.push(`### Delegate 属性统计（AST）`, '');
        bodyLines.push(`- ${delegateProps.length} 个 delegate 属性（weak: ${weakCount}，非 weak: ${delegateProps.length - weakCount}）`);
        if (weakCount < delegateProps.length) bodyLines.push(`- ⚠️ ${delegateProps.length - weakCount} 个未 weak，存在循环引用风险`);
        bodyLines.push('');
      }
    }
    if (patternName === 'category' && ast && ast.categories.length > 0) {
      bodyLines.push('### Category 列表（AST）', '');
      bodyLines.push(ast.categories.slice(0, 8).map(c => `- \`${c.className}(${c.categoryName})\``).join('\n'), '');
    }

    // 首选写法提示
    const primaryVariant = scanResult.variants[0];
    const primaryLabel = primaryVariant ? primaryVariant.label : pDef.label;
    const agentNotes = [
      `项目首选写法：${primaryLabel}（${primaryVariant?.fileCount || 0} 个文件使用）`,
      `使用${pDef.label}时 **必须** 遵循项目的首选写法`,
    ];
    if (scanResult.variants.length > 1) {
      agentNotes.push(`项目中存在 ${scanResult.variants.length} 种写法 — 新代码统一使用首选写法`);
    }

    const sources = scanResult.variants.flatMap(v => v.examples.map(e => e.file));

    results.push({
      title: _makeTitle('code-pattern', patternName),
      subTopic: patternName,
      code: _buildCandidateDoc({
        heading: pDef.label,
        oneLiner: `${totalCount} 处使用${pDef.label}，${scanResult.variants.length} 种写法（首选：${primaryLabel}）`,
        bodyLines,
        agentNotes,
      }),
      language: lang,
      sources: [...new Set(sources)].slice(0, 15),
      summary: `code-pattern/${patternName} ${pDef.label}：${totalCount} 处，${scanResult.variants.length} 种写法（首选 ${primaryLabel}）`,
      knowledgeType: 'code-pattern',
      tags: [patternName],
    });
  }

  // ── 继承关系（AST 增强，保持不变）──
  if (ast && ast.inheritanceGraph.length > 0) {
    const inheritEdges = ast.inheritanceGraph.filter(e => e.type === 'inherits');
    const conformEdges = ast.inheritanceGraph.filter(e => e.type === 'conforms');

    if (inheritEdges.length > 0 || conformEdges.length > 0) {
      const bodyLines = [`- **继承边**：${inheritEdges.length} 条`, `- **协议遵循边**：${conformEdges.length} 条`];
      const treeLines = [];
      const bySuper = {};
      for (const e of inheritEdges) { if (!bySuper[e.to]) bySuper[e.to] = []; bySuper[e.to].push(e.from); }
      for (const [superClass, subs] of Object.entries(bySuper).slice(0, 10)) {
        treeLines.push(`${superClass}`);
        for (const sub of subs.slice(0, 5)) {
          const protos = conformEdges.filter(e => e.from === sub).map(e => e.to);
          const protoStr = protos.length > 0 ? ` <${protos.join(', ')}>` : '';
          treeLines.push(`  └─ ${sub}${protoStr}`);
        }
      }

      results.push({
        title: _makeTitle('code-pattern', 'inheritance'),
        subTopic: 'inheritance',
        code: _buildCandidateDoc({
          heading: '类继承与协议遵循关系（AST）',
          oneLiner: `${inheritEdges.length} 条继承关系，${conformEdges.length} 条协议遵循`,
          bodyLines,
          codeBlocks: [{ language: 'text', source: 'AST 继承树', lines: treeLines }],
          agentNotes: [
            '新建类时注意选择合适的父类和协议遵循',
            '保持继承层级扁平，避免过深继承链',
          ],
        }),
        language: lang,
        sources: [...new Set(ast.classes.slice(0, 10).map(c => c.file).filter(Boolean))],
        summary: `code-pattern/inheritance 继承关系：${inheritEdges.length} 条继承, ${conformEdges.length} 条协议遵循`,
        knowledgeType: 'code-pattern',
        tags: ['inheritance', 'protocol-conformance'],
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
//  best-practice — 最佳实践
//  v5: 每种实践展示项目内所有实现方式，按频次排序
// ═══════════════════════════════════════════════════════════

export function _extractBestPractice(allFiles, lang, projectPrefix = '') {
  const results = [];
  const patterns = getBestPracticePatterns(lang);

  // ── 核心实践（错误处理 / 并发 / 内存管理）──
  for (const [key, pattern] of Object.entries(patterns)) {
    const matchingFiles = allFiles.filter(f => pattern.regex.test(f.content));
    if (matchingFiles.length === 0) continue;

    const variantDefs = getBestPracticeVariants(key, lang);
    const scanResult = _scanVariants(allFiles, pattern.regex, variantDefs, lang);
    const bodyLines = _buildVariantBody(scanResult, lang, { patternKey: key, projectPrefix });

    // 首选写法
    const primaryVariant = scanResult.variants[0];
    const primaryLabel = primaryVariant ? primaryVariant.label : pattern.label;

    // 关联关系
    const relations = [];
    if (key === 'errorHandling') {
      relations.push({ type: 'DEPENDS_ON', target: _makeTitle('code-standard', 'naming'), description: 'Error domain 遵循类名命名' });
    }
    if (key === 'memoryMgmt') {
      relations.push({ type: 'RELATED', target: _makeTitle('best-practice', 'concurrency'), description: 'weakSelf 与 GCD 结合使用' });
    }
    if (key === 'concurrency') {
      relations.push({ type: 'EXTENDS', target: _makeTitle('best-practice', 'memory-mgmt'), description: 'GCD 中的 weakSelf 模式' });
    }

    const subTopicMap = { errorHandling: 'error-handling', concurrency: 'concurrency', memoryMgmt: 'memory-mgmt' };
    const subTopic = subTopicMap[key] || key;

    const agentNotes = [
      `项目首选 ${pattern.label} 写法：${primaryLabel}（${primaryVariant?.fileCount || 0} 个文件使用）`,
      `新代码 **必须** 遵循项目首选的 ${pattern.label} 写法`,
    ];
    if (scanResult.variants.length > 1) {
      agentNotes.push(`项目中有 ${scanResult.variants.length} 种 ${pattern.label} 写法 — 新代码统一使用首选写法`);
    }

    const sources = scanResult.variants.flatMap(v => v.examples.map(e => e.file));

    results.push({
      title: _makeTitle('best-practice', subTopic),
      subTopic,
      code: _buildCandidateDoc({
        heading: `${pattern.label}约定`,
        oneLiner: `${matchingFiles.length} 个文件使用${pattern.label}，${scanResult.variants.length} 种写法（首选：${primaryLabel}）`,
        bodyLines,
        agentNotes,
        relationLines: relations.map(r => `${r.type}: [${r.target}] — ${r.description}`),
      }),
      language: lang,
      sources: [...new Set(sources)].slice(0, 15),
      summary: `best-practice/${subTopic} ${pattern.label}：${matchingFiles.length} 个文件，${scanResult.variants.length} 种写法（首选 ${primaryLabel}）`,
      knowledgeType: 'best-practice',
      tags: [subTopic],
      relations,
    });
  }

  // ── logging（v4 保留 + v5 变体增强）──
  _extractLogging(allFiles, lang, results);

  // ── testing（v4 保留 + v5 变体增强）──
  _extractTesting(allFiles, lang, results);

  return results;
}

/** 日志规范提取（含写法变体） */
function _extractLogging(allFiles, lang, results) {
  const loggingVariants = lang === 'objectivec'
    ? {
        NSLog:           { label: 'NSLog()', regex: /\bNSLog\s*\(/ },
        CocoaLumberjack: { label: 'CocoaLumberjack (DDLog)', regex: /\bDDLog(Verbose|Debug|Info|Warn|Error)\b/ },
        OSLog:           { label: 'os_log / os_signpost', regex: /\bos_log\b|\bos_signpost\b/ },
      }
    : lang === 'swift'
      ? {
          print:           { label: 'print()', regex: /\bprint\s*\(/ },
          Logger:          { label: 'Logger() / os_log', regex: /\bLogger\s*\(|\bos_log\b/ },
          CocoaLumberjack: { label: 'CocoaLumberjack (DDLog)', regex: /\bDDLog\w+\b/ },
          SwiftyBeaver:    { label: 'SwiftyBeaver', regex: /\blog\.(verbose|debug|info|warning|error)\b/ },
        }
      : {};

  if (Object.keys(loggingVariants).length === 0) return;

  const mainFilter = new RegExp(Object.values(loggingVariants).map(v => v.regex.source).join('|'));
  const scanResult = _scanVariants(allFiles, mainFilter, loggingVariants, lang);

  if (scanResult.totalFiles === 0) return;

  const bodyLines = _buildVariantBody(scanResult, lang, { patternKey: 'logging' });
  const primaryVariant = scanResult.variants[0];
  const primaryLabel = primaryVariant ? primaryVariant.label : 'unknown';

  results.push({
    title: _makeTitle('best-practice', 'logging'),
    subTopic: 'logging',
    code: _buildCandidateDoc({
      heading: '日志规范',
      oneLiner: `主要使用 ${primaryLabel}（${primaryVariant?.fileCount || 0} 个文件），共 ${scanResult.variants.length} 种日志方式`,
      bodyLines,
      agentNotes: [
        `项目主日志方式：${primaryLabel} — 新代码 **必须** 使用此方式`,
        scanResult.variants.length > 1
          ? `项目存在 ${scanResult.variants.length} 种日志方式 — 建议统一使用 ${primaryLabel}`
          : '项目日志方式统一',
      ],
    }),
    language: lang,
    sources: scanResult.variants.flatMap(v => v.examples.map(e => e.file)).slice(0, 10),
    summary: `best-practice/logging 日志规范：${scanResult.variants.length} 种方式，首选 ${primaryLabel}（${primaryVariant?.fileCount || 0} 个文件）`,
    knowledgeType: 'best-practice',
    tags: ['logging'],
  });
}

/** 测试模式提取（含写法变体） */
function _extractTesting(allFiles, lang, results) {
  const testFiles = allFiles.filter(f =>
    /Test[s]?\.(swift|m|mm)$/.test(f.name) || /Spec\.(swift|m|mm)$/.test(f.name) ||
    /XCTestCase|XCTest|Quick|Nimble/.test(f.content)
  );
  if (testFiles.length === 0) return;

  const testVariants = lang === 'swift'
    ? {
        xctest:     { label: 'XCTest 单元测试', regex: /class\s+\w+\s*:\s*XCTestCase/ },
        quick:      { label: 'Quick/BDD 测试', regex: /class\s+\w+\s*:\s*QuickSpec|describe\s*\(/ },
        async_test: { label: 'async 异步测试', regex: /func\s+test\w+\s*\(\s*\)\s*async/ },
        ui_test:    { label: 'UI 测试', regex: /class\s+\w+\s*:\s*XCUITestCase|XCUIApplication/ },
      }
    : lang === 'objectivec'
      ? {
          xctest:  { label: 'XCTest 单元测试', regex: /XCTestCase|XCTAssert/ },
          kiwi:    { label: 'Kiwi BDD 测试', regex: /\bKWSpec\b|describe\s*\(/ },
          ocmock:  { label: 'OCMock 模拟测试', regex: /\bOCMock|OCMClassMock|OCMProtocolMock/ },
        }
      : {};

  const mainFilter = /XCTestCase|XCTest|Quick|Nimble|QuickSpec|KWSpec|test\w+.*\{/;
  const scanResult = _scanVariants(testFiles, mainFilter, testVariants, lang);
  const bodyLines = _buildVariantBody(scanResult, lang, { patternKey: 'testing' });

  const primaryVariant = scanResult.variants[0];
  const primaryLabel = primaryVariant ? primaryVariant.label : 'XCTest';

  results.push({
    title: _makeTitle('best-practice', 'testing'),
    subTopic: 'testing',
    code: _buildCandidateDoc({
      heading: '测试模式',
      oneLiner: `${testFiles.length} 个测试文件，${scanResult.variants.length} 种测试框架/模式（首选 ${primaryLabel}）`,
      bodyLines,
      agentNotes: [
        `项目首选测试框架：${primaryLabel}`,
        `新测试 **必须** 使用 ${primaryLabel} 并遵循以上项目测试写法`,
        '测试方法名应清晰描述测试意图',
      ],
    }),
    language: lang,
    sources: scanResult.variants.flatMap(v => v.examples.map(e => e.file)).slice(0, 10),
    summary: `best-practice/testing 测试模式：${testFiles.length} 个文件，首选 ${primaryLabel}`,
    knowledgeType: 'best-practice',
    tags: ['testing'],
  });
}

// ═══════════════════════════════════════════════════════════
//  event-and-data-flow — 事件传播与数据状态管理
//  v5: 每种事件/数据模式展示项目写法变体，按频次排序
// ═══════════════════════════════════════════════════════════

export function _extractEventAndDataFlow(allFiles, lang, projectPrefix = '') {
  const results = [];
  const seenSubTopics = new Set();

  function _extractWithVariants(key, pattern, category, knowledgeType) {
    const subTopic = `${category}-${key}`;
    if (seenSubTopics.has(subTopic)) return;

    const matchingFiles = allFiles.filter(f => pattern.regex.test(f.content));
    if (matchingFiles.length === 0) return;

    // 获取变体定义
    const variantDefs = getEventFlowVariants(key, lang);
    const scanResult = _scanVariants(allFiles, pattern.regex, variantDefs, lang);
    const bodyLines = [];

    // 类型标签
    bodyLines.push(`- **类型**：${category === 'event' ? '事件传播' : '数据状态管理'}`);
    bodyLines.push(`- **使用范围**：${matchingFiles.length} 个文件`, '');

    // 写法变体
    bodyLines.push(..._buildVariantBody(scanResult, lang, { patternKey: key, projectPrefix }));

    // 完整性检查（保留，但作为辅助提示而非主内容）
    const missing = checkCompleteness(key, lang, matchingFiles);
    if (missing) {
      bodyLines.push('### ⚠️ 完整性提示', '');
      bodyLines.push(`项目代码可能缺少：${missing.join('、')}`, '');

      const canonicalKey = `${lang}:${key}`;
      const canonical = CANONICAL_EXAMPLES[canonicalKey];
      if (canonical) {
        bodyLines.push(`> 完整使用链应包含：${canonical.label}`, '');
      }
    } else {
      bodyLines.push('', '> ✅ 项目代码已包含完整使用链', '');
    }

    const primaryVariant = scanResult.variants[0];
    const primaryLabel = primaryVariant ? primaryVariant.label : pattern.label;

    const agentNotes = [
      `项目首选 ${pattern.label} 写法：${primaryLabel}`,
      `实现 ${pattern.label} 时 **必须** 遵循项目首选写法`,
    ];
    if (missing) {
      agentNotes.push(`${pattern.label} 必须实现完整链路（${missing.join('、')}不可缺少）`);
    }
    if (scanResult.variants.length > 1) {
      agentNotes.push(`项目有 ${scanResult.variants.length} 种 ${pattern.label} 写法 — 新代码统一使用首选写法`);
    }

    const sources = scanResult.variants.flatMap(v => v.examples.map(e => e.file));

    seenSubTopics.add(subTopic);
    results.push({
      title: _makeTitle('event-and-data-flow', subTopic),
      subTopic,
      code: _buildCandidateDoc({
        heading: `${category === 'event' ? '事件传播' : '数据管理'}：${pattern.label}`,
        oneLiner: `${matchingFiles.length} 个文件使用${pattern.label}，${scanResult.variants.length} 种写法（首选 ${primaryLabel}）`,
        bodyLines,
        agentNotes,
      }),
      language: lang,
      sources: [...new Set(sources)].slice(0, 15),
      summary: `event-and-data-flow/${subTopic} ${category === 'event' ? '事件传播' : '数据管理'} · ${pattern.label}：${matchingFiles.length} 个文件，首选 ${primaryLabel}`,
      knowledgeType,
      tags: [subTopic],
    });
  }

  // ── Part 1: 事件传播链 ──
  const callChainPatterns = getCallChainPatterns(lang);
  for (const [key, pattern] of Object.entries(callChainPatterns)) {
    if (key === 'delegate') continue; // 已在 code-pattern 处理
    _extractWithVariants(key, pattern, 'event', 'call-chain');
  }

  // ── Part 2: 数据状态管理 ──
  const dataFlowPatterns = getDataFlowPatterns(lang);
  for (const [key, pattern] of Object.entries(dataFlowPatterns)) {
    if (key === 'singleton') continue; // 已在 code-pattern 处理
    _extractWithVariants(key, pattern, 'data', 'data-flow');
  }

  return results;
}
