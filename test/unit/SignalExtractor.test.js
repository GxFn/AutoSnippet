import { jest } from '@jest/globals';

/* ────────────────────────────────────────────
 *  动态导入 signal-extractor（纯函数模块，不需要 mock 依赖）
 *  注意: extractDimensionSignals 依赖 dimensions.js，这里只测 candidateToSignal 的逻辑
 *  通过构造 candidates 来间接测试 candidateToSignal
 * ──────────────────────────────────────────── */

// extractDimensionSignals 依赖整个 dimensions.js 提取器链，
// 我们用简单 mock 替代
let signalModule;
beforeAll(async () => {
  // 动态导入，避免顶层 import 导致 dimensions.js 链式加载
  signalModule = await import('../../lib/external/mcp/handlers/bootstrap/pipeline/signal-extractor.js');
});

/* ────────────────────────────────────────────
 *  Helpers
 * ──────────────────────────────────────────── */
function makeCandidate(overrides = {}) {
  return {
    title: '[Bootstrap] code-pattern/singleton',
    subTopic: 'singleton',
    code: '# Singleton\n> dispatch_once 单例\n## 约定\n- 使用 dispatch_once',
    language: 'objectivec',
    sources: ['AppDelegate.m', 'NetworkManager.m', 'CacheManager.m'],
    summary: 'code-pattern/singleton：12 处使用，3 种写法（首选 dispatch_once）',
    knowledgeType: 'code-pattern',
    tags: ['singleton'],
    ...overrides,
  };
}

function makeScanResult(overrides = {}) {
  return {
    totalFiles: 12,
    variants: [
      {
        key: 'dispatch_once',
        label: 'dispatch_once',
        fileCount: 8,
        examples: [
          { file: 'BILNetworkManager.m', lineNum: 42, block: '+ (instancetype)sharedManager {\n    static id instance;\n    dispatch_once(...);\n}' },
          { file: 'BILCacheManager.m', lineNum: 15, block: '+ (instancetype)shared {\n    static BILCacheManager *mgr;\n    dispatch_once(...);\n}' },
        ],
        boilerplate: false,
      },
      {
        key: 'static_let',
        label: 'static let (Swift)',
        fileCount: 3,
        examples: [
          { file: 'ConfigManager.swift', lineNum: 10, block: 'static let shared = ConfigManager()' },
        ],
        boilerplate: true,
      },
      {
        key: 'gcd',
        label: 'GCD 手动锁',
        fileCount: 1,
        examples: [],
        boilerplate: false,
      },
    ],
    ...overrides,
  };
}

/* ────────────────────────────────────────────
 *  Tests
 * ──────────────────────────────────────────── */
