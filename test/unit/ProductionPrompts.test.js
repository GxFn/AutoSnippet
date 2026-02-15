import { jest } from '@jest/globals';

/* ────────────────────────────────────────────
 *  动态导入 production-prompts
 * ──────────────────────────────────────────── */
let buildDimensionProductionPrompt, buildBootstrapSystemPrompt;

beforeAll(async () => {
  const mod = await import('../../lib/external/mcp/handlers/bootstrap/pipeline/production-prompts.js');
  buildDimensionProductionPrompt = mod.buildDimensionProductionPrompt;
  buildBootstrapSystemPrompt = mod.buildBootstrapSystemPrompt;
});

/* ────────────────────────────────────────────
 *  Helpers
 * ──────────────────────────────────────────── */
function makeDim(overrides = {}) {
  return {
    id: 'code-pattern',
    label: '代码模式',
    guide: '分析项目中的常见代码模式',
    knowledgeTypes: ['code-pattern'],
    skillWorthy: false,
    dualOutput: false,
    ...overrides,
  };
}

function makeContext(overrides = {}) {
  return {
    project: {
      projectName: 'TestProject',
      primaryLang: 'objectivec',
      fileCount: 500,
      targetCount: 3,
      modules: ['AppTarget', 'NetworkModule', 'Utils'],
    },
    previousDimensions: {},
    existingCandidates: [],
    ...overrides,
  };
}

function makeMicroSignal(overrides = {}) {
  return {
    dimId: 'code-pattern',
    subTopic: 'singleton',
    evidence: {
      matchCount: 12,
      topFiles: ['NetworkManager.m', 'CacheManager.m'],
      distribution: [
        { label: 'dispatch_once', fileCount: 8, pct: 67, boilerplate: false },
        { label: 'static let', fileCount: 3, pct: 25, boilerplate: true },
        { label: 'GCD', fileCount: 1, pct: 8, boilerplate: false },
      ],
      samples: [
        { file: 'NetworkManager.m', line: 42, code: '+ (instancetype)shared { ... }', variant: 'dispatch_once' },
      ],
    },
    heuristicHints: ['12 处使用单例，首选 dispatch_once'],
    relatedSignals: [],
    _meta: { knowledgeType: 'code-pattern', tags: ['singleton'], language: 'objectivec', title: 'Singleton' },
    ...overrides,
  };
}

function makeMacroSignal(overrides = {}) {
  return {
    dimId: 'code-standard',
    subTopic: 'naming',
    evidence: {
      matchCount: 36,
      topFiles: ['AppDelegate.m', 'ViewController.m'],
      distribution: [],   // macro extractors don't have distribution
      samples: [],         // macro extractors don't have samples
      metrics: { '类': 36, '协议': 18 },
      searchHints: ['@interface', '@protocol', 'NS_SWIFT_NAME'],
    },
    heuristicHints: ['code-standard/naming: 命名约定：BIL 前缀，36 个类，18 个协议'],
    relatedSignals: [],
    _meta: { knowledgeType: 'code-standard', tags: ['naming'], language: 'objectivec', title: 'Naming' },
    ...overrides,
  };
}

/* ────────────────────────────────────────────
 *  Tests
 * ──────────────────────────────────────────── */
