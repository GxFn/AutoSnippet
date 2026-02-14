/**
 * Bootstrap — 宏观维度提取器
 *
 * 4 个 skillWorthy 维度：
 *   code-standard, architecture, project-profile, agent-guidelines
 */

import { inferFilePriority, inferTargetRole } from '../TargetClassifier.js';
import {
  getTypeDefPattern,
  extractEnclosingBlock,
} from './patterns.js';
import { _buildCandidateDoc, _makeTitle } from './dimensions.js';
import { readFileSync, existsSync } from 'fs';
import { join as pathJoin } from 'path';
import {
  FOUNDATION_TYPES, UIKIT_TYPES, classifyBase,
  escapeRegex, collectMultilineMacro, inferMacroCategory, isConstFile,
} from './shared/objc-swift-utils.js';
import { isThirdParty, filterThirdParty } from './shared/third-party-filter.js';

// ─── 共享辅助：前缀检测 ──────────────────────────────────

/**
 * 统计项目类名前缀（2-char / 3-char）并返回最佳匹配
 * @returns {[string, number]|null} [prefix, count] 或 null
 */
export function _computeTopPrefix(allFiles, lang, ast) {
  const prefix2Counts = {};
  const prefix3Counts = {};

  function collect(name) {
    if (!name || name.length < 3) return;
    const p2 = name.slice(0, 2);
    const p3 = name.slice(0, 3);
    if (/^[A-Z]{2}$/.test(p2)) prefix2Counts[p2] = (prefix2Counts[p2] || 0) + 1;
    if (/^[A-Z]{3}$/.test(p3)) prefix3Counts[p3] = (prefix3Counts[p3] || 0) + 1;
  }

  if (ast && ast.classes.length > 0) {
    for (const cls of ast.classes) collect(cls.name);
  } else {
    const typeDefRe = getTypeDefPattern(lang);
    for (const f of allFiles.slice(0, 100)) {
      const match = f.content.match(typeDefRe);
      if (!match) continue;
      collect(match[0].trim().split(/\s+/).pop());
    }
  }

  const top2 = Object.entries(prefix2Counts).sort((a, b) => b[1] - a[1])[0];
  const top3 = Object.entries(prefix3Counts).sort((a, b) => b[1] - a[1])[0];

  if (top2 && top3) {
    const prefix3Varieties = Object.keys(prefix3Counts).filter(k => k.startsWith(top2[0])).length;
    if (top3[0].startsWith(top2[0]) && top3[1] > top2[1] * 0.5 && prefix3Varieties <= 2) {
      return top3;
    }
    return top2;
  }
  return top2 || top3 || null;
}

// ── code-standard ─────────────────────────────────────────