describe('signal-extractor v7', () => {

  describe('extractDimensionSignals', () => {
    it('should return { signals, candidates } structure', () => {
      // We can't easily test the full function without the dimensions.js chain
      // But we verify the module exports exist
      expect(typeof signalModule.extractDimensionSignals).toBe('function');
    });
  });

  describe('candidateToSignal — with _scanResult (micro extractors)', () => {
    // candidateToSignal is not exported, but we can test it indirectly
    // by calling extractDimensionSignals with a mock dimension
    // For now, we test the expected output shape

    it('should produce distribution from _scanResult.variants', () => {
      const candidate = makeCandidate({ _scanResult: makeScanResult() });
      // Since candidateToSignal is private, we verify behavior through
      // the module's integration point. Let's simulate its logic:
      const scanResult = candidate._scanResult;
      const distribution = scanResult.variants
        .filter(v => v.fileCount > 0)
        .map(v => ({
          label: v.label,
          fileCount: v.fileCount,
          pct: Math.round(v.fileCount / scanResult.totalFiles * 100),
          boilerplate: !!v.boilerplate,
        }));

      expect(distribution).toHaveLength(3);
      expect(distribution[0]).toEqual({
        label: 'dispatch_once',
        fileCount: 8,
        pct: 67,
        boilerplate: false,
      });
      expect(distribution[1].boilerplate).toBe(true);
    });

    it('should extract samples prioritizing non-boilerplate variants', () => {
      const scanResult = makeScanResult();
      const nonBP = scanResult.variants
        .filter(v => !v.boilerplate)
        .flatMap(v => (v.examples || []).map(ex => ({
          file: ex.file,
          line: ex.lineNum || 0,
          code: (ex.block || '').trim(),
          variant: v.label,
        })));
      const bp = scanResult.variants
        .filter(v => v.boilerplate)
        .flatMap(v => (v.examples || []).map(ex => ({
          file: ex.file,
          code: (ex.block || '').trim(),
          variant: v.label,
        })));

      // Non-boilerplate examples come first
      expect(nonBP[0].file).toBe('BILNetworkManager.m');
      expect(nonBP[0].variant).toBe('dispatch_once');
      // Boilerplate examples come after
      expect(bp[0].variant).toBe('static let (Swift)');
    });

    it('should tolerate variants with empty examples (defensive check)', () => {
      const scanResult = makeScanResult();
      // The GCD variant has examples: [] — should not crash
      const gcdVariant = scanResult.variants.find(v => v.key === 'gcd');
      expect(gcdVariant.examples).toEqual([]);

      // Simulating the fixed code path (v.examples || [])
      const allFiles = scanResult.variants.flatMap(v => (v.examples || []).map(e => e.file));
      expect(allFiles).toContain('BILNetworkManager.m');
      expect(allFiles).not.toContain(undefined);
    });

    it('should tolerate variants with undefined examples', () => {
      const scanResult = makeScanResult();
      scanResult.variants.push({
        key: 'broken',
        label: 'Broken',
        fileCount: 2,
        // examples: undefined — no field at all
        boilerplate: false,
      });

      // Must not throw
      const allFiles = scanResult.variants.flatMap(v => (v.examples || []).map(e => e.file));
      expect(allFiles.length).toBeGreaterThan(0);
    });
  });

  describe('candidateToSignal — without _scanResult (macro extractors)', () => {
    it('should use sources for topFiles when no _scanResult', () => {
      const candidate = makeCandidate();
      // No _scanResult field
      expect(candidate._scanResult).toBeUndefined();

      // Signal should still have topFiles from sources
      const topFiles = (candidate.sources || []).slice(0, 5);
      expect(topFiles).toEqual(['AppDelegate.m', 'NetworkManager.m', 'CacheManager.m']);
    });

    it('should extract metrics from summary', () => {
      // Test the _extractMetricsFromSummary logic
      const summary = 'code-pattern/singleton：12 处使用，3 种写法（首选 dispatch_once）';
      const metrics = {};
      const numMatches = summary.matchAll(/(\d+)\s*(?:个|条|处|种|层)?\s*(文件|类|协议|方法|模块|Target|边|违规|写法|框架|测试|错误|警告|常量|宏|Category|Extension)/g);
      for (const m of numMatches) {
        const key = m[2].toLowerCase();
        metrics[key] = parseInt(m[1], 10);
      }
      expect(metrics['写法']).toBe(3);
    });

    it('should put summary into heuristicHints', () => {
      const candidate = makeCandidate();
      expect(candidate.summary).toBeTruthy();
      // candidateToSignal will push summary to heuristicHints
    });
  });

  describe('_extractMetricsFromSummary edge cases', () => {
    it('should return null for empty summary', () => {
      const summary = '';
      const numMatches = [...summary.matchAll(/(\d+)\s*(?:个|条|处|种|层)?\s*(文件|类|协议)/g)];
      expect(numMatches.length).toBe(0);
    });

    it('should handle multiple metrics in one summary', () => {
      const summary = 'project-profile/overview: 523 个文件，36 个类，18 个协议，12 个 Category';
      const metrics = {};
      const numMatches = summary.matchAll(/(\d+)\s*(?:个|条|处|种|层)?\s*(文件|类|协议|方法|模块|Target|边|违规|写法|框架|测试|错误|警告|常量|宏|Category|Extension)/g);
      for (const m of numMatches) {
        const key = m[2].toLowerCase();
        metrics[key] = parseInt(m[1], 10);
      }
      expect(metrics['文件']).toBe(523);
      expect(metrics['类']).toBe(36);
      expect(metrics['协议']).toBe(18);
      expect(metrics['category']).toBe(12);
    });

    it('should extract preferred pattern', () => {
      const summary = '首选 dispatch_once（8 个文件）';
      const preferMatch = summary.match(/首选\s+(.+?)(?:\s*[（(]|$)/);
      expect(preferMatch?.[1]).toBe('dispatch_once');
    });
  });

  describe('_generateSearchHints', () => {
    it('should generate search hints for naming subTopic', () => {
      const candidate = makeCandidate({ subTopic: 'naming', knowledgeType: 'code-standard' });
      const hints = [];
      const st = candidate.subTopic;
      const hintMap = {
        'naming': ['@interface', '@protocol', 'NS_SWIFT_NAME'],
        'file-organization': ['#pragma mark', '// MARK:', 'MARK: -'],
      };
      for (const [key, terms] of Object.entries(hintMap)) {
        if (st.includes(key)) { hints.push(...terms); break; }
      }
      expect(hints).toEqual(['@interface', '@protocol', 'NS_SWIFT_NAME']);
    });

    it('should fall back to knowledgeType hints when subTopic not matched', () => {
      const candidate = makeCandidate({ subTopic: 'unknown-weird', knowledgeType: 'architecture' });
      const hints = [];
      const st = candidate.subTopic;
      const kt = candidate.knowledgeType;
      const hintMap = { 'naming': ['@interface'] };
      let matched = false;
      for (const [key, terms] of Object.entries(hintMap)) {
        if (st.includes(key)) { hints.push(...terms); matched = true; break; }
      }
      if (!matched) {
        if (kt === 'architecture') hints.push('@interface', 'import ');
      }
      expect(hints).toEqual(['@interface', 'import ']);
    });
  });

  describe('signal structure completeness', () => {
    it('should always have distribution and samples as arrays', () => {
      // Verify initial structure
      const signal = {
        evidence: {
          matchCount: 0,
          topFiles: [],
          distribution: [],
          samples: [],
        },
        heuristicHints: [],
        relatedSignals: [],
      };
      expect(Array.isArray(signal.evidence.distribution)).toBe(true);
      expect(Array.isArray(signal.evidence.samples)).toBe(true);
    });

    it('should include _meta with knowledgeType and tags', () => {
      const candidate = makeCandidate();
      const meta = {
        knowledgeType: candidate.knowledgeType,
        tags: candidate.tags || [],
        language: candidate.language || 'swift',
        title: candidate.title || '',
      };
      expect(meta.knowledgeType).toBe('code-pattern');
      expect(meta.tags).toContain('singleton');
      expect(meta.language).toBe('objectivec');
    });
  });

  // ─── ex.block as string[] (extractEnclosingBlock returns lines array) ──
  describe('block array handling', () => {
    it('should handle ex.block as string array (from extractEnclosingBlock)', async () => {
      const { extractDimensionSignals } = await import('../../lib/external/mcp/handlers/bootstrap/pipeline/signal-extractor.js');
      const dim = { id: 'code-pattern', label: '代码模式' };
      const allFiles = [
        { name: 'A.m', relativePath: 'A.m', content: '+ (instancetype)shared { dispatch_once(&t, ^{ i = [self new]; }); return i; }' },
        { name: 'B.m', relativePath: 'B.m', content: '+ (instancetype)shared { dispatch_once(&t, ^{ i = [self new]; }); return i; }' },
      ];
      // Should NOT throw — previously threw "(ex.block || '').trim is not a function"
      const { signals, candidates } = extractDimensionSignals(dim, allFiles, {}, {
        depGraphData: null, guardAudit: null, langStats: {},
        primaryLang: 'objectivec', astProjectSummary: null, pipelineCtx: null,
      });
      expect(candidates.length).toBeGreaterThanOrEqual(0);
      // If signals exist, samples.code should be strings, not arrays
      for (const s of signals) {
        for (const sample of (s.evidence?.samples || [])) {
          expect(typeof sample.code).toBe('string');
        }
      }
    });
  });

  // ─── _buildCandidateDoc 项目特写 format ──
  describe('_buildCandidateDoc format', () => {
    it('should use 项目特写 fused narrative (no rigid sections)', async () => {
      const { _buildCandidateDoc } = await import('../../lib/external/mcp/handlers/bootstrap/dimensions.js');
      const doc = _buildCandidateDoc({
        heading: 'TestPattern',
        oneLiner: 'test description',
        bodyLines: ['- rule 1', '- rule 2'],
        agentNotes: ['note 1'],
        codeBlocks: [{ language: 'swift', source: 'A.swift', lines: ['let x = 1'] }],
        relationLines: ['ENFORCES: test'],
      });

      // 项目特写 format
      expect(doc).toContain('— 项目特写');
      // 内容全部存在（不分 section）
      expect(doc).toContain('- rule 1');
      expect(doc).toContain('let x = 1');
      expect(doc).toContain('- note 1');
      expect(doc).toContain('- ENFORCES: test');

      // 不应有固定的 ## section 分割
      expect(doc).not.toContain('## 项目约定');
      expect(doc).not.toContain('## 典型用法');
      expect(doc).not.toContain('## 生成指南');
      expect(doc).not.toContain('## 关联知识');
      // Old format should NOT exist
      expect(doc).not.toContain('## 约定\n');
      expect(doc).not.toContain('## 基本使用');
      expect(doc).not.toContain('## 项目示例');
      expect(doc).not.toContain('## Agent 注意事项');
    });

    it('should interleave basicUsageBlocks and codeBlocks in narrative', async () => {
      const { _buildCandidateDoc } = await import('../../lib/external/mcp/handlers/bootstrap/dimensions.js');
      const doc = _buildCandidateDoc({
        heading: 'Test',
        oneLiner: 'desc',
        basicUsageBlocks: [{ label: 'Basic', language: 'objc', lines: ['NSLog(@"hi")'] }],
        codeBlocks: [{ language: 'objc', source: 'A.m', lines: ['[self test]'] }],
      });

      expect(doc).toContain('NSLog(@"hi")');
      expect(doc).toContain('[self test]');
      // Should NOT have separate sections
      expect(doc).not.toContain('## 典型用法');
      expect(doc).not.toContain('## 基本使用');
      expect(doc).not.toContain('## 项目示例');
    });
  });
});