describe('production-prompts v9', () => {

  describe('buildDimensionProductionPrompt', () => {
    it('should build complete prompt with all sections', () => {
      const prompt = buildDimensionProductionPrompt(
        makeDim(),
        [makeMicroSignal()],
        makeContext()
      );

      // Should contain all major sections
      expect(prompt).toContain('# Role');
      expect(prompt).toContain('TestProject');
      expect(prompt).toContain('# 当前维度: 代码模式');
      expect(prompt).toContain('# 扫描信号');
      expect(prompt).toContain('# 工作指令');
      expect(prompt).toContain('# 质量红线');
    });

    it('should render micro signal distribution', () => {
      const prompt = buildDimensionProductionPrompt(
        makeDim(),
        [makeMicroSignal()],
        makeContext()
      );

      expect(prompt).toContain('写法分布 (3 种)');
      expect(prompt).toContain('dispatch_once: 8 个文件 (67%)');
      expect(prompt).toContain('static let: 3 个文件 (25%) [boilerplate]');
    });

    it('should render micro signal samples', () => {
      const prompt = buildDimensionProductionPrompt(
        makeDim(),
        [makeMicroSignal()],
        makeContext()
      );

      expect(prompt).toContain('代码样本 (1/1 个)');
      expect(prompt).toContain('(NetworkManager.m:42)');
      expect(prompt).toContain('[写法: dispatch_once]');
    });

    it('should render macro signal metrics', () => {
      const prompt = buildDimensionProductionPrompt(
        makeDim({ id: 'code-standard', label: '代码标准' }),
        [makeMacroSignal()],
        makeContext()
      );

      expect(prompt).toContain('关键指标');
      expect(prompt).toContain('类: 36');
      expect(prompt).toContain('协议: 18');
    });

    it('should render macro signal searchHints', () => {
      const prompt = buildDimensionProductionPrompt(
        makeDim({ id: 'code-standard', label: '代码标准' }),
        [makeMacroSignal()],
        makeContext()
      );

      expect(prompt).toContain('建议搜索');
      expect(prompt).toContain('search_project_code');
      expect(prompt).toContain('"@interface"');
    });

    it('should mention search_project_code in workflow section', () => {
      const prompt = buildDimensionProductionPrompt(
        makeDim(),
        [makeMicroSignal()],
        makeContext()
      );

      expect(prompt).toContain('search_project_code');
      expect(prompt).toContain('read_project_file');
      expect(prompt).toContain('项目特写');
    });

    it('should mention quality guardrails with real code requirement', () => {
      const prompt = buildDimensionProductionPrompt(
        makeDim(),
        [makeMicroSignal()],
        makeContext()
      );

      expect(prompt).toContain('代码必须真实');
      expect(prompt).toContain('具体名字和数字');
    });

    it('should include previousDimensions when present', () => {
      const ctx = makeContext({
        previousDimensions: {
          'code-pattern': {
            summary: '分析了 5 种代码模式',
            candidateCount: 5,
            keyFindings: ['dispatch_once 是首选单例模式'],
            crossRefs: { 'best-practice': '检查 weakSelf 与 singleton 结合' },
            gaps: [],
          },
        },
      });
      const prompt = buildDimensionProductionPrompt(
        makeDim({ id: 'best-practice', label: '最佳实践' }),
        [makeMicroSignal({ dimId: 'best-practice', subTopic: 'memory-mgmt' })],
        ctx
      );

      expect(prompt).toContain('已分析维度');
      expect(prompt).toContain('dispatch_once 是首选单例模式');
      expect(prompt).toContain('检查 weakSelf 与 singleton 结合');
    });

    it('should handle skillWorthy dimension', () => {
      const prompt = buildDimensionProductionPrompt(
        makeDim({ skillWorthy: true, dualOutput: false }),
        [makeMicroSignal()],
        makeContext()
      );

      // Skill-only workflow — no submit_candidate
      expect(prompt).toContain('Skill-Only 模式');
      expect(prompt).not.toContain('submit_candidate');
    });

    it('should enforce 项目特写 style in workflow', () => {
      const prompt = buildDimensionProductionPrompt(
        makeDim(),
        [makeMicroSignal()],
        makeContext()
      );

      // 融合叙事风格：不应强制固定 section
      expect(prompt).not.toContain('## 约定');
      expect(prompt).not.toContain('## 项目示例');
      expect(prompt).not.toContain('## Agent 注意事项');

      // 「项目特写」风格引导
      expect(prompt).toContain('— 项目特写');
      expect(prompt).toContain('项目特写风格');
    });

    it('should enforce quality guardrails', () => {
      const prompt = buildDimensionProductionPrompt(
        makeDim(),
        [makeMicroSignal()],
        makeContext()
      );

      expect(prompt).toContain('项目特写');
      expect(prompt).toContain('真实');
      expect(prompt).toContain('质量优先于数量');
    });

    it('should handle empty signals array', () => {
      const prompt = buildDimensionProductionPrompt(
        makeDim(),
        [],
        makeContext()
      );

      expect(prompt).toContain('扫描信号 (0 条)');
    });
  });

  describe('buildBootstrapSystemPrompt', () => {
    it('should list available tools', () => {
      const tools = [
        { name: 'submit_candidate', description: '提交候选' },
        { name: 'search_project_code', description: '搜索项目源码' },
        { name: 'read_project_file', description: '读取项目文件' },
      ];
      const prompt = buildBootstrapSystemPrompt(tools);

      expect(prompt).toContain('submit_candidate');
      expect(prompt).toContain('search_project_code');
      expect(prompt).toContain('read_project_file');
      expect(prompt).toContain('项目特写');
    });
  });
});