export function _extractCodeStandard(allFiles, lang, ast) {
  const results = [];
  const highPriFiles = allFiles.filter(f => inferFilePriority(f.name) === 'high');
  const samples = highPriFiles.length > 0 ? highPriFiles.slice(0, 6) : allFiles.filter(f => inferFilePriority(f.name) === 'medium').slice(0, 4);

  // 使用共享前缀检测
  const topPrefix = _computeTopPrefix(allFiles, lang, ast);

  if (samples.length > 0) {
    const codeBlocks = [];
    const sources = [];
    const typeDefRe = getTypeDefPattern(lang);
    for (const f of samples.slice(0, 2)) {
      const fileLines = f.content.split('\n');
      const typeIdx = fileLines.findIndex(l => typeDefRe.test(l));
      const endLine = typeIdx >= 0 && typeIdx < 80 ? Math.min(fileLines.length, typeIdx + 20) : Math.min(fileLines.length, 40);
      codeBlocks.push({ language: lang, source: `${f.relativePath}:1`, lines: fileLines.slice(0, endLine) });
      sources.push(f.relativePath);
    }

    const prefixNote = topPrefix ? `项目使用 ${topPrefix[0]} 前缀（出现 ${topPrefix[1]} 次）` : '未检测到统一前缀';
    const bodyLines = [
      topPrefix ? `- **类名前缀**：统一使用 \`${topPrefix[0]}\` 前缀` : '- **类名前缀**：未检测到统一前缀',
      '- **命名风格**：以采样代码为准（见下方代码示例）',
    ];
    // AST 增强：补充类型声明统计
    if (ast) {
      bodyLines.push(`- **类型声明**：${ast.classes.length} 个类/结构体, ${ast.protocols.length} 个协议, ${ast.categories.length} 个 Category`);
      // 展示主要协议遵循关系
      const conformances = ast.classes.filter(c => c.protocols && c.protocols.length > 0);
      if (conformances.length > 0) {
        bodyLines.push(`- **协议遵循**：${conformances.length} 个类声明了协议遵循`);
      }
    }
    results.push({
      title: _makeTitle('code-standard', 'naming'),
      subTopic: 'naming',
      code: _buildCandidateDoc({
        heading: `${lang === 'objectivec' ? 'ObjC' : lang} 命名约定`,
        oneLiner: `${prefixNote}，从 ${ast ? ast.classes.length + ' 个 AST 类声明' : samples.length + ' 个核心文件'}中分析`,
        bodyLines,
        codeBlocks,
        agentNotes: [
          topPrefix ? `新建类必须使用 \`${topPrefix[0]}\` 前缀` : '遵循项目现有命名风格',
        ],
        relationLines: ['ENFORCES: [code-standard/file-organization] — 文件名需与类名匹配'],
      }),
      language: lang,
      sources,
      summary: `命名约定：${prefixNote}`,
      knowledgeType: 'code-standard',
      tags: ['naming'],
      relations: [{ type: 'ENFORCES', target: _makeTitle('code-standard', 'file-organization'), description: '文件名需与类名匹配' }],
    });
  }

  // ── file-organization ──
  const markCount = allFiles.filter(f => /\/\/\s*MARK:\s*-|#pragma\s+mark\s+/m.test(f.content)).length;
  const docCommentCount = allFiles.filter(f => /\/\/\/\s|\/\*\*[\s\S]*?\*\//.test(f.content)).length;

  if (samples.length > 0) {
    // 提取有 MARK 分段的文件示例
    const markSample = allFiles.find(f => /\/\/\s*MARK:\s*-|#pragma\s+mark\s+/.test(f.content));
    const codeBlocks = [];
    const sources = [];
    if (markSample) {
      const fileLines = markSample.content.split('\n');
      codeBlocks.push({ language: lang, source: `${markSample.relativePath}:1`, lines: fileLines.slice(0, 50) });
      sources.push(markSample.relativePath);
    }

    results.push({
      title: _makeTitle('code-standard', 'file-organization'),
      subTopic: 'file-organization',
      code: _buildCandidateDoc({
        heading: '文件组织与分段',
        oneLiner: `${markCount} 个文件使用 MARK 分段，${docCommentCount} 个文件使用文档注释`,
        bodyLines: [
          `- **MARK 分段**：${markCount} 个文件使用 MARK/pragma mark 分段`,
          `- **文档注释**：${docCommentCount} 个文件使用 /// 或 /** */ 注释`,
        ],
        codeBlocks,
        agentNotes: markCount > 0 ? ['新代码应使用 MARK: - 对代码分段'] : [],
      }),
      language: lang,
      sources,
      summary: `文件组织：MARK 分段 ${markCount} 文件, 文档注释 ${docCommentCount} 文件`,
      knowledgeType: 'code-standard',
      tags: ['file-organization'],
    });
  }

  // ── api-naming（方法签名风格）──
  {
    const methodNameStats = { verbPrefixes: {}, paramStyles: {} };

    if (lang === 'objectivec') {
      const methodRe = /^[-+]\s*\([^)]+\)\s*(\w+)/;
      for (const f of allFiles.slice(0, 80)) {
        const fileLines = f.content.split('\n');
        for (const line of fileLines) {
          const m = line.match(methodRe);
          if (!m) continue;
          const name = m[1];
          const verbMatch = name.match(/^(init|configure|setup|fetch|load|handle|did|will|should|set|get|update|create|delete|remove|add|insert|perform)/);
          if (verbMatch) {
            const verb = verbMatch[1];
            methodNameStats.verbPrefixes[verb] = (methodNameStats.verbPrefixes[verb] || 0) + 1;
          }
        }
      }
    } else if (lang === 'swift') {
      const funcRe = /func\s+(\w+)\s*\(/;
      for (const f of allFiles.slice(0, 80)) {
        const fileLines = f.content.split('\n');
        for (const line of fileLines) {
          const m = line.match(funcRe);
          if (!m) continue;
          const name = m[1];
          const verbMatch = name.match(/^(configure|setup|fetch|load|handle|did|will|should|set|get|update|create|delete|remove|add|insert|perform|make|build)/);
          if (verbMatch) {
            const verb = verbMatch[1];
            methodNameStats.verbPrefixes[verb] = (methodNameStats.verbPrefixes[verb] || 0) + 1;
          }
        }
      }
    }

    const sortedVerbs = Object.entries(methodNameStats.verbPrefixes).sort((a, b) => b[1] - a[1]);
    if (sortedVerbs.length >= 2) {
      const topVerb = sortedVerbs[0][0];
      const apiSampleFile = allFiles.find(f => {
        const re = lang === 'objectivec'
          ? new RegExp(`^[-+]\\s*\\([^)]+\\)\\s*${topVerb}`, 'm')
          : new RegExp(`func\\s+${topVerb}\\w*\\s*\\(`, 'm');
        return re.test(f.content);
      });
      const codeBlocks = [];
      const sources = [];
      if (apiSampleFile) {
        const fileLines = apiSampleFile.content.split('\n');
        const re = lang === 'objectivec'
          ? new RegExp(`^[-+]\\s*\\([^)]+\\)\\s*${topVerb}`)
          : new RegExp(`func\\s+${topVerb}\\w*\\s*\\(`);
        const matchIdx = fileLines.findIndex(l => re.test(l));
        if (matchIdx >= 0) {
          const block = extractEnclosingBlock(fileLines, matchIdx, lang, 25);
          codeBlocks.push({ language: lang, source: `${apiSampleFile.relativePath}:${matchIdx + 1}`, lines: block });
          sources.push(apiSampleFile.relativePath);
        }
      }

      const bodyLines = [
        '- **常用动词前缀统计**：',
        ...sortedVerbs.slice(0, 8).map(([v, count]) => `  - \`${v}...\` — ${count} 次`),
      ];

      results.push({
        title: _makeTitle('code-standard', 'api-naming'),
        subTopic: 'api-naming',
        code: _buildCandidateDoc({
          heading: '方法签名命名风格',
          oneLiner: `${sortedVerbs.length} 种动词前缀，最常用 ${topVerb}（${sortedVerbs[0][1]} 次）`,
          bodyLines,
          codeBlocks,
          agentNotes: [
            `新方法命名应遵循项目现有动词前缀习惯（${sortedVerbs.slice(0, 4).map(v => v[0]).join('/')})`,
          ],
          relationLines: ['EXTENDS: [code-standard/naming] — 方法命名是类命名约定的延伸'],
        }),
        language: lang,
        sources,
        summary: `方法签名风格：${sortedVerbs.length} 种动词前缀，最常用 ${topVerb}`,
        knowledgeType: 'code-standard',
        tags: ['api-naming', 'method-naming'],
        relations: [{ type: 'EXTENDS', target: _makeTitle('code-standard', 'naming'), description: '方法命名是类命名约定的延伸' }],
      });
    }
  }

  // ── comment-style（注释语言/风格检测）──
  {
    let chineseComments = 0;
    let englishComments = 0;
    const commentSources = [];

    const commentRe = /\/\/\s*(.{4,})|\/\*\*?\s*\n?\s*\*?\s*(.{4,})/;
    for (const f of allFiles.slice(0, 60)) {
      const fileLines = f.content.split('\n');
      for (const line of fileLines) {
        const m = line.match(commentRe);
        if (!m) continue;
        const text = (m[1] || m[2] || '').trim();
        if (!text || text.length < 4) continue;
        if (/[\u4e00-\u9fff]/.test(text)) {
          chineseComments++;
        } else if (/^[a-zA-Z]/.test(text) && text.length > 6) {
          englishComments++;
        }
      }
      if (chineseComments > 0 || englishComments > 0) {
        if (!commentSources.includes(f.relativePath)) commentSources.push(f.relativePath);
      }
      if (commentSources.length >= 6) break;
    }

    const total = chineseComments + englishComments;
    if (total > 5) {
      const dominantLang = chineseComments > englishComments ? '中文' : '英文';
      const ratio = total > 0 ? ((Math.max(chineseComments, englishComments) / total) * 100).toFixed(0) : '0';

      results.push({
        title: _makeTitle('code-standard', 'comment-style'),
        subTopic: 'comment-style',
        code: _buildCandidateDoc({
          heading: '注释语言与风格',
          oneLiner: `项目注释以${dominantLang}为主（${ratio}%），共检测 ${total} 条注释`,
          bodyLines: [
            `- **中文注释**：${chineseComments} 条`,
            `- **英文注释**：${englishComments} 条`,
            `- **主导语言**：${dominantLang}（占比 ${ratio}%）`,
            `- **文档注释**：${docCommentCount} 个文件使用 /// 或 /** */ 格式`,
          ],
          agentNotes: [
            `新代码的注释应使用${dominantLang}，与项目保持一致`,
          ],
        }),
        language: lang,
        sources: commentSources.slice(0, 5),
        summary: `注释风格：${dominantLang}为主（${ratio}%），${total} 条注释采样`,
        knowledgeType: 'code-style',
        tags: ['comment-style', 'comment-language'],
      });
    }
  }

  return results;
}

// ── architecture ──────────────────────────────────────────

export function _extractArchitecture(targetFileMap, depGraphData, lang, ast) {
  const results = [];
  const targetNames = Object.keys(targetFileMap);
  if (targetNames.length === 0) return results;

  // ── layer-overview ──
  const roles = {};
  for (const tn of targetNames) {
    const role = inferTargetRole(tn);
    if (!roles[role]) roles[role] = [];
    roles[role].push({ name: tn, files: (targetFileMap[tn] || []).length });
  }

  const bodyLines = [];
  bodyLines.push('| 角色 | 模块 | 文件数 |', '|------|------|--------|');
  for (const [role, targets] of Object.entries(roles).sort((a, b) => b[1].length - a[1].length)) {
    for (const t of targets) {
      bodyLines.push(`| ${role} | ${t.name} | ${t.files} |`);
    }
  }

  // AST 增强：补充代码结构统计
  if (ast) {
    bodyLines.push('');
    bodyLines.push(`- **AST 类型统计**：${ast.classes.length} 类, ${ast.protocols.length} 协议, ${ast.categories.length} Category`);
    if (ast.projectMetrics) {
      bodyLines.push(`- **方法统计**：${ast.projectMetrics.totalMethods} 个方法，平均 ${ast.projectMetrics.avgMethodsPerClass.toFixed(1)} 个/类`);
      bodyLines.push(`- **最大嵌套深度**：${ast.projectMetrics.maxNestingDepth}`);
      if (ast.projectMetrics.complexMethods.length > 0) {
        bodyLines.push(`- ⚠️ **高复杂度方法**：${ast.projectMetrics.complexMethods.length} 个 (cyclomatic > 10)`);
      }
      if (ast.projectMetrics.longMethods.length > 0) {
        bodyLines.push(`- ⚠️ **过长方法**：${ast.projectMetrics.longMethods.length} 个 (> 50 行)`);
      }
    }
  }

  results.push({
    title: _makeTitle('architecture', 'layer-overview'),
    subTopic: 'layer-overview',
    code: _buildCandidateDoc({
      heading: '分层架构概览',
      oneLiner: `${targetNames.length} 个模块/Target，按职责分为 ${Object.keys(roles).length} 种角色`,
      bodyLines,
      agentNotes: ['新增模块需明确所属层级', '遵循已有分层结构'],
      relationLines: ['PREREQUISITE: [project-profile] — 理解项目全貌后使用'],
    }),
    language: 'markdown',
    sources: targetNames.slice(0, 10),
    summary: `${targetNames.length} 个模块按职责分类`,
    knowledgeType: 'architecture',
    tags: ['layer-overview'],
    relations: [{ type: 'PREREQUISITE', target: _makeTitle('project-profile', 'overview'), description: '理解项目全貌后使用' }],
  });

  // ── dependency-graph ──
  if (depGraphData?.edges?.length > 0) {
    const depLines = depGraphData.edges.slice(0, 30).map(e => `- \`${e.from}\` → \`${e.to}\``);
    if (depGraphData.edges.length > 30) depLines.push(`- …另有 ${depGraphData.edges.length - 30} 条依赖`);

    results.push({
      title: _makeTitle('architecture', 'dependency-graph'),
      subTopic: 'dependency-graph',
      code: _buildCandidateDoc({
        heading: '模块依赖关系',
        oneLiner: `${depGraphData.edges.length} 条模块间依赖`,
        bodyLines: depLines,
        agentNotes: ['新增模块间依赖需遵循已有方向，禁止反向引入'],
      }),
      language: 'markdown',
      sources: ['SPM manifest'],
      summary: `${depGraphData.edges.length} 条模块间依赖关系`,
      knowledgeType: 'module-dependency',
      tags: ['dependency-graph'],
      relations: [{ type: 'RELATED', target: _makeTitle('architecture', 'layer-overview'), description: '依赖图支撑分层概览' }],
    });
  }

  // ── boundary-rules（v4 新增：导入约束规则）──
  if (depGraphData?.edges?.length > 0 && targetNames.length > 1) {
    const importedBy = {};
    const imports = {};
    for (const e of depGraphData.edges) {
      if (!imports[e.from]) imports[e.from] = [];
      imports[e.from].push(e.to);
      if (!importedBy[e.to]) importedBy[e.to] = [];
      importedBy[e.to].push(e.from);
    }

    const foundation = Object.entries(importedBy).filter(([, v]) => v.length >= 3).sort((a, b) => b[1].length - a[1].length);
    const topImporters = Object.entries(imports).filter(([, v]) => v.length >= 2).sort((a, b) => b[1].length - a[1].length);

    const bodyLines = [];
    if (foundation.length > 0) {
      bodyLines.push('### 基础模块（被广泛导入）', '');
      for (const [mod, importers] of foundation.slice(0, 5)) {
        bodyLines.push(`- \`${mod}\` — 被 ${importers.length} 个模块导入：${importers.slice(0, 5).join(', ')}`);
      }
      bodyLines.push('');
    }
    if (topImporters.length > 0) {
      bodyLines.push('### 上层聚合模块（导入较多）', '');
      for (const [mod, deps] of topImporters.slice(0, 5)) {
        bodyLines.push(`- \`${mod}\` — 导入 ${deps.length} 个模块：${deps.slice(0, 5).join(', ')}`);
      }
      bodyLines.push('');
    }

    const constraints = [];
    if (foundation.length > 0) {
      const foundationNames = foundation.map(([n]) => n);
      constraints.push(`基础模块（${foundationNames.slice(0, 3).join('、')}）不应反向依赖上层模块`);
    }

    if (bodyLines.length > 0) {
      results.push({
        title: _makeTitle('architecture', 'boundary-rules'),
        subTopic: 'boundary-rules',
        code: _buildCandidateDoc({
          heading: '模块边界约束规则',
          oneLiner: `${foundation.length} 个基础模块, ${topImporters.length} 个上层聚合模块`,
          bodyLines,
          agentNotes: [
            '⛔ 禁止基础模块反向依赖上层业务模块',
            '新增跨模块 import 前检查依赖方向是否合理',
            ...constraints.map(c => `⛔ ${c}`),
          ],
          relationLines: [
            'ENFORCES: [architecture/dependency-graph] — 约束依赖图的方向性',
            'RELATED: [architecture/layer-overview] — 基于分层推断约束',
          ],
        }),
        language: 'markdown',
        sources: ['SPM manifest', 'dependency analysis'],
        summary: `边界约束：${foundation.length} 个基础模块不可反向依赖`,
        knowledgeType: 'boundary-constraint',
        tags: ['boundary-rules', 'import-constraints'],
        relations: [
          { type: 'ENFORCES', target: _makeTitle('architecture', 'dependency-graph'), description: '约束依赖图的方向性' },
          { type: 'RELATED', target: _makeTitle('architecture', 'layer-overview'), description: '基于分层推断约束' },
        ],
      });
    }
  }

  return results;
}

// ── project-profile ───────────────────────────────────────

export function _extractProjectProfile(allFiles, targetFileMap, depGraphData, guardAudit, langStats, lang, ast, pipelineCtx) {
  const targetNames = Object.keys(targetFileMap);
  const totalFiles = allFiles.length;
  const sortedLangs = Object.entries(langStats).sort((a, b) => b[1] - a[1]);

  const bodyLines = [];
  bodyLines.push('| 指标 | 值 |', '|------|-----|');
  bodyLines.push(`| 主语言 | ${lang} |`);
  bodyLines.push(`| 扫描文件数 | ${totalFiles} |`);
  bodyLines.push(`| 模块/Target 数 | ${targetNames.length} |`);
  bodyLines.push(`| SPM 依赖边数 | ${depGraphData?.edges?.length || 0} |`);
  bodyLines.push(`| Guard 违规数 | ${guardAudit?.summary?.totalViolations || 0} |`);

  // AST 增强指标
  if (ast) {
    bodyLines.push(`| 类/结构体 (AST) | ${ast.classes.length} |`);
    bodyLines.push(`| 协议 (AST) | ${ast.protocols.length} |`);
    bodyLines.push(`| Category/Extension (AST) | ${ast.categories.length} |`);
    bodyLines.push(`| 方法总数 (AST) | ${ast.projectMetrics?.totalMethods || 0} |`);
    bodyLines.push(`| 平均方法数/类 (AST) | ${(ast.projectMetrics?.avgMethodsPerClass || 0).toFixed(1)} |`);
    bodyLines.push(`| 最大嵌套深度 (AST) | ${ast.projectMetrics?.maxNestingDepth || 0} |`);
    if (ast.projectMetrics?.complexMethods?.length > 0) {
      bodyLines.push(`| ⚠️ 高复杂度方法 (AST) | ${ast.projectMetrics.complexMethods.length} |`);
    }
    if (ast.projectMetrics?.longMethods?.length > 0) {
      bodyLines.push(`| ⚠️ 过长方法 (AST) | ${ast.projectMetrics.longMethods.length} |`);
    }
    const patternNames = Object.keys(ast.patternStats || {});
    if (patternNames.length > 0) {
      bodyLines.push(`| 检测到设计模式 (AST) | ${patternNames.join(', ')} |`);
    }
  }
  bodyLines.push('');
  bodyLines.push('### 语言分布', '', '| 扩展名 | 文件数 | 占比 |', '|--------|--------|------|');
  for (const [ext, count] of sortedLangs.slice(0, 8)) {
    bodyLines.push(`| .${ext} | ${count} | ${((count / totalFiles) * 100).toFixed(1)}% |`);
  }
  bodyLines.push('');
  bodyLines.push('### 模块结构', '', '| 模块名 | 职责 | 文件数 |', '|--------|------|--------|');
  for (const tn of targetNames.slice(0, 15)) {
    bodyLines.push(`| ${tn} | ${inferTargetRole(tn)} | ${(targetFileMap[tn] || []).length} |`);
  }
  if (targetNames.length > 15) bodyLines.push(`| …另有 ${targetNames.length - 15} 个模块 | | |`);

  const topLang = sortedLangs[0];
  const results = [{
    title: _makeTitle('project-profile', 'overview'),
    subTopic: 'overview',
    code: _buildCandidateDoc({
      heading: '项目概况',
      oneLiner: `${lang} 项目，${totalFiles} 个文件，${targetNames.length} 个模块`,
      bodyLines,
      agentNotes: ['阅读此文档了解项目全貌，再应用具体 Recipe'],
    }),
    language: 'markdown',
    sources: ['SPM manifest', 'file scan'],
    summary: `${lang} 项目，${totalFiles} 个文件，${targetNames.length} 个模块，主语言 ${topLang ? `.${topLang[0]}(${topLang[1]})` : '未知'}`,
    knowledgeType: 'architecture',
    tags: ['overview'],
  }];

  // ── tech-stack-and-conventions（v4.1 新增：深度项目特征提取）──
  {
    const techLines = [];
    const agentInsights = [];

    // 1) UI 框架检测
    let uikitCount = 0, swiftuiCount = 0;
    const uikitRe = /\b(UIView|UIViewController|UITableView|UICollectionView|UILabel|UIButton|UINavigationController|UITabBarController|UIStoryboard|UIKit)\b/;
    const swiftuiRe = /\b(SwiftUI|@State|@Binding|@Published|@ObservedObject|@StateObject|@EnvironmentObject|@Environment|VStack|HStack|ZStack|NavigationView|NavigationStack|List\s*\{|ForEach\s*\(|\.sheet|\.alert)\b/;
    for (const f of allFiles) {
      if (uikitRe.test(f.content)) uikitCount++;
      if (swiftuiRe.test(f.content)) swiftuiCount++;
    }
    const uiFramework = (uikitCount > 0 && swiftuiCount > 0)
      ? `混合（UIKit ${uikitCount} 文件 + SwiftUI ${swiftuiCount} 文件）`
      : uikitCount > 0 ? `UIKit（${uikitCount} 文件）`
      : swiftuiCount > 0 ? `SwiftUI（${swiftuiCount} 文件）`
      : '未检测到 UI 框架';
    techLines.push(`- **UI 框架**：${uiFramework}`);
    if (uikitCount > 0 && swiftuiCount > 0) {
      agentInsights.push('项目混用 UIKit 与 SwiftUI，新 UI 应确认使用哪种框架后再编写');
    }

    // 2) 架构模式推断（从类名后缀和文件夹结构）
    const archCounts = { ViewModel: 0, Presenter: 0, Interactor: 0, Router: 0, Coordinator: 0, Controller: 0, UseCase: 0, Repository: 0 };
    const archNameRe = /\b(\w+)(ViewModel|Presenter|Interactor|Router|Coordinator|Controller|UseCase|Repository)\b/g;
    const folderPatterns = { mvvm: 0, viper: 0, clean: 0, mvc: 0 };
    for (const f of allFiles.slice(0, 200)) {
      const matches = f.content.matchAll(archNameRe);
      for (const m of matches) {
        const suffix = m[2];
        if (archCounts[suffix] !== undefined) archCounts[suffix]++;
      }
      const lower = f.relativePath.toLowerCase();
      if (/\bviewmodel(s)?\b/.test(lower)) folderPatterns.mvvm++;
      if (/\bpresenter(s)?\b|\binteractor(s)?\b|\brouter(s)?\b/.test(lower)) folderPatterns.viper++;
      if (/\busecase(s)?\b|\brepository\b|\bdomain\b/.test(lower)) folderPatterns.clean++;
    }

    let archPattern = '未明确';
    if (archCounts.Interactor > 2 && archCounts.Presenter > 2 && archCounts.Router > 1) {
      archPattern = 'VIPER';
    } else if (archCounts.ViewModel > 3 || folderPatterns.mvvm > 2) {
      archPattern = 'MVVM';
    } else if (archCounts.UseCase > 2 || folderPatterns.clean > 2) {
      archPattern = 'Clean Architecture';
    } else if (archCounts.Controller > 3 || folderPatterns.mvc > 0) {
      archPattern = 'MVC（传统）';
    }
    if (archCounts.Coordinator > 2) {
      archPattern += ' + Coordinator';
    }
    techLines.push(`- **架构模式**：${archPattern}`);
    const nonZeroArch = Object.entries(archCounts).filter(([, v]) => v > 0);
    if (nonZeroArch.length > 0) {
      techLines.push(`  - 类型后缀统计：${nonZeroArch.map(([k, v]) => `${k}(${v})`).join(', ')}`);
    }
    agentInsights.push(`新模块应遵循 ${archPattern} 架构，保持层次结构一致`);

    // 3) 网络方案推断
    const netPatterns = [
      { name: 'Alamofire', re: /\b(Alamofire|AF\.request|Session\.default|\.responseJSON|\.responseDecodable)\b/ },
      { name: 'Moya', re: /\b(Moya|TargetType|MoyaProvider|\.rx\.request)\b/ },
      { name: 'URLSession', re: /\b(URLSession|URLRequest|URLSessionDataTask|dataTask\(with:|\.data\(for:)\b/ },
      { name: 'NSURLSession/NSURLConnection', re: /\b(NSURLSession|NSURLConnection|NSMutableURLRequest)\b/ },
    ];
    const detectedNet = [];
    for (const p of netPatterns) {
      const count = allFiles.filter(f => p.re.test(f.content)).length;
      if (count > 0) detectedNet.push(`${p.name}(${count} 文件)`);
    }
    techLines.push(`- **网络方案**：${detectedNet.length > 0 ? detectedNet.join(', ') : '未检测到网络层'}`);

    // 4) 领域概念聚类（从类名提取功能域）
    const domainClusters = {};
    const domainSuffixRe = /\b(\w{3,}?)(Controller|ViewController|ViewModel|View|Manager|Service|Handler|Provider|Store|Model|Entity|Cell|Router|Worker)\b/;
    const classNames = ast?.classes?.map(c => c.name) || [];
    for (const name of classNames) {
      if (!name) continue;
      const m = name.match(domainSuffixRe);
      if (m) {
        let domain = m[1];
        domain = domain.replace(/^[A-Z]{2,3}/, '');
        if (domain.length >= 2) {
          domainClusters[domain] = (domainClusters[domain] || 0) + 1;
        }
      }
    }
    const topDomains = Object.entries(domainClusters)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    if (topDomains.length > 0) {
      techLines.push(`- **核心业务域**：${topDomains.map(([k, v]) => `${k}(${v})`).join(', ')}`);
      agentInsights.push(`项目核心业务域：${topDomains.slice(0, 5).map(([k]) => k).join('、')}，新功能命名应对齐这些域概念`);
    }

    // 5) 编码约定汇总（使用共享前缀检测，修复原有 topPrefix 作用域 bug）
    const topPrefix = _computeTopPrefix(allFiles, lang, ast);
    const conventionLines = [];
    if (topPrefix) {
      conventionLines.push(`类名前缀 \`${topPrefix[0]}\``);
    }
    // 注释语言
    let chineseComments = 0, englishComments = 0;
    const commentRe = /\/\/\s*(.{4,40})$/gm;
    for (const f of allFiles.slice(0, 50)) {
      const commentMatches = f.content.matchAll(commentRe);
      for (const cm of commentMatches) {
        if (/[\u4e00-\u9fff]/.test(cm[1])) chineseComments++;
        else if (/^[a-zA-Z\s,.\-:]+$/.test(cm[1].trim())) englishComments++;
      }
    }
    if (chineseComments > 0 || englishComments > 0) {
      const commentLang = chineseComments > englishComments * 2 ? '中文为主'
        : englishComments > chineseComments * 2 ? '英文为主' : '中英混合';
      conventionLines.push(`注释语言${commentLang}`);
    }
    // MARK 使用率
    const markRate = allFiles.length > 0 ? (allFiles.filter(f => /\/\/\s*MARK:\s*-|#pragma\s+mark\s+/m.test(f.content)).length / allFiles.length * 100) : 0;
    if (markRate > 20) conventionLines.push(`MARK 分段（${markRate.toFixed(0)}% 文件使用）`);

    if (conventionLines.length > 0) {
      techLines.push(`- **编码约定**：${conventionLines.join('；')}`);
    }

    results.push({
      title: _makeTitle('project-profile', 'tech-stack'),
      subTopic: 'tech-stack',
      code: _buildCandidateDoc({
        heading: '技术栈与项目特征',
        oneLiner: `${archPattern} 架构，${uiFramework}`,
        bodyLines: techLines,
        agentNotes: agentInsights,
        relationLines: ['EXTENDS: [project-profile/overview] — 补充深层技术特征'],
      }),
      language: 'markdown',
      sources: ['file scan', 'AST analysis'],
      summary: `技术栈：${archPattern}，${uiFramework}`,
      knowledgeType: 'architecture',
      tags: ['tech-stack', 'architecture-pattern', 'conventions'],
      relations: [{ type: 'EXTENDS', target: _makeTitle('project-profile', 'overview'), description: '补充深层技术特征' }],
    });
  }

  // ── third-party-deps（v4 新增：三方依赖枚举与用途推断 + v5: 版本+使用统计）──
  if (depGraphData?.nodes) {
    const projectTargets = new Set(targetNames.map(n => n.toLowerCase()));
    const thirdPartyNodes = (depGraphData.nodes || [])
      .map(n => typeof n === 'string' ? n : n.id || n.label)
      .filter(n => !projectTargets.has(n.toLowerCase()));

    if (thirdPartyNodes.length > 0) {
      // ── 收集版本信息（Package.resolved / Podfile.lock）──
      const versionMap = new Map(); // depName(lowercase) → version string
      try {
        const projectRoot = process.env.ASD_PROJECT_DIR || process.cwd();

        // Package.resolved (SPM) — 支持 v1/v2/v3 格式
        const resolvedPath = pathJoin(projectRoot, 'Package.resolved');
        if (existsSync(resolvedPath)) {
          try {
            const resolved = JSON.parse(readFileSync(resolvedPath, 'utf8'));
            const pins = resolved.pins || resolved.object?.pins || [];
            for (const pin of pins) {
              const pkg = (pin.package || pin.identity || '').toLowerCase();
              const ver = pin.state?.version || pin.state?.revision?.substring(0, 8) || pin.state?.branch || '';
              if (pkg && ver) versionMap.set(pkg, ver);
            }
          } catch { /* skip */ }
        }

        // Podfile.lock (CocoaPods)
        const podfileLock = pathJoin(projectRoot, 'Podfile.lock');
        if (existsSync(podfileLock)) {
          try {
            const lockContent = readFileSync(podfileLock, 'utf8');
            const podRe = /^\s+-\s+(\S+)\s+\(([^)]+)\)/gm;
            let pm;
            while ((pm = podRe.exec(lockContent)) !== null) {
              versionMap.set(pm[1].toLowerCase(), pm[2]);
            }
          } catch { /* skip */ }
        }
      } catch { /* version collection failed — skip */ }

      // ── 扫描项目 import 使用统计 ──
      const importCounts = new Map(); // depName(lowercase) → count
      const depNamesLower = thirdPartyNodes.map(n => n.toLowerCase());
      for (const f of allFiles) {
        if (!/\.(swift|m|mm|h)$/i.test(f.name || '')) continue;
        const lines = f.content.split('\n');
        for (const line of lines) {
          // Swift: import ModuleName / @_exported import ModuleName
          const swiftImport = line.match(/^\s*(?:@_exported\s+)?import\s+(\w+)/);
          if (swiftImport) {
            const mod = swiftImport[1].toLowerCase();
            if (depNamesLower.includes(mod)) {
              importCounts.set(mod, (importCounts.get(mod) || 0) + 1);
            }
            continue;
          }
          // ObjC: #import <ModuleName/...> / @import ModuleName
          const objcImport = line.match(/^\s*(?:#import\s+<(\w+)\/|@import\s+(\w+))/);
          if (objcImport) {
            const mod = (objcImport[1] || objcImport[2]).toLowerCase();
            if (depNamesLower.includes(mod)) {
              importCounts.set(mod, (importCounts.get(mod) || 0) + 1);
            }
          }
        }
      }

      const categories = { networking: [], ui: [], storage: [], utility: [], testing: [], logging: [], other: [] };
      for (const dep of thirdPartyNodes) {
        const lower = dep.toLowerCase();
        if (/alamofire|moya|urlsession|networking|http|api|grpc|socket/.test(lower)) categories.networking.push(dep);
        else if (/snapkit|masonry|kingfisher|sdwebimage|lottie|hero|iglist|rx(cocoa|swift)|combine|swiftui/.test(lower)) categories.ui.push(dep);
        else if (/realm|coredata|grdb|fmdb|sqlite|keychain|userdefaults|cache/.test(lower)) categories.storage.push(dep);
        else if (/quick|nimble|xctest|snapshot|test|mock|stub|ohhttp/.test(lower)) categories.testing.push(dep);
        else if (/cocoalumberjack|swiftybeaver|log|logger|oslog/.test(lower)) categories.logging.push(dep);
        else if (/swifty|then|promise|rx|combine|crypto|zip|json|codable|objectmapper/.test(lower)) categories.utility.push(dep);
        else categories.other.push(dep);
      }

      const depsBodyLines = [
        `- **三方依赖总数**：${thirdPartyNodes.length}`,
        '',
      ];
      for (const [cat, deps] of Object.entries(categories)) {
        if (deps.length === 0) continue;
        const catLabels = {
          networking: '网络', ui: 'UI', storage: '存储', utility: '工具',
          testing: '测试', logging: '日志', other: '其他',
        };
        depsBodyLines.push(`### ${catLabels[cat] || cat}`, '');
        for (const d of deps) {
          const lower = d.toLowerCase();
          const ver = versionMap.get(lower);
          const imp = importCounts.get(lower) || 0;
          const verStr = ver ? ` v${ver}` : '';
          const impStr = imp > 0 ? ` — ${imp} 个文件 import` : '';
          depsBodyLines.push(`- \`${d}\`${verStr}${impStr}`);
        }
        depsBodyLines.push('');
      }

      results.push({
        title: _makeTitle('project-profile', 'third-party-deps'),
        subTopic: 'third-party-deps',
        code: _buildCandidateDoc({
          heading: '三方依赖清单',
          oneLiner: `${thirdPartyNodes.length} 个三方依赖，分为 ${Object.entries(categories).filter(([, v]) => v.length > 0).length} 个类别`,
          bodyLines: depsBodyLines,
          agentNotes: [
            '⛔ 新增三方依赖前检查是否与项目已有依赖重复或冲突',
            '⛔ 优先使用项目已集成的三方库，避免引入功能重叠的新依赖',
            '三方库内部实现不由本项目维护 — Agent 直接使用其公开 API 即可，无需深入了解其内部结构',
            '以上 import 计数反映了项目实际使用深度 — 高 import 数 = 核心依赖，修改需格外谨慎',
          ],
          relationLines: ['EXTENDS: [architecture/dependency-graph] — 补充三方依赖信息'],
        }),
        language: 'markdown',
        sources: ['SPM manifest', 'dependency analysis', 'Package.resolved', 'Podfile.lock'],
        summary: `三方依赖：${thirdPartyNodes.length} 个，${Object.entries(categories).filter(([, v]) => v.length > 0).map(([k, v]) => `${k}(${v.length})`).join('/')}`,
        knowledgeType: 'architecture',
        tags: ['third-party-deps', 'dependencies'],
        relations: [{ type: 'EXTENDS', target: _makeTitle('architecture', 'dependency-graph'), description: '补充三方依赖信息' }],
      });
    }
  }

  // ── base-extensions（v4.2 新增：Extension/Category 分类聚合）──
  {
    let extByBase; // baseClass → [{ name, file, methodCount, hasAssociatedObj/hasComputedProp, kind }]

    // ★ 优先从 PipelineContext 读取 category-scan 缓存（避免重复全量扫描）
    const cachedExtByBase = pipelineCtx?.getCachedResult('category-scan', 'extByBase');
    if (cachedExtByBase && Object.keys(cachedExtByBase).length > 0) {
      extByBase = cachedExtByBase;
    } else {
      // fallback: 无缓存时执行原始扫描
      extByBase = {};

    // 使用 shared/objc-swift-utils.js 的 FOUNDATION_TYPES / UIKIT_TYPES

    if (lang === 'objectivec') {
      // OC Category: @interface BaseClass (CategoryName)
      const catRe = /^@interface\s+(\w+)\s*\(\s*(\w*)\s*\)/;
      const assocObjRe = /objc_setAssociatedObject|objc_getAssociatedObject/;
      for (const f of allFiles) {
        const fileLines = f.content.split('\n');
        const hasAssocObj = assocObjRe.test(f.content);
        for (const line of fileLines) {
          const m = line.match(catRe);
          if (!m) continue;
          const baseClass = m[1];
          const catName = m[2] || 'Anonymous';
          if (!extByBase[baseClass]) extByBase[baseClass] = [];
          // 计算方法数（粗略：同文件内 -/+ 方法声明）
          const methodCount = (f.content.match(/^[-+]\s*\(/gm) || []).length;
          extByBase[baseClass].push({
            name: `${baseClass}(${catName})`,
            file: f.relativePath,
            methodCount,
            hasAssociatedObj: hasAssocObj,
          });
        }
      }
    } else if (lang === 'swift') {
      // Swift Extension: extension BaseClass { ... } or extension BaseClass: Protocol
      const extRe = /^(?:public\s+|internal\s+|private\s+|fileprivate\s+)?extension\s+(\w+)\s*/;
      const computedPropRe = /\bvar\s+\w+\s*:\s*\w+\s*\{/;
      for (const f of allFiles) {
        const fileLines = f.content.split('\n');
        const hasComputedProp = computedPropRe.test(f.content);
        for (let i = 0; i < fileLines.length; i++) {
          const m = fileLines[i].match(extRe);
          if (!m) continue;
          const baseClass = m[1];
          if (!extByBase[baseClass]) extByBase[baseClass] = [];
          // 粗略统计该 extension 的 func 数量
          let funcCount = 0;
          let braceDepth = 0;
          let started = false;
          for (let j = i; j < Math.min(fileLines.length, i + 200); j++) {
            for (const ch of fileLines[j]) {
              if (ch === '{') { braceDepth++; started = true; }
              if (ch === '}') braceDepth--;
            }
            if (/\bfunc\s+/.test(fileLines[j])) funcCount++;
            if (started && braceDepth <= 0) break;
          }
          extByBase[baseClass].push({
            name: `${baseClass}+${f.name.replace(/\.\w+$/, '')}`,
            file: f.relativePath,
            methodCount: funcCount,
            hasComputedProp,
          });
        }
      }
    }
    } // end fallback

    const totalExtensions = Object.values(extByBase).reduce((s, arr) => s + arr.length, 0);
    if (totalExtensions > 0) {
      const extBodyLines = [
        `- **Extension/Category 总数**：${totalExtensions}`,
        `- **扩展的基类数**：${Object.keys(extByBase).length}`,
        '',
      ];

      // 按类别分组输出
      const foundationExts = {};
      const uikitExts = {};
      const customExts = {};
      for (const [base, exts] of Object.entries(extByBase)) {
        if (FOUNDATION_TYPES.has(base)) foundationExts[base] = exts;
        else if (UIKIT_TYPES.has(base)) uikitExts[base] = exts;
        else customExts[base] = exts;
      }

      const hasAssocObj = Object.values(extByBase).flat().some(e => e.hasAssociatedObj);
      const hasComputedProp = Object.values(extByBase).flat().some(e => e.hasComputedProp);

      if (Object.keys(foundationExts).length > 0) {
        const fTotal = Object.values(foundationExts).reduce((s, a) => s + a.length, 0);
        extBodyLines.push(`### Foundation/标准库 Extension（${fTotal} 个）`, '');
        for (const [base, exts] of Object.entries(foundationExts).sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
          extBodyLines.push(`- \`${base}\` — ${exts.length} 个扩展（${exts.map(e => e.file).join(', ')}）`);
        }
        extBodyLines.push('');
      }

      if (Object.keys(uikitExts).length > 0) {
        const uTotal = Object.values(uikitExts).reduce((s, a) => s + a.length, 0);
        extBodyLines.push(`### UIKit/UI Extension（${uTotal} 个）`, '');
        for (const [base, exts] of Object.entries(uikitExts).sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
          extBodyLines.push(`- \`${base}\` — ${exts.length} 个扩展（${exts.map(e => e.file).join(', ')}）`);
        }
        extBodyLines.push('');
      }

      if (Object.keys(customExts).length > 0) {
        const cTotal = Object.values(customExts).reduce((s, a) => s + a.length, 0);
        extBodyLines.push(`### 自定义类型 Extension（${cTotal} 个）`, '');
        for (const [base, exts] of Object.entries(customExts).sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
          extBodyLines.push(`- \`${base}\` — ${exts.length} 个扩展（${exts.map(e => e.file).join(', ')}）`);
        }
        extBodyLines.push('');
      }

      // 特殊能力检测
      if (hasAssocObj) {
        extBodyLines.push('### ⚠️ Associated Objects 使用', '');
        const assocFiles = Object.values(extByBase).flat().filter(e => e.hasAssociatedObj);
        for (const e of assocFiles.slice(0, 5)) {
          extBodyLines.push(`- \`${e.name}\` — ${e.file}`);
        }
        extBodyLines.push('');
      }

      const agentNotes = [
        '新增 Extension/Category 前检查是否已有同基类的扩展，避免方法名冲突',
        '优先在已有的扩展文件中追加方法，保持扩展集中管理',
      ];
      if (hasAssocObj) {
        agentNotes.push('使用 Associated Objects 添加存储属性时注意内存管理策略（OBJC_ASSOCIATION_RETAIN_NONATOMIC vs COPY 等）');
      }
      if (lang === 'objectivec') {
        agentNotes.push('Category 方法名建议加项目前缀（如 xx_methodName）防止与系统/三方库方法冲突');
      }

      results.push({
        title: _makeTitle('project-profile', 'base-extensions'),
        subTopic: 'base-extensions',
        code: _buildCandidateDoc({
          heading: 'Extension/Category 扩展清单',
          oneLiner: `${totalExtensions} 个扩展，覆盖 ${Object.keys(extByBase).length} 个基类（Foundation ${Object.keys(foundationExts).length} / UIKit ${Object.keys(uikitExts).length} / 自定义 ${Object.keys(customExts).length}）`,
          bodyLines: extBodyLines,
          agentNotes,
          relationLines: ['EXTENDS: [project-profile/overview] — 补充基类扩展信息', 'RELATED: [code-pattern/category] — 扩展模式的全局视图'],
        }),
        language: 'markdown',
        sources: [...new Set(Object.values(extByBase).flat().slice(0, 10).map(e => e.file))],
        summary: `Extension/Category：${totalExtensions} 个扩展，覆盖 ${Object.keys(extByBase).length} 个基类`,
        knowledgeType: 'architecture',
        tags: ['base-extensions', 'category', 'extension'],
        relations: [
          { type: 'EXTENDS', target: _makeTitle('project-profile', 'overview'), description: '补充基类扩展信息' },
          { type: 'RELATED', target: _makeTitle('code-pattern', 'category'), description: '扩展模式的全局视图' },
        ],
      });
    }
  }

  // ── base-classes（v4.2 新增：自定义基类层级 + 全局宏/别名/常量）──
  {
    const baseClassLines = [];
    const baseClassSources = [];
    const baseAgentNotes = [];

    // 1) 自定义基类检测：被多个类继承的非系统类
    const inheritorCounts = {}; // className → 被继承次数
    if (ast && ast.inheritanceGraph.length > 0) {
      for (const edge of ast.inheritanceGraph) {
        if (edge.type === 'inherits') {
          inheritorCounts[edge.to] = (inheritorCounts[edge.to] || 0) + 1;
        }
      }
    } else {
      // 无 AST fallback：正则检测
      const inheritRe = lang === 'objectivec'
        ? /@interface\s+\w+\s*:\s*(\w+)/g
        : lang === 'swift'
          ? /class\s+\w+\s*:\s*(\w+)/g
          : null;
      if (inheritRe) {
        for (const f of allFiles.slice(0, 200)) {
          const matches = f.content.matchAll(inheritRe);
          for (const m of matches) {
            const parent = m[1];
            inheritorCounts[parent] = (inheritorCounts[parent] || 0) + 1;
          }
        }
      }
    }

    // 排除系统基类，保留项目自定义基类（被 >=2 个类继承 且不是系统类）
    const systemBaseClasses = new Set([
      'NSObject', 'UIViewController', 'UIView', 'UITableViewCell', 'UICollectionViewCell',
      'UITableViewController', 'UICollectionViewController', 'UINavigationController',
      'UITabBarController', 'UIControl', 'UIResponder', 'UIApplication',
      'NSManagedObject', 'NSOperation', 'NSThread', 'XCTestCase',
      'ObservableObject', 'Codable', 'Hashable', 'Equatable',
    ]);
    const customBases = Object.entries(inheritorCounts)
      .filter(([cls, count]) => count >= 2 && !systemBaseClasses.has(cls))
      .sort((a, b) => b[1] - a[1]);

    if (customBases.length > 0) {
      baseClassLines.push('### 自定义基类层级', '');
      baseClassLines.push('| 基类 | 子类数 | 推测职责 |', '|------|--------|---------|');
      for (const [cls, count] of customBases.slice(0, 15)) {
        const role = /Base|Abstract/.test(cls) ? '抽象基类'
          : /ViewModel/.test(cls) ? 'ViewModel 基类'
          : /Controller/.test(cls) ? 'Controller 基类'
          : /Service/.test(cls) ? 'Service 基类'
          : /Cell/.test(cls) ? 'Cell 基类'
          : /Model/.test(cls) ? 'Model 基类'
          : /View/.test(cls) ? 'View 基类'
          : '自定义基类';
        baseClassLines.push(`| \`${cls}\` | ${count} | ${role} |`);
      }
      baseClassLines.push('');
      baseAgentNotes.push(`新建类时优先继承项目自定义基类（${customBases.slice(0, 3).map(([c]) => c).join('/')}），复用基类能力`);
    }

    // ── 2) 常量定义文件识别 + 全量提取 ──
    //
    // 策略：先找"常量定义文件"（文件名含 Const/Macro/Define/Config/Theme/Color），
    // 对这些文件做 **完整扫描不限数量**；其余文件做采样。
    // 这样确保项目的核心常量表被完整捕获，Agent 才能正确引用。
    //
    // OC: #define 值宏 / 函数宏 / 条件编译宏 / extern const / PCH
    // Swift: 顶层 let/var / enum/struct 命名空间 static let / typealias / 全局函数
    //

    // 判断是否为"常量定义文件"
    const constFileNameRe = /(?:const|constant|macro|define|config|theme|color|colour|font|size|dimension|style|key|notification|url|api|endpoint|global|common|util|helper)/i;
    const isConstFile = (f) => constFileNameRe.test(f.name) || constFileNameRe.test(f.relativePath);
    const constFiles = allFiles.filter(isConstFile);
    const nonConstFiles = allFiles.filter(f => !isConstFile(f));

    if (lang === 'objectivec') {
      // ── OC 宏定义三层分类 ──
      // 层 1: 值宏（#define FOO 123）— 最重要，Agent 必须引用
      // 层 2: 函数宏（#define FOO(x) ...）— 约定性宏，Agent 需要知道用法
      // 层 3: 条件编译宏（#ifdef DEBUG）— 了解即可

      let valueMacros = [];   // { name, value, file, category }
      let funcMacros = [];    // { name, params, body, file }
      const condMacros = new Set(); // 条件编译宏名称集合
      let externConsts = [];  // extern NSString *const / FOUNDATION_EXPORT

      // ★ 优先从 PipelineContext 读取 deep-scan 缓存的常量/宏
      const cachedDefines = pipelineCtx?.getCachedResult('objc-deep-scan', 'defines');
      if (cachedDefines) {
        valueMacros = cachedDefines.valueMacros || [];
        funcMacros = cachedDefines.funcMacros || [];
        externConsts = cachedDefines.externConsts || [];
        // staticConsts 映射到 externConsts（deep-scan 分得更细）
        if (cachedDefines.staticConsts) externConsts.push(...cachedDefines.staticConsts.map(s => ({ name: s.name, file: s.file })));
        // condMacros 仍需扫描（deep-scan 不收集条件编译宏）
        const filesToScan = [...constFiles, ...nonConstFiles.slice(0, 120)];
        for (const f of filesToScan) {
          const fileLines = f.content.split('\n');
          for (let i = 0; i < fileLines.length; i++) {
            const condMatch = fileLines[i].match(/^#(?:if|ifdef|ifndef|elif)\s+(\w+)/);
            if (condMatch && !/^[01]$/.test(condMatch[1])) condMacros.add(condMatch[1]);
          }
        }
      } else {
      // fallback: 无缓存时执行原始扫描

      // 类别推断和多行宏拼接使用 shared/objc-swift-utils.js

      // 扫描：常量文件全量 + 非常量文件采样
      const filesToScan = [...constFiles, ...nonConstFiles.slice(0, 120)];
      for (const f of filesToScan) {
        const fileLines = f.content.split('\n');
        const isConst = isConstFile(f);

        for (let i = 0; i < fileLines.length; i++) {
          const line = fileLines[i];

          // 条件编译宏收集
          const condMatch = line.match(/^#(?:if|ifdef|ifndef|elif)\s+(\w+)/);
          if (condMatch && !/^[01]$/.test(condMatch[1])) {
            condMacros.add(condMatch[1]);
            continue;
          }

          // extern / FOUNDATION_EXPORT 常量
          const externMatch = line.match(/(?:extern|FOUNDATION_EXPORT)\s+(?:NSString|NSInteger|CGFloat|NSNotificationName)\s+\*?\s*(?:const\s+)?(\w+)/);
          if (externMatch) {
            externConsts.push({ name: externMatch[1], file: f.relativePath });
            continue;
          }

          // #define 检测
          if (!line.startsWith('#define ') && !line.startsWith('#define\t')) continue;

          const fullLine = collectMultilineMacro(fileLines, i);

          // 跳过头文件守卫和空定义
          const guardMatch = fullLine.match(/^#define\s+(\w+)\s*$/);
          if (guardMatch) {
            if (/_H_?$|_h_?$|^__/.test(guardMatch[1])) continue;
            // 空宏也记录（可能是 flag）
            valueMacros.push({ name: guardMatch[1], value: '(flag)', file: f.relativePath, category: '编译 Flag' });
            continue;
          }

          // 函数宏: #define FOO(x, y) ...
          const funcMatch = fullLine.match(/^#define\s+(\w+)\(([^)]*)\)\s+(.+)/);
          if (funcMatch) {
            // 常量文件不限数量，非常量文件限 30 个
            if (isConst || funcMacros.length < 30) {
              funcMacros.push({
                name: funcMatch[1],
                params: funcMatch[2].trim(),
                body: funcMatch[3].trim().substring(0, 150),
                file: f.relativePath,
                category: inferMacroCategory(funcMatch[1], funcMatch[3]),
              });
            }
            continue;
          }

          // 值宏: #define FOO value
          const valMatch = fullLine.match(/^#define\s+(\w+)\s+(.+)/);
          if (valMatch) {
            const macroName = valMatch[1];
            const macroValue = valMatch[2].trim();
            if (/_H_?$|_h_?$|^__/.test(macroName)) continue;
            // 常量文件不限数量，非常量文件限 50 个
            if (isConst || valueMacros.length < 50) {
              valueMacros.push({
                name: macroName,
                value: macroValue.substring(0, 200),
                file: f.relativePath,
                category: inferMacroCategory(macroName, macroValue),
              });
            }
          }
        }
      }
      } // end fallback (no cached defines)

      // ── 输出值宏（按类别分组）──
      const totalValueMacros = valueMacros.length;
      if (totalValueMacros > 0) {
        baseClassLines.push(`### 值宏 #define（${totalValueMacros} 个）`, '');

        // 按类别分组
        const byCategory = {};
        for (const m of valueMacros) {
          if (!byCategory[m.category]) byCategory[m.category] = [];
          byCategory[m.category].push(m);
        }

        // 常量定义文件索引（最重要的信息之一）
        const constFileSet = new Set(valueMacros.filter(m => isConstFile({ name: m.file, relativePath: m.file })).map(m => m.file));
        if (constFileSet.size > 0) {
          baseClassLines.push('**📁 常量定义文件**（以下文件中的宏已全量收录）：');
          for (const f of constFileSet) baseClassLines.push(`- ${f}`);
          baseClassLines.push('');
        }

        for (const [cat, macros] of Object.entries(byCategory).sort((a, b) => b[1].length - a[1].length)) {
          baseClassLines.push(`**${cat}（${macros.length} 个）**：`);
          // 常量文件来源的宏全部展示，非常量文件来源的限 6 个
          const fromConst = macros.filter(m => constFileSet.has(m.file));
          const fromOther = macros.filter(m => !constFileSet.has(m.file));
          const toShow = [...fromConst, ...fromOther.slice(0, Math.max(0, 6 - fromConst.length))];
          for (const item of toShow) {
            baseClassLines.push(`- \`${item.name}\` = \`${item.value}\` — ${item.file}`);
          }
          const remaining = macros.length - toShow.length;
          if (remaining > 0) baseClassLines.push(`- …另有 ${remaining} 个`);
          baseClassLines.push('');
        }

        baseAgentNotes.push('⛔ 新代码必须使用项目已定义的宏常量（颜色/字体/尺寸/URL），禁止硬编码');
      }

      // ── 输出函数宏（约定性宏，Agent 需要知道用法）──
      if (funcMacros.length > 0) {
        baseClassLines.push(`### 函数宏（${funcMacros.length} 个）`, '');

        // 按类别分组
        const funcByCategory = {};
        for (const m of funcMacros) {
          if (!funcByCategory[m.category]) funcByCategory[m.category] = [];
          funcByCategory[m.category].push(m);
        }

        for (const [cat, macros] of Object.entries(funcByCategory).sort((a, b) => b[1].length - a[1].length)) {
          baseClassLines.push(`**${cat}（${macros.length} 个）**：`);
          for (const item of macros.slice(0, 8)) {
            baseClassLines.push(`- \`${item.name}(${item.params})\` → \`${item.body.substring(0, 100)}\` — ${item.file}`);
          }
          if (macros.length > 8) baseClassLines.push(`- …另有 ${macros.length - 8} 个`);
          baseClassLines.push('');
        }

        // weakify/strongify 是极重要的约定宏
        const weakifyMacros = funcMacros.filter(m => m.category === 'weakify/strongify');
        if (weakifyMacros.length > 0) {
          baseAgentNotes.push(`Block 中使用项目定义的 ${weakifyMacros.map(m => m.name).join('/')} 宏处理 self 引用，保持一致性`);
        }
        baseAgentNotes.push('优先使用项目已有的函数宏（如颜色/字体/尺寸快捷宏），不要自定义同类新宏');
      }

      // ── 条件编译宏 ──
      if (condMacros.size > 0) {
        const condList = [...condMacros].sort();
        baseClassLines.push(`### 条件编译宏（${condList.length} 个）`, '');
        baseClassLines.push(`\`${condList.join('` `')}\``);
        baseClassLines.push('');
        if (condMacros.has('DEBUG')) {
          baseAgentNotes.push('使用 #ifdef DEBUG 区分调试与发布代码，不要在 Release 中残留调试逻辑');
        }
      }

      // ── extern 常量（OC 字符串/数值常量的标准方式）──
      if (externConsts.length > 0) {
        baseClassLines.push(`### extern 常量（${externConsts.length} 个）`, '');
        for (const ec of externConsts.slice(0, 15)) {
          baseClassLines.push(`- \`${ec.name}\` — ${ec.file}`);
        }
        if (externConsts.length > 15) baseClassLines.push(`- …另有 ${externConsts.length - 15} 个`);
        baseClassLines.push('');
        baseAgentNotes.push('字符串常量优先使用 extern NSString *const 方式（避免 #define 导致的多份拷贝）');
      }

      // ── PCH 文件检测 ──
      const pchFiles = allFiles.filter(f => /\.pch$/i.test(f.name) || /Prefix.*\.pch$/i.test(f.name));
      if (pchFiles.length > 0) {
        baseClassLines.push('### Precompiled Header (PCH)', '');
        for (const pch of pchFiles.slice(0, 2)) {
          const imports = pch.content.split('\n')
            .filter(l => /^#import|^#include|^@import/.test(l.trim()))
            .slice(0, 20);
          baseClassLines.push(`**${pch.relativePath}** — ${imports.length} 个全局导入：`);
          for (const imp of imports) baseClassLines.push(`- \`${imp.trim()}\``);
          baseClassLines.push('');
          baseClassSources.push(pch.relativePath);

          // PCH 中的 #define 也很重要
          const pchDefines = pch.content.split('\n').filter(l => /^#define\s+\w+/.test(l));
          if (pchDefines.length > 0) {
            baseClassLines.push(`**PCH 中的宏定义（${pchDefines.length} 个，全局可用）**：`);
            for (const d of pchDefines.slice(0, 10)) baseClassLines.push(`- \`${d.trim().substring(0, 120)}\``);
            if (pchDefines.length > 10) baseClassLines.push(`- …另有 ${pchDefines.length - 10} 个`);
            baseClassLines.push('');
          }
        }
        baseAgentNotes.push('PCH 中的头文件和宏全局可用，无需在每个文件中重复导入');
      }
    }

    // ── Swift 常量与全局定义 ──
    if (lang === 'swift') {
      const typealiases = [];
      const globalFuncs = [];
      const globalConsts = [];        // 顶层 let/var
      const namespaceConsts = [];     // enum/struct 命名空间中的 static let/var
      const propertyWrappers = [];
      const resultBuilders = [];

      // ── 扫描策略：常量文件全量 + 非常量文件采样 ──
      const swiftFilesToScan = [...constFiles, ...nonConstFiles.slice(0, 120)];

      for (const f of swiftFilesToScan) {
        const fileLines = f.content.split('\n');
        const fIsConst = isConstFile(f);

        // 检测命名空间结构：enum/struct with static members
        // e.g. enum Colors { static let primary = UIColor(...) }
        let inNamespace = null; // { type: 'enum'|'struct', name, depth }
        let braceDepth = 0;

        for (let i = 0; i < fileLines.length; i++) {
          const line = fileLines[i];

          // 跟踪大括号深度
          for (const ch of line) {
            if (ch === '{') braceDepth++;
            if (ch === '}') {
              braceDepth--;
              if (inNamespace && braceDepth < inNamespace.depth) inNamespace = null;
            }
          }

          // @propertyWrapper 检测
          const pwMatch = line.match(/@propertyWrapper\s+(?:public\s+|internal\s+)?struct\s+(\w+)/);
          if (pwMatch) {
            propertyWrappers.push({ name: pwMatch[1], file: f.relativePath });
            continue;
          }

          // @resultBuilder 检测
          const rbMatch = line.match(/@resultBuilder\s+(?:public\s+|internal\s+)?struct\s+(\w+)/);
          if (rbMatch) {
            resultBuilders.push({ name: rbMatch[1], file: f.relativePath });
            continue;
          }

          // typealias 检测（任何层级）
          const taMatch = line.match(/(?:public\s+|internal\s+)?typealias\s+(\w+)\s*=\s*(.+)/);
          if (taMatch) {
            typealiases.push({ name: taMatch[1], value: taMatch[2].trim().substring(0, 100), file: f.relativePath });
            continue;
          }

          // 命名空间入口检测
          const nsMatch = line.match(/^\s*(?:public\s+|internal\s+|private\s+)?(?:final\s+)?(enum|struct)\s+(\w+)\s*(?::\s*\w+)?\s*\{/);
          if (nsMatch) {
            // 判断是否为纯常量命名空间（无 case，主要是 static let/var）
            const nsName = nsMatch[2];
            inNamespace = { type: nsMatch[1], name: nsName, depth: braceDepth };
            continue;
          }

          // 顶层全局定义（braceDepth == 0 或 1 when inside namespace）
          if (braceDepth === 0) {
            // 全局函数
            const funcMatch = line.match(/^(?:public\s+|internal\s+)?func\s+(\w+)\s*\(/);
            if (funcMatch) {
              globalFuncs.push({ name: funcMatch[1], file: f.relativePath });
              continue;
            }

            // 顶层常量
            const constMatch = line.match(/^(?:public\s+|internal\s+)?(?:let|var)\s+(\w+)\s*(?::\s*[\w.<>\[\]?!]+)?\s*=\s*(.+)/);
            if (constMatch) {
              const constName = constMatch[1];
              const constValue = constMatch[2].trim().substring(0, 150);
              // 类别推断
              let cat = '其他';
              if (/color|colour/i.test(constName) || /UIColor|Color\(/i.test(constValue)) cat = '颜色';
              else if (/font/i.test(constName) || /UIFont|Font\./i.test(constValue)) cat = '字体';
              else if (/size|width|height|margin|padding|spacing|inset/i.test(constName)) cat = '尺寸/间距';
              else if (/url|api|endpoint|host|base.*url|domain/i.test(constName)) cat = 'URL/API';
              else if (/key|userDefault/i.test(constName)) cat = 'UserDefaults Key';
              else if (/notification/i.test(constName) || /Notification\.Name/i.test(constValue)) cat = '通知名';
              else if (/duration|delay|interval|timeout|animation/i.test(constName)) cat = '时间/动画';
              else if (/max|min|limit|count|page|default|threshold|retry/i.test(constName)) cat = '业务常量';
              else if (/^k[A-Z]/.test(constName)) cat = '业务常量';

              globalConsts.push({ name: constName, value: constValue, file: f.relativePath, category: cat });
              continue;
            }
          }

          // 命名空间内的 static let/var（最常见的 Swift 常量定义方式）
          if (inNamespace && braceDepth === inNamespace.depth) {
            const staticMatch = line.match(/^\s*(?:public\s+|internal\s+|private\s+)?static\s+(?:let|var)\s+(\w+)\s*(?::\s*[\w.<>\[\]?!]+)?\s*=\s*(.+)/);
            if (staticMatch) {
              const sName = staticMatch[1];
              const sValue = staticMatch[2].trim().substring(0, 150);
              let cat = '其他';
              if (/color|colour/i.test(sName) || /UIColor|Color\(/i.test(sValue)) cat = '颜色';
              else if (/font/i.test(sName) || /UIFont|Font\./i.test(sValue)) cat = '字体';
              else if (/size|width|height|margin|padding|spacing|inset/i.test(sName)) cat = '尺寸/间距';
              else if (/url|api|endpoint|host|base.*url|domain/i.test(sName)) cat = 'URL/API';
              else if (/key|userDefault/i.test(sName)) cat = 'UserDefaults Key';
              else if (/notification/i.test(sName) || /Notification\.Name/i.test(sValue)) cat = '通知名';
              else if (/duration|delay|interval|timeout|animation/i.test(sName)) cat = '时间/动画';
              else if (/max|min|limit|count|page|default|threshold|retry/i.test(sName)) cat = '业务常量';

              namespaceConsts.push({
                namespace: inNamespace.name,
                nsType: inNamespace.type,
                name: sName,
                value: sValue,
                file: f.relativePath,
                category: cat,
              });
            }
          }
        }
      }

      // ── 输出命名空间常量（Swift 最主流的常量定义方式）──
      if (namespaceConsts.length > 0) {
        baseClassLines.push(`### 命名空间常量（${namespaceConsts.length} 个）`, '');

        // 按命名空间分组
        const byNs = {};
        for (const c of namespaceConsts) {
          const nsKey = `${c.nsType} ${c.namespace}`;
          if (!byNs[nsKey]) byNs[nsKey] = { file: c.file, items: [] };
          byNs[nsKey].items.push(c);
        }

        // 常量定义文件索引
        const swiftConstFileSet = new Set(namespaceConsts.filter(c => isConstFile({ name: c.file, relativePath: c.file })).map(c => c.file));
        if (swiftConstFileSet.size > 0) {
          baseClassLines.push('**📁 常量定义文件**（已全量收录）：');
          for (const f of swiftConstFileSet) baseClassLines.push(`- ${f}`);
          baseClassLines.push('');
        }

        for (const [nsKey, nsData] of Object.entries(byNs).sort((a, b) => b[1].items.length - a[1].items.length)) {
          baseClassLines.push(`**\`${nsKey}\`**（${nsData.items.length} 个，${nsData.file}）：`);
          const fromConst = nsData.items.filter(c => swiftConstFileSet.has(c.file));
          const fromOther = nsData.items.filter(c => !swiftConstFileSet.has(c.file));
          const toShow = [...fromConst, ...fromOther.slice(0, Math.max(0, 10 - fromConst.length))];
          for (const c of toShow) {
            baseClassLines.push(`- \`.${c.name}\` = \`${c.value}\``);
          }
          const remaining = nsData.items.length - toShow.length;
          if (remaining > 0) baseClassLines.push(`- …另有 ${remaining} 个`);
          baseClassLines.push('');
        }

        baseAgentNotes.push('⛔ 引用常量时使用命名空间语法（如 `Colors.primary`），不要硬编码字面值');
      }

      // ── 输出顶层全局常量 ──
      if (globalConsts.length > 0) {
        baseClassLines.push(`### 顶层全局常量（${globalConsts.length} 个）`, '');

        const byCategory = {};
        for (const c of globalConsts) {
          if (!byCategory[c.category]) byCategory[c.category] = [];
          byCategory[c.category].push(c);
        }

        for (const [cat, items] of Object.entries(byCategory).sort((a, b) => b[1].length - a[1].length)) {
          baseClassLines.push(`**${cat}（${items.length} 个）**：`);
          for (const c of items.slice(0, 8)) {
            baseClassLines.push(`- \`${c.name}\` = \`${c.value}\` — ${c.file}`);
          }
          if (items.length > 8) baseClassLines.push(`- …另有 ${items.length - 8} 个`);
          baseClassLines.push('');
        }
      }

      // ── typealias ──
      if (typealiases.length > 0) {
        baseClassLines.push(`### Typealias（${typealiases.length} 个）`, '');
        for (const ta of typealiases.slice(0, 15)) {
          baseClassLines.push(`- \`typealias ${ta.name} = ${ta.value}\` — ${ta.file}`);
        }
        if (typealiases.length > 15) baseClassLines.push(`- …另有 ${typealiases.length - 15} 个`);
        baseClassLines.push('');
        baseAgentNotes.push('使用项目定义的 typealias 简化类型引用，保持一致性');
      }

      // ── 全局工具函数 ──
      if (globalFuncs.length > 0) {
        baseClassLines.push(`### 全局工具函数（${globalFuncs.length} 个）`, '');
        for (const gf of globalFuncs.slice(0, 12)) {
          baseClassLines.push(`- \`${gf.name}()\` — ${gf.file}`);
        }
        if (globalFuncs.length > 12) baseClassLines.push(`- …另有 ${globalFuncs.length - 12} 个`);
        baseClassLines.push('');
        baseAgentNotes.push('优先使用项目已有的全局工具函数，避免重复实现');
      }

      // ── @propertyWrapper ──
      if (propertyWrappers.length > 0) {
        baseClassLines.push(`### @propertyWrapper 自定义（${propertyWrappers.length} 个）`, '');
        for (const pw of propertyWrappers) {
          baseClassLines.push(`- \`@${pw.name}\` — ${pw.file}`);
        }
        baseClassLines.push('');
        baseAgentNotes.push(`项目定义了自定义 Property Wrapper（${propertyWrappers.map(p => '@' + p.name).join('/')}），相关场景优先使用`);
      }

      // ── @resultBuilder ──
      if (resultBuilders.length > 0) {
        baseClassLines.push(`### @resultBuilder 自定义（${resultBuilders.length} 个）`, '');
        for (const rb of resultBuilders) {
          baseClassLines.push(`- \`@${rb.name}\` — ${rb.file}`);
        }
        baseClassLines.push('');
      }
    }

    if (baseClassLines.length > 0) {
      results.push({
        title: _makeTitle('project-profile', 'base-classes'),
        subTopic: 'base-classes',
        code: _buildCandidateDoc({
          heading: '基类层级与全局定义',
          oneLiner: `${customBases.length} 个自定义基类${lang === 'objectivec' ? '，含全局宏定义' : '，含 typealias/全局函数'}`,
          bodyLines: baseClassLines,
          agentNotes: baseAgentNotes,
          relationLines: [
            'EXTENDS: [project-profile/overview] — 补充基类与全局定义信息',
            'RELATED: [code-pattern/inheritance] — 继承模式的全局视图',
          ],
        }),
        language: 'markdown',
        sources: baseClassSources.length > 0 ? baseClassSources : ['file scan', 'AST analysis'],
        summary: `基类层级：${customBases.length} 个自定义基类${lang === 'objectivec' ? ' + 宏定义' : ' + typealias'}`,
        knowledgeType: 'architecture',
        tags: ['base-classes', 'global-definitions', 'macros'],
        relations: [
          { type: 'EXTENDS', target: _makeTitle('project-profile', 'overview'), description: '补充基类与全局定义信息' },
          { type: 'RELATED', target: _makeTitle('code-pattern', 'inheritance'), description: '继承模式的全局视图' },
        ],
      });
    }
  }

  // ── event-hooks（v4.2 新增：系统事件 hook 与生命周期入口枚举）──
  {
    const hookLines = [];
    const hookSources = [];
    const hookAgentNotes = [];

    // 1) App 生命周期入口
    const appLifecycleHooks = lang === 'objectivec' ? {
      'application:didFinishLaunchingWithOptions:': /didFinishLaunchingWithOptions/,
      'applicationWillTerminate:': /applicationWillTerminate/,
      'applicationDidBecomeActive:': /applicationDidBecomeActive/,
      'applicationWillResignActive:': /applicationWillResignActive/,
      'applicationDidEnterBackground:': /applicationDidEnterBackground/,
      'applicationWillEnterForeground:': /applicationWillEnterForeground/,
      'application:openURL:': /application.*openURL|handleOpenURL/,
      'application:didReceiveRemoteNotification:': /didReceiveRemoteNotification/,
      'application:didRegisterForRemoteNotificationsWithDeviceToken:': /didRegisterForRemoteNotificationsWithDeviceToken/,
      'application:continueUserActivity:': /continueUserActivity/,
    } : lang === 'swift' ? {
      'application(_:didFinishLaunchingWithOptions:)': /didFinishLaunchingWithOptions/,
      'applicationWillTerminate(_:)': /applicationWillTerminate/,
      'sceneDidBecomeActive(_:)': /sceneDidBecomeActive/,
      'sceneWillResignActive(_:)': /sceneWillResignActive/,
      'sceneDidEnterBackground(_:)': /sceneDidEnterBackground/,
      'sceneWillEnterForeground(_:)': /sceneWillEnterForeground/,
      'scene(_:openURLContexts:)': /openURLContexts/,
      'application(_:open:options:)': /func\s+application.*open.*options/,
      'application(_:didReceiveRemoteNotification:)': /didReceiveRemoteNotification/,
      'application(_:didRegisterForRemoteNotificationsWithDeviceToken:)': /didRegisterForRemoteNotificationsWithDeviceToken/,
      'application(_:continue:)': /func\s+application.*continue.*userActivity/,
    } : {};

    const detectedAppHooks = [];
    for (const [hookName, hookRe] of Object.entries(appLifecycleHooks)) {
      for (const f of allFiles) {
        if (hookRe.test(f.content)) {
          detectedAppHooks.push({ hook: hookName, file: f.relativePath });
          if (!hookSources.includes(f.relativePath)) hookSources.push(f.relativePath);
          break; // 每个 hook 只记录第一个文件
        }
      }
    }

    if (detectedAppHooks.length > 0) {
      hookLines.push('### App 生命周期入口', '');
      hookLines.push('| Hook 方法 | 所在文件 |', '|-----------|---------|');
      for (const h of detectedAppHooks) {
        hookLines.push(`| \`${h.hook}\` | ${h.file} |`);
      }
      hookLines.push('');
      hookAgentNotes.push('修改 App 启动流程时注意 didFinishLaunchingWithOptions 中的初始化顺序');
    }

    // 2) VC 生命周期使用统计
    const vcLifecycle = {
      viewDidLoad: lang === 'objectivec' ? /- \(void\)viewDidLoad/ : /override\s+func\s+viewDidLoad/,
      viewWillAppear: lang === 'objectivec' ? /- \(void\)viewWillAppear/ : /override\s+func\s+viewWillAppear/,
      viewDidAppear: lang === 'objectivec' ? /- \(void\)viewDidAppear/ : /override\s+func\s+viewDidAppear/,
      viewWillDisappear: lang === 'objectivec' ? /- \(void\)viewWillDisappear/ : /override\s+func\s+viewWillDisappear/,
      viewDidDisappear: lang === 'objectivec' ? /- \(void\)viewDidDisappear/ : /override\s+func\s+viewDidDisappear/,
      'dealloc/deinit': lang === 'objectivec' ? /- \(void\)dealloc/ : /\bdeinit\s*\{/,
    };

    const vcHookStats = {};
    for (const [hookName, hookRe] of Object.entries(vcLifecycle)) {
      const count = allFiles.filter(f => hookRe.test(f.content)).length;
      if (count > 0) vcHookStats[hookName] = count;
    }

    if (Object.keys(vcHookStats).length > 0) {
      hookLines.push('### ViewController 生命周期使用', '');
      hookLines.push('| 生命周期方法 | 使用文件数 |', '|-------------|-----------|');
      for (const [hook, count] of Object.entries(vcHookStats)) {
        hookLines.push(`| \`${hook}\` | ${count} |`);
      }
      hookLines.push('');

      const deallocKey = 'dealloc/deinit';
      const viewDidLoadCount = vcHookStats.viewDidLoad || 0;
      const deallocCount = vcHookStats[deallocKey] || 0;
      if (viewDidLoadCount > 0 && deallocCount === 0) {
        hookAgentNotes.push(`⚠️ ${viewDidLoadCount} 个 VC 重写了 viewDidLoad 但没有 ${lang === 'objectivec' ? 'dealloc' : 'deinit'}，可能有资源清理遗漏`);
      } else if (viewDidLoadCount > 0 && deallocCount < viewDidLoadCount * 0.3) {
        hookAgentNotes.push(`仅 ${deallocCount}/${viewDidLoadCount} 个 VC 实现了 ${lang === 'objectivec' ? 'dealloc' : 'deinit'}，注意清理通知/KVO 注册`);
      }
    }

    // 3) Method Swizzling 检测
    // ★ 优先从 PipelineContext 读取 deep-scan 缓存的 swizzle 数据
    let hasSwizzling = false;
    const cachedSwizzle = pipelineCtx?.getCachedResult('objc-deep-scan', 'swizzle');
    if (cachedSwizzle && cachedSwizzle.allHooks?.length > 0) {
      hasSwizzling = true;
      const swizzleFiles = [...new Set(cachedSwizzle.allHooks.map(h => h.file))];
      hookLines.push('### ⚠️ Method Swizzling', '');
      for (const sf of swizzleFiles.slice(0, 8)) {
        hookLines.push(`- ${sf}`);
      }
      hookLines.push('');
      hookAgentNotes.push(`⚠️ 项目使用了 Method Swizzling（${cachedSwizzle.allHooks.length} 处），修改被 swizzle 的方法时务必检查替换逻辑`);
    } else {
      // fallback: 无缓存时自行扫描
      const swizzleRe = lang === 'objectivec'
        ? /method_exchangeImplementations|class_addMethod|class_replaceMethod|method_setImplementation/
        : lang === 'swift'
          ? /method_exchangeImplementations|class_addMethod|class_replaceMethod|@_dynamicReplacement/
          : null;

      if (swizzleRe) {
        const swizzleFiles = [];
        for (const f of allFiles) {
          if (swizzleRe.test(f.content)) {
            swizzleFiles.push(f.relativePath);
          }
        }
        if (swizzleFiles.length > 0) {
          hasSwizzling = true;
          hookLines.push('### ⚠️ Method Swizzling', '');
          for (const sf of swizzleFiles.slice(0, 8)) {
            hookLines.push(`- ${sf}`);
          }
          hookLines.push('');
          hookAgentNotes.push(`⚠️ 项目使用了 Method Swizzling（${swizzleFiles.length} 处），修改被 swizzle 的方法时务必检查替换逻辑`);
        }
      }
    }

    // 4) 自定义 NotificationName / NSNotification.Name 常量
    const notifNameRe = lang === 'objectivec'
      ? /(?:NSNotificationName|NSString\s*\*\s*const|FOUNDATION_EXPORT\s+NSNotificationName)\s+(\w+Notification\w*)/g
      : lang === 'swift'
        ? /(?:static\s+let|extension\s+Notification\.Name)\s*.*?(\w+)\s*=\s*.*Notification\.Name/g
        : null;

    if (notifNameRe) {
      const customNotifNames = [];
      for (const f of allFiles.slice(0, 150)) {
        const matches = f.content.matchAll(notifNameRe);
        for (const m of matches) {
          if (customNotifNames.length < 20) {
            customNotifNames.push({ name: m[1] || m[0], file: f.relativePath });
          }
        }
      }
      if (customNotifNames.length > 0) {
        hookLines.push('### 自定义 Notification 名称', '');
        for (const n of customNotifNames.slice(0, 12)) {
          hookLines.push(`- \`${n.name}\` — ${n.file}`);
        }
        if (customNotifNames.length > 12) hookLines.push(`- …另有 ${customNotifNames.length - 12} 个`);
        hookLines.push('');
        hookAgentNotes.push('发送通知时使用项目已定义的 Notification Name 常量，不要硬编码字符串');
      }
    }

    // 5) Deep Link / URL Scheme 处理
    const deepLinkRe = lang === 'objectivec'
      ? /handleOpenURL|openURL.*options|universalLink|userActivity.*webpageURL/
      : lang === 'swift'
        ? /openURLContexts|open\s+url.*options|universalLink|userActivity.*webpageURL|onOpenURL/
        : null;

    if (deepLinkRe) {
      const deepLinkFiles = allFiles.filter(f => deepLinkRe.test(f.content));
      if (deepLinkFiles.length > 0) {
        hookLines.push('### Deep Link / URL Scheme 入口', '');
        for (const f of deepLinkFiles.slice(0, 5)) {
          hookLines.push(`- ${f.relativePath}`);
        }
        hookLines.push('');
        hookAgentNotes.push('新增 URL Scheme 路由时参考已有的 Deep Link 处理逻辑');
      }
    }

    // 6) +load / +initialize (OC 特有) 或 @main (Swift)
    if (lang === 'objectivec') {
      const loadInitFiles = [];
      const loadRe = /\+\s*\(void\)\s*(load|initialize)\b/;
      for (const f of allFiles) {
        if (loadRe.test(f.content)) {
          const hasLoad = /\+\s*\(void\)\s*load\b/.test(f.content);
          const hasInit = /\+\s*\(void\)\s*initialize\b/.test(f.content);
          loadInitFiles.push({
            file: f.relativePath,
            types: [hasLoad ? '+load' : null, hasInit ? '+initialize' : null].filter(Boolean),
          });
        }
      }
      if (loadInitFiles.length > 0) {
        hookLines.push('### +load / +initialize 入口', '');
        for (const li of loadInitFiles.slice(0, 10)) {
          hookLines.push(`- ${li.file} — ${li.types.join(', ')}`);
        }
        hookLines.push('');
        hookAgentNotes.push('⚠️ +load 在 main() 之前执行，不可依赖 App 初始化完成的状态；+initialize 惰性调用，注意线程安全');
      }
    } else if (lang === 'swift') {
      const mainAnnotation = allFiles.filter(f => /@main\b/.test(f.content));
      if (mainAnnotation.length > 0) {
        hookLines.push('### @main 入口', '');
        for (const f of mainAnnotation) {
          hookLines.push(`- ${f.relativePath}`);
        }
        hookLines.push('');
      }
    }

    if (hookLines.length > 0) {
      results.push({
        title: _makeTitle('project-profile', 'event-hooks'),
        subTopic: 'event-hooks',
        code: _buildCandidateDoc({
          heading: '系统事件 Hook 与生命周期入口',
          oneLiner: `App 入口 ${detectedAppHooks.length} 个，VC 生命周期 ${Object.keys(vcHookStats).length} 种`,
          bodyLines: hookLines,
          agentNotes: hookAgentNotes,
          relationLines: [
            'EXTENDS: [project-profile/overview] — 补充事件 hook 注册点',
            'RELATED: [event-and-data-flow] — hook 是事件流的注册入口',
          ],
        }),
        language: 'markdown',
        sources: hookSources.length > 0 ? hookSources.slice(0, 10) : ['file scan'],
        summary: `事件 Hook：App 入口 ${detectedAppHooks.length} 个，VC 生命周期 ${Object.keys(vcHookStats).length} 种${hasSwizzling ? '，含 Swizzling' : ''}`,
        knowledgeType: 'architecture',
        tags: ['event-hooks', 'lifecycle', 'app-delegate', 'swizzling'],
        relations: [
          { type: 'EXTENDS', target: _makeTitle('project-profile', 'overview'), description: '补充事件 hook 注册点' },
          { type: 'RELATED', target: _makeTitle('event-and-data-flow', 'event-notification'), description: 'hook 是事件流的注册入口' },
        ],
      });
    }
  }

  // ── infra-services（v4.2 新增：基础设施服务注册枚举）──
  {
    // 检测 Manager/Service/Provider/Handler/Store/Coordinator/Engine 等基础类
    const infraSuffixes = ['Manager', 'Service', 'Provider', 'Handler', 'Store', 'Engine', 'Client', 'Helper', 'Utility', 'Adapter', 'Gateway', 'Proxy', 'Factory', 'Pool', 'Cache'];
    const infraClasses = {}; // className → { file, suffix, hasSingleton, role }

    const singletonRe = lang === 'objectivec'
      ? /\bsharedInstance\b|shared\w+|dispatch_once/
      : lang === 'swift'
        ? /static\s+(let|var)\s+shared\b/
        : /\bgetInstance\b|\bshared\b/;

    // 语义分类规则
    const roleKeywords = {
      '网络/API': /network|api|http|request|response|url|endpoint|rest|grpc|socket|download|upload|fetch/i,
      '存储/数据库': /storage|database|db|cache|persist|realm|coredata|sqlite|userdefault|keychain|store|archive|file/i,
      '认证/安全': /auth|login|token|session|credential|security|encrypt|decrypt|oauth|sso|biometric/i,
      '推送/消息': /push|notification|message|apns|firebase|fcm|remote|local.*notif/i,
      '定位/地图': /location|map|geo|gps|coordinate|region|beacon|clocation/i,
      '媒体/相机': /media|camera|photo|video|audio|image|player|avfoundation|capture|record/i,
      '分析/埋点': /analytics|track|event|log|report|statistic|monitor|apm|crash|metric/i,
      '配置/设置': /config|setting|preference|environment|feature.*flag|remote.*config/i,
      'UI工具': /theme|style|appearance|hud|toast|alert|loading|animation|font|color/i,
      '路由/导航': /router|navigator|coordinator|deeplink|url.*scheme|route/i,
    };

    // 从 AST 或正则收集
    const classNameRe = lang === 'objectivec'
      ? /@interface\s+(\w+)\s*[:(]/g
      : lang === 'swift'
        ? /(?:class|struct|enum|actor)\s+(\w+)/g
        : /class\s+(\w+)/g;

    for (const f of allFiles) {
      const matches = f.content.matchAll(classNameRe);
      for (const m of matches) {
        const className = m[1];
        const matchedSuffix = infraSuffixes.find(s => className.endsWith(s));
        if (!matchedSuffix) continue;
        if (infraClasses[className]) continue;

        const hasSingleton = singletonRe.test(f.content);

        // 推断职责
        let role = '其他';
        for (const [roleName, roleRe] of Object.entries(roleKeywords)) {
          if (roleRe.test(className) || roleRe.test(f.content.substring(0, 500))) {
            role = roleName;
            break;
          }
        }

        infraClasses[className] = {
          file: f.relativePath,
          suffix: matchedSuffix,
          hasSingleton,
          role,
        };
      }
    }

    // 也从 AST 补充
    if (ast) {
      for (const cls of ast.classes) {
        const matchedSuffix = infraSuffixes.find(s => cls.name?.endsWith(s));
        if (!matchedSuffix || infraClasses[cls.name]) continue;
        let role = '其他';
        for (const [roleName, roleRe] of Object.entries(roleKeywords)) {
          if (roleRe.test(cls.name)) {
            role = roleName;
            break;
          }
        }
        infraClasses[cls.name] = {
          file: cls.file || 'unknown',
          suffix: matchedSuffix,
          hasSingleton: false,
          role,
        };
      }
    }

    const totalInfra = Object.keys(infraClasses).length;
    if (totalInfra > 0) {
      const infraBodyLines = [
        `- **基础设施类总数**：${totalInfra}`,
        `- **单例模式**：${Object.values(infraClasses).filter(v => v.hasSingleton).length} 个类使用单例`,
        '',
      ];

      // 按职责分组
      const byRole = {};
      for (const [cls, info] of Object.entries(infraClasses)) {
        if (!byRole[info.role]) byRole[info.role] = [];
        byRole[info.role].push({ name: cls, ...info });
      }

      for (const [role, classes] of Object.entries(byRole).sort((a, b) => b[1].length - a[1].length)) {
        infraBodyLines.push(`### ${role}（${classes.length} 个）`, '');
        infraBodyLines.push('| 类名 | 类型 | 单例 | 文件 |', '|------|------|------|------|');
        for (const cls of classes.sort((a, b) => (b.hasSingleton ? 1 : 0) - (a.hasSingleton ? 1 : 0)).slice(0, 8)) {
          infraBodyLines.push(`| \`${cls.name}\` | ${cls.suffix} | ${cls.hasSingleton ? '✅' : '—'} | ${cls.file} |`);
        }
        if (classes.length > 8) infraBodyLines.push(`| …另有 ${classes.length - 8} 个 | | | |`);
        infraBodyLines.push('');
      }

      const infraAgentNotes = [
        '新功能优先复用已有的基础设施服务，不要重复造轮子',
        '调用基础设施服务时通过其 shared/singleton 入口获取实例',
      ];

      // 检测初始化顺序（AppDelegate 中的 setup 调用）
      const appDelegateFile = allFiles.find(f => /AppDelegate/i.test(f.name));
      if (appDelegateFile) {
        const setupCalls = [];
        const setupRe = /\b(setup|configure|register|init|start|launch)\w*\s*\(/gi;
        const fileLines = appDelegateFile.content.split('\n');
        for (let i = 0; i < fileLines.length; i++) {
          const m = fileLines[i].match(setupRe);
          if (m) {
            setupCalls.push({ line: i + 1, call: fileLines[i].trim().substring(0, 80) });
          }
        }
        if (setupCalls.length > 0) {
          infraBodyLines.push('### App 启动初始化顺序', '');
          infraBodyLines.push(`来源：\`${appDelegateFile.relativePath}\``, '');
          for (const sc of setupCalls.slice(0, 15)) {
            infraBodyLines.push(`${sc.line}. \`${sc.call}\``);
          }
          infraBodyLines.push('');
          infraAgentNotes.push('新增启动初始化逻辑时注意插入顺序，某些服务有先后依赖关系');
        }
      }

      results.push({
        title: _makeTitle('project-profile', 'infra-services'),
        subTopic: 'infra-services',
        code: _buildCandidateDoc({
          heading: '基础设施服务注册表',
          oneLiner: `${totalInfra} 个基础设施类，分为 ${Object.keys(byRole).length} 个职责域`,
          bodyLines: infraBodyLines,
          agentNotes: infraAgentNotes,
          relationLines: [
            'EXTENDS: [project-profile/overview] — 补充基础设施服务信息',
            'RELATED: [architecture/dependency-graph] — 服务间依赖关系',
          ],
        }),
        language: 'markdown',
        sources: [...new Set(Object.values(infraClasses).slice(0, 10).map(v => v.file))],
        summary: `基础设施服务：${totalInfra} 个类，${Object.keys(byRole).length} 个职责域`,
        knowledgeType: 'architecture',
        tags: ['infra-services', 'manager', 'service', 'singleton'],
        relations: [
          { type: 'EXTENDS', target: _makeTitle('project-profile', 'overview'), description: '补充基础设施服务信息' },
          { type: 'RELATED', target: _makeTitle('architecture', 'dependency-graph'), description: '服务间依赖关系' },
        ],
      });
    }
  }

  // ── runtime-and-interop（v4.2 新增：OC Runtime / Swift 高级特性 / 语言互操作）──
  {
    const runtimeLines = [];
    const runtimeSources = [];
    const runtimeAgentNotes = [];

    if (lang === 'objectivec' || lang === 'swift') {

      // 1) OC Runtime API 使用检测
      const runtimeAPIs = {
        'objc_setAssociatedObject': /objc_setAssociatedObject/,
        'objc_getAssociatedObject': /objc_getAssociatedObject/,
        'method_exchangeImplementations': /method_exchangeImplementations/,
        'class_addMethod': /class_addMethod/,
        'class_replaceMethod': /class_replaceMethod/,
        'objc_allocateClassPair': /objc_allocateClassPair/,
        'objc_registerClassPair': /objc_registerClassPair/,
        'object_setClass': /object_setClass/,
        'NSClassFromString': /NSClassFromString/,
        'NSSelectorFromString': /NSSelectorFromString/,
        'performSelector': /performSelector/,
        'NSInvocation': /NSInvocation/,
        'respondsToSelector': /respondsToSelector/,
        'conformsToProtocol': /conformsToProtocol/,
        'objc_msgSend': /objc_msgSend/,
        'class_copyMethodList': /class_copyMethodList/,
        'class_copyPropertyList': /class_copyPropertyList/,
        'class_copyIvarList': /class_copyIvarList/,
        'protocol_copyMethodDescriptionList': /protocol_copyMethodDescriptionList/,
      };

      const detectedRuntimeAPIs = {};
      for (const [apiName, apiRe] of Object.entries(runtimeAPIs)) {
        const files = allFiles.filter(f => apiRe.test(f.content));
        if (files.length > 0) {
          detectedRuntimeAPIs[apiName] = {
            count: files.length,
            files: files.slice(0, 3).map(f => f.relativePath),
          };
        }
      }

      if (Object.keys(detectedRuntimeAPIs).length > 0) {
        runtimeLines.push('### OC Runtime API 使用', '');
        runtimeLines.push('| API | 使用文件数 | 代表文件 |', '|-----|-----------|---------|');
        for (const [api, info] of Object.entries(detectedRuntimeAPIs)) {
          runtimeLines.push(`| \`${api}\` | ${info.count} | ${info.files[0]} |`);
          if (!runtimeSources.includes(info.files[0])) runtimeSources.push(info.files[0]);
        }
        runtimeLines.push('');

        if (detectedRuntimeAPIs['method_exchangeImplementations'] || detectedRuntimeAPIs['class_replaceMethod']) {
          runtimeAgentNotes.push('⚠️ 项目使用了 Method Swizzling，修改被 swizzle 的方法时务必小心副作用');
        }
        if (detectedRuntimeAPIs['objc_setAssociatedObject']) {
          runtimeAgentNotes.push('Associated Objects 需注意内存策略（RETAIN/COPY/ASSIGN），避免循环引用');
        }
        if (detectedRuntimeAPIs['performSelector']) {
          runtimeAgentNotes.push('performSelector 调用存在内存泄漏风险（ARC 无法确定返回值引用计数），优先用 Block/Closure 替代');
        }
      }

      // 2) Swift-OC 互操作检测
      const interopMarkers = {
        '@objc': { re: /@objc\b/, label: '@objc 暴露给 OC' },
        '@objcMembers': { re: /@objcMembers/, label: '@objcMembers 整类暴露' },
        'NS_SWIFT_NAME': { re: /NS_SWIFT_NAME/, label: 'NS_SWIFT_NAME （OC→Swift 重命名）' },
        'NS_SWIFT_UNAVAILABLE': { re: /NS_SWIFT_UNAVAILABLE/, label: 'NS_SWIFT_UNAVAILABLE' },
        'NS_REFINED_FOR_SWIFT': { re: /NS_REFINED_FOR_SWIFT/, label: 'NS_REFINED_FOR_SWIFT' },
        'Bridging-Header': { re: /import\s+"[^"]*-Bridging-Header\.h"|Bridging-Header/, label: 'Bridging Header' },
        '@convention(c)': { re: /@convention\s*\(\s*c\s*\)/, label: '@convention(c) C 函数指针' },
        '@convention(block)': { re: /@convention\s*\(\s*block\s*\)/, label: '@convention(block) OC Block' },
      };

      const detectedInterop = {};
      for (const [marker, info] of Object.entries(interopMarkers)) {
        const count = allFiles.filter(f => info.re.test(f.content)).length;
        if (count > 0) detectedInterop[marker] = { count, label: info.label };
      }

      if (Object.keys(detectedInterop).length > 0) {
        runtimeLines.push('### Swift ↔ OC 互操作', '');
        for (const [marker, info] of Object.entries(detectedInterop)) {
          runtimeLines.push(`- **${info.label}**：${info.count} 个文件使用 \`${marker}\``);
        }
        runtimeLines.push('');

        if (detectedInterop['@objc'] || detectedInterop['@objcMembers']) {
          runtimeAgentNotes.push('Swift 类/方法需要被 OC 调用时加 @objc，但不要滥用 @objcMembers（影响二进制大小）');
        }
        if (detectedInterop['Bridging-Header']) {
          runtimeAgentNotes.push('项目使用 Bridging Header 进行 OC→Swift 桥接，新增 OC 头文件需在此注册');
        }
      }

      // 3) Swift 高级语言特性检测
      if (lang === 'swift') {
        const swiftFeatures = {
          '@MainActor': { re: /@MainActor/, label: '主线程 Actor 隔离' },
          '@Sendable': { re: /@Sendable/, label: 'Sendable 并发安全' },
          'actor': { re: /\bactor\s+\w+/, label: 'Actor 类型' },
          'async/await': { re: /\basync\b.*\bawait\b|\bawait\b/, label: 'async/await 结构化并发' },
          'Task {}': { re: /\bTask\s*\{|\bTask\.detached/, label: 'Task 并发任务' },
          'TaskGroup': { re: /\bwithTaskGroup\b|\bwithThrowingTaskGroup\b/, label: 'TaskGroup 并行执行' },
          '@Published': { re: /@Published\b/, label: 'Combine @Published' },
          'AnyPublisher': { re: /\bAnyPublisher\b|\bPublisher\b|\bPassthroughSubject\b|\bCurrentValueSubject\b/, label: 'Combine Publisher' },
          'some View': { re: /\bsome\s+View\b/, label: 'SwiftUI opaque return type' },
          '@Environment': { re: /@Environment\b|\b@EnvironmentObject\b/, label: 'SwiftUI Environment' },
          '@State/@Binding': { re: /@State\b|@Binding\b|@StateObject\b|@ObservedObject\b/, label: 'SwiftUI State 管理' },
          'Codable custom': { re: /func\s+encode\s*\(\s*to\s+encoder|init\s*\(\s*from\s+decoder/, label: '自定义 Codable 编解码' },
          '#if': { re: /#if\s+(DEBUG|targetEnvironment|canImport|os\(|arch\()/, label: '条件编译' },
          'Mirror': { re: /\bMirror\s*\(/, label: 'Mirror 反射' },
          'KeyPath': { re: /\\\.[\w.]+|\bKeyPath\b|\bWritableKeyPath\b/, label: 'KeyPath 表达式' },
          '@dynamicMemberLookup': { re: /@dynamicMemberLookup/, label: '动态成员查找' },
          '@dynamicCallable': { re: /@dynamicCallable/, label: '动态调用' },
        };

        const detectedFeatures = {};
        for (const [feat, info] of Object.entries(swiftFeatures)) {
          const count = allFiles.filter(f => info.re.test(f.content)).length;
          if (count > 0) detectedFeatures[feat] = { count, label: info.label };
        }

        if (Object.keys(detectedFeatures).length > 0) {
          runtimeLines.push('### Swift 高级语言特性', '');

          // 分组展示：并发 / Combine / SwiftUI / 元编程 / 其他
          const concurrencyFeats = ['@MainActor', '@Sendable', 'actor', 'async/await', 'Task {}', 'TaskGroup'];
          const combineFeats = ['@Published', 'AnyPublisher'];
          const swiftuiFeats = ['some View', '@Environment', '@State/@Binding'];
          const metaFeats = ['Mirror', 'KeyPath', '@dynamicMemberLookup', '@dynamicCallable', '#if'];

          function outputGroup(label, keys) {
            const items = keys.filter(k => detectedFeatures[k]);
            if (items.length === 0) return;
            runtimeLines.push(`**${label}**：`);
            for (const k of items) {
              runtimeLines.push(`- \`${k}\` — ${detectedFeatures[k].label}（${detectedFeatures[k].count} 文件）`);
            }
            runtimeLines.push('');
          }

          outputGroup('并发特性', concurrencyFeats);
          outputGroup('Combine', combineFeats);
          outputGroup('SwiftUI', swiftuiFeats);
          outputGroup('元编程 / 反射', metaFeats);

          // 剩余未分组
          const grouped = new Set([...concurrencyFeats, ...combineFeats, ...swiftuiFeats, ...metaFeats]);
          const remaining = Object.entries(detectedFeatures).filter(([k]) => !grouped.has(k));
          if (remaining.length > 0) {
            runtimeLines.push('**其他**：');
            for (const [k, info] of remaining) {
              runtimeLines.push(`- \`${k}\` — ${info.label}（${info.count} 文件）`);
            }
            runtimeLines.push('');
          }

          if (detectedFeatures['async/await'] || detectedFeatures['Task {}']) {
            runtimeAgentNotes.push('项目已采用 Swift Concurrency（async/await），新的异步代码优先使用此模式而非 GCD/回调');
          }
          if (detectedFeatures['@MainActor']) {
            runtimeAgentNotes.push('UI 更新相关代码使用 @MainActor 标注，确保主线程执行');
          }
          if (detectedFeatures['@Published'] || detectedFeatures['AnyPublisher']) {
            runtimeAgentNotes.push('数据绑定优先使用 Combine（@Published / Publisher），保持响应式一致性');
          }
        }
      }

      // 4) OC __attribute__ 使用（OC 特有高级能力）
      if (lang === 'objectivec') {
        const attributes = {
          '__attribute__((constructor))': { re: /__attribute__\(\(constructor\)\)/, label: '构造器（main 前执行）' },
          '__attribute__((destructor))': { re: /__attribute__\(\(destructor\)\)/, label: '析构器（退出时执行）' },
          '__attribute__((cleanup))': { re: /__attribute__\(\(cleanup\)\)/, label: '作用域退出自动清理' },
          '__attribute__((objc_subclassing_restricted))': { re: /__attribute__\(\(objc_subclassing_restricted\)\)/, label: '禁止继承' },
          '__attribute__((objc_requires_super))': { re: /__attribute__\(\(objc_requires_super\)\)|NS_REQUIRES_SUPER/, label: '子类必须调用 super' },
          '__attribute__((overloadable))': { re: /__attribute__\(\(overloadable\)\)/, label: 'C 函数重载' },
          'NS_ASSUME_NONNULL': { re: /NS_ASSUME_NONNULL_BEGIN/, label: 'Nullability 注解' },
          'NS_DESIGNATED_INITIALIZER': { re: /NS_DESIGNATED_INITIALIZER/, label: '指定初始化器' },
        };

        const detectedAttrs = {};
        for (const [attr, info] of Object.entries(attributes)) {
          const count = allFiles.filter(f => info.re.test(f.content)).length;
          if (count > 0) detectedAttrs[attr] = { count, label: info.label };
        }

        if (Object.keys(detectedAttrs).length > 0) {
          runtimeLines.push('### OC __attribute__ / 编译器注解', '');
          for (const [attr, info] of Object.entries(detectedAttrs)) {
            runtimeLines.push(`- \`${attr}\` — ${info.label}（${info.count} 文件）`);
          }
          runtimeLines.push('');

          if (detectedAttrs['NS_ASSUME_NONNULL']) {
            runtimeAgentNotes.push('项目使用 NS_ASSUME_NONNULL，新头文件应包裹在 NS_ASSUME_NONNULL_BEGIN/END 内');
          }
          if (detectedAttrs['__attribute__((objc_requires_super))']) {
            runtimeAgentNotes.push('标记了 NS_REQUIRES_SUPER 的方法，子类重写时必须调用 [super ...]');
          }
        }
      }
    }

    if (runtimeLines.length > 0) {
      results.push({
        title: _makeTitle('project-profile', 'runtime-and-interop'),
        subTopic: 'runtime-and-interop',
        code: _buildCandidateDoc({
          heading: 'Runtime 与语言互操作',
          oneLiner: `${lang === 'swift' ? 'Swift 高级特性 + OC 互操作' : 'OC Runtime API + 编译器注解'}检测`,
          bodyLines: runtimeLines,
          agentNotes: runtimeAgentNotes.length > 0 ? runtimeAgentNotes : ['了解项目的 Runtime 使用情况，避免引入不兼容的特性'],
          relationLines: [
            'EXTENDS: [project-profile/tech-stack] — 补充 Runtime 层面的技术选型',
            'RELATED: [project-profile/base-extensions] — Extension 中常使用 Runtime API',
          ],
        }),
        language: 'markdown',
        sources: runtimeSources.length > 0 ? runtimeSources.slice(0, 10) : ['file scan'],
        summary: `Runtime 与互操作：${runtimeLines.filter(l => l.startsWith('|') && !l.startsWith('| API') && !l.startsWith('|---')).length} 项检测`,
        knowledgeType: 'architecture',
        tags: ['runtime', 'interop', 'objc-runtime', 'swift-features', 'bridging'],
        relations: [
          { type: 'EXTENDS', target: _makeTitle('project-profile', 'tech-stack'), description: '补充 Runtime 层面的技术选型' },
          { type: 'RELATED', target: _makeTitle('project-profile', 'base-extensions'), description: 'Extension 中常使用 Runtime API' },
        ],
      });
    }
  }

  return results;
}

// ── agent-guidelines ──────────────────────────────────────

export function _extractAgentGuidelines(allFiles, lang) {
  const results = [];

  // ── TODO/FIXME 提取 ──
  const markerRe = /\/\/\s*(TODO|FIXME|WARNING|⚠️|IMPORTANT|HACK|XXX):\s*/;
  const pragmaRe = /^#pragma\s+mark\s+/;
  const hashMarkerRe = /^#\s*(TODO|FIXME|HACK|XXX|WARNING|IMPORTANT):\s*/;

  const markersByType = {};
  const markerSources = [];

  for (const f of allFiles.slice(0, 60)) {
    const fileLines = f.content.split('\n');
    for (let i = 0; i < fileLines.length; i++) {
      const line = fileLines[i];
      const match = line.match(markerRe) || line.match(hashMarkerRe);
      if (!match && !pragmaRe.test(line)) continue;

      const markerType = match ? match[1] : 'MARK';
      if (!markersByType[markerType]) markersByType[markerType] = [];
      if (markersByType[markerType].length >= 4) continue;

      const start = Math.max(0, i - 2);
      const end = Math.min(fileLines.length, i + 6);
      markersByType[markerType].push({
        file: f.relativePath,
        line: i + 1,
        context: fileLines.slice(start, end),
      });
      if (!markerSources.includes(f.relativePath)) markerSources.push(f.relativePath);
      i = end; // skip context
    }
  }

  // TODO/FIXME → 单独一条
  const todoFixmeTypes = ['TODO', 'FIXME', 'HACK', 'XXX'];
  const todoMarkers = todoFixmeTypes.flatMap(t => (markersByType[t] || []).map(m => ({ ...m, type: t })));

  if (todoMarkers.length > 0) {
    const codeBlocks = todoMarkers.slice(0, 6).map(m => ({
      language: lang,
      source: `${m.file}:${m.line} [${m.type}]`,
      lines: m.context,
    }));

    results.push({
      title: _makeTitle('agent-guidelines', 'todo-fixme'),
      subTopic: 'todo-fixme',
      code: _buildCandidateDoc({
        heading: '待办事项 (TODO/FIXME)',
        oneLiner: `${todoMarkers.length} 条待办标注`,
        bodyLines: todoFixmeTypes.filter(t => markersByType[t]?.length).map(t => `- **${t}**: ${markersByType[t].length} 条`),
        codeBlocks,
        agentNotes: ['修改相关代码时注意处理这些 TODO/FIXME'],
      }),
      language: lang,
      sources: markerSources,
      summary: `${todoMarkers.length} 条待办标注`,
      knowledgeType: 'boundary-constraint',
      tags: ['todo-fixme'],
    });
  }

  // WARNING/IMPORTANT → mandatory-rules
  const warnTypes = ['WARNING', '⚠️', 'IMPORTANT'];
  const warnMarkers = warnTypes.flatMap(t => (markersByType[t] || []).map(m => ({ ...m, type: t })));

  if (warnMarkers.length > 0) {
    const codeBlocks = warnMarkers.slice(0, 4).map(m => ({
      language: lang,
      source: `${m.file}:${m.line} [${m.type}]`,
      lines: m.context,
    }));

    results.push({
      title: _makeTitle('agent-guidelines', 'mandatory-rules'),
      subTopic: 'mandatory-rules',
      code: _buildCandidateDoc({
        heading: '强制规则 (WARNING/IMPORTANT)',
        oneLiner: `${warnMarkers.length} 条强制约束标注`,
        bodyLines: warnTypes.filter(t => markersByType[t]?.length).map(t => `- **${t}**: ${markersByType[t].length} 条`),
        codeBlocks,
        agentNotes: ['⛔ 这些标注是强制约束，必须遵守'],
      }),
      language: lang,
      sources: markerSources,
      summary: `${warnMarkers.length} 条强制约束`,
      knowledgeType: 'boundary-constraint',
      tags: ['mandatory-rules'],
    });
  }

  // ── coding-principles（v4.1 新增：三大核心原则 — 严谨性/深度特征/完整性）──
  {
    results.push({
      title: _makeTitle('agent-guidelines', 'coding-principles'),
      subTopic: 'coding-principles',
      code: _buildCandidateDoc({
        heading: '⚠️ 三大核心编码原则（强制遵守）',
        oneLiner: '所有产出必须遵循：严谨性、深度特征挖掘、完整性',
        bodyLines: [
          '',
          '### 原则一：严谨性',
          '',
          '- 所有结论必须基于项目实际代码，不可臆测或泛化',
          '- 命名前缀、代码风格等判断需要有充分的统计依据（多个文件/类验证）',
          '- 禁止使用模糊措辞：「本模块」「该文件」「一般来说」等；必须指向具体类名/方法名/文件路径',
          '- 规则和约定的描述必须精确到可执行：能直接作为 Code Review 标准',
          '',
          '### 原则二：深度特征挖掘',
          '',
          '- 不要停留在统计数字层面（文件数、方法数），必须挖掘项目的设计理念和技术决策',
          '- 需要回答「为什么项目这样做」而不仅仅是「项目做了什么」',
          '- 架构模式、技术选型、编码约定等需结合上下文推断出背后的设计意图',
          '- 业务域概念需要从类名/方法名聚类中提取，帮助理解项目领域模型',
          '- 依赖关系不只是列表，要说明依赖的职责和替代方案风险',
          '',
          '### 原则三：完整性',
          '',
          '- 代码示例必须展示完整的使用链路，不能只写一半',
          '  - KVO：注册观察 + observeValueForKeyPath 回调 + dealloc 移除（三件套）',
          '  - Notification：注册 + 处理方法 + 发送通知 + dealloc 移除（四件套）',
          '  - Delegate：协议声明 + weak 属性 + 遵循方法实现（完整链路）',
          '  - Block/Closure：typedef + weakSelf/strongSelf + 回调处理（完整链路）',
          '- 当项目代码只有部分实现时，补充业界标准的完整写法作为参考',
          '- 配置/初始化代码必须包含对应的清理/销毁代码',
          '- 不要假设读者知道另一半在哪里 —— 每个候选都应该是自包含的',
          '',
        ],
        agentNotes: [
          '⛔ 这三个原则是所有产出的质量底线，违反任何一条都需要修正',
          '严谨性：每个断言都要有代码证据支撑',
          '深度特征：从代码表象挖掘到设计意图',
          '完整性：所有代码示例必须是完整可运行的链路',
        ],
      }),
      language: lang,
      sources: ['bootstrap-core-principles'],
      summary: '三大核心编码原则：严谨性 + 深度特征挖掘 + 完整性',
      knowledgeType: 'boundary-constraint',
      tags: ['coding-principles', 'quality-baseline'],
    });
  }

  // ── deprecated-api（v4 新增：废弃 API 标记检测）──
  {
    const deprecatedMarkers = [];
    const deprecatedRe = lang === 'objectivec'
      ? /__attribute__\(\(deprecated\)\)|DEPRECATED_MSG_ATTRIBUTE|DEPRECATED_ATTRIBUTE|API_DEPRECATED|__deprecated/
      : lang === 'swift'
        ? /@available\s*\(\s*\*\s*,\s*deprecated|@available\s*\(\s*iOS\s*,?\s*deprecated|@available\s*\(\s*\*\s*,\s*unavailable|#warning/
        : null;

    if (deprecatedRe) {
      for (const f of allFiles.slice(0, 80)) {
        const fileLines = f.content.split('\n');
        for (let i = 0; i < fileLines.length; i++) {
          if (!deprecatedRe.test(fileLines[i])) continue;
          deprecatedMarkers.push({
            file: f.relativePath,
            line: i + 1,
            context: fileLines.slice(Math.max(0, i - 1), Math.min(fileLines.length, i + 4)),
          });
          if (deprecatedMarkers.length >= 10) break;
        }
        if (deprecatedMarkers.length >= 10) break;
      }
    }

    if (deprecatedMarkers.length > 0) {
      const codeBlocks = deprecatedMarkers.slice(0, 4).map(m => ({
        language: lang,
        source: `${m.file}:${m.line} [DEPRECATED]`,
        lines: m.context,
      }));

      results.push({
        title: _makeTitle('agent-guidelines', 'deprecated-api'),
        subTopic: 'deprecated-api',
        code: _buildCandidateDoc({
          heading: '已废弃 API 标记',
          oneLiner: `${deprecatedMarkers.length} 处已废弃 API 标记`,
          bodyLines: [
            `- **检出数量**：${deprecatedMarkers.length} 处`,
            ...deprecatedMarkers.slice(0, 6).map(m => `- ${m.file}:${m.line}`),
          ],
          codeBlocks,
          agentNotes: [
            '⛔ 不要调用已废弃的 API，使用其推荐的替代方案',
            '修改相关代码时注意迁移废弃 API',
          ],
        }),
        language: lang,
        sources: [...new Set(deprecatedMarkers.map(m => m.file))],
        summary: `已废弃 API：${deprecatedMarkers.length} 处标记`,
        knowledgeType: 'boundary-constraint',
        tags: ['deprecated-api'],
      });
    }
  }

  // ── arch-constraints（v4 新增：从注释推断的架构约束）──
  {
    const constraintRe = /\/\/\s*(DO\s*NOT|MUST\s*NOT|NEVER|禁止|不要|不允许|不可以|严禁|⛔|🚫)\s*/i;
    const archConstraints = [];

    for (const f of allFiles.slice(0, 80)) {
      const fileLines = f.content.split('\n');
      for (let i = 0; i < fileLines.length; i++) {
        if (!constraintRe.test(fileLines[i])) continue;
        archConstraints.push({
          file: f.relativePath,
          line: i + 1,
          text: fileLines[i].trim(),
          context: fileLines.slice(Math.max(0, i - 1), Math.min(fileLines.length, i + 4)),
        });
        if (archConstraints.length >= 10) break;
      }
      if (archConstraints.length >= 10) break;
    }

    if (archConstraints.length > 0) {
      const codeBlocks = archConstraints.slice(0, 4).map(m => ({
        language: lang,
        source: `${m.file}:${m.line} [CONSTRAINT]`,
        lines: m.context,
      }));

      results.push({
        title: _makeTitle('agent-guidelines', 'arch-constraints'),
        subTopic: 'arch-constraints',
        code: _buildCandidateDoc({
          heading: '代码约束注释',
          oneLiner: `${archConstraints.length} 处禁止性约束注释`,
          bodyLines: [
            `- **检出数量**：${archConstraints.length} 处`,
            '',
            ...archConstraints.slice(0, 6).map(c => `- ${c.file}:${c.line} — \`${c.text.substring(0, 80)}\``),
          ],
          codeBlocks,
          agentNotes: [
            '⛔ 必须遵守代码中的禁止性约束注释',
            '修改相关代码时仔细阅读上下文约束',
          ],
        }),
        language: lang,
        sources: [...new Set(archConstraints.map(c => c.file))],
        summary: `代码约束：${archConstraints.length} 处禁止性注释`,
        knowledgeType: 'boundary-constraint',
        tags: ['arch-constraints'],
      });
    }
  }

  // fallback：如果什么都没检测到
  if (results.length === 0) {
    results.push({
      title: _makeTitle('agent-guidelines', 'todo-fixme'),
      subTopic: 'todo-fixme',
      code: _buildCandidateDoc({
        heading: '注释标注',
        oneLiner: '未发现 TODO/FIXME/WARNING/IMPORTANT 注释标注',
        bodyLines: ['- 已扫描 60 个文件，未检测到注释标注'],
        agentNotes: [],
      }),
      language: lang,
      sources: ['bootstrap-scan'],
      summary: '未发现注释标注',
      knowledgeType: 'boundary-constraint',
      tags: ['todo-fixme'],
    });
  }

  return results;
}
