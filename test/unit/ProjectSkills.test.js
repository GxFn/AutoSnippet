/**
 * ProjectSkills — Skill 内容构建器 + createSkill frontmatter 测试
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildProjectSkillContent, SKILL_PART_MAX_CHARS } from '../../lib/external/mcp/handlers/bootstrap/projectSkills.js';
import { createSkill } from '../../lib/external/mcp/handlers/skill.js';

// ─── _parseCandidateDocForSkill 是内部函数，通过 buildProjectSkillContent 间接测 ───

describe('ProjectSkills — buildProjectSkillContent', () => {

  const baseContext = {
    primaryLang: 'objectivec',
    langStats: { objectivec: 100 },
    targetFileMap: {},
    depGraphData: null,
    guardAudit: null,
    astProjectSummary: null,
  };

  // ── code-standard ──

  test('code-standard Skill 包含 heading 和约定列表', () => {
    const dim = { id: 'code-standard', label: '代码规范' };
    const candidates = [{
      subTopic: 'naming',
      summary: 'ObjC naming conventions',
      code: [
        '# ObjC 命名规范',
        '',
        '## 约定',
        '- 类名用大驼峰: BDVideoPlayer',
        '- 方法名用小驼峰: playWithURL:',
        '',
        '## Agent 注意事项',
        '- 禁止使用下划线前缀作为公开方法名',
      ].join('\n'),
      sources: ['BDVideoPlayer.h'],
    }];

    const result = buildProjectSkillContent(dim, candidates, baseContext);

    expect(result).toContain('# Project Coding Standards');
    expect(result).toContain('## Naming Conventions');
    expect(result).toContain('类名用大驼峰');
    expect(result).toContain('⛔');
    expect(result).toContain('BDVideoPlayer.h');
  });

  test('code-standard Skill 保留代码参考片段 (referenceSnippets)', () => {
    const dim = { id: 'code-standard', label: '代码规范' };
    const candidates = [{
      subTopic: 'naming',
      summary: 'Naming',
      code: [
        '# 命名规范',
        '',
        '## 约定',
        '- 使用 BD 前缀',
        '',
        '## 代码示例',
        '```objectivec',
        '@interface BDAppDelegate : UIResponder',
        '@end',
        '```',
      ].join('\n'),
      sources: [],
    }];

    const result = buildProjectSkillContent(dim, candidates, baseContext);
    expect(result).toContain('**Code examples:**');
    expect(result).toContain('BDAppDelegate');
  });

  // ── architecture ──

  test('architecture Skill 包含 AST 指标和模块角色', () => {
    const dim = { id: 'architecture', label: '架构模式' };
    const candidates = [{
      subTopic: 'layer-overview',
      summary: '三层架构',
      code: [
        '# 模块分层',
        '',
        '## 约定',
        '- UI 层不直接访问 DAO',
        '',
        '## Agent 注意事项',
        '- 严禁跨层引用',
      ].join('\n'),
    }];

    const ctx = {
      ...baseContext,
      astProjectSummary: {
        classes: new Array(50),
        protocols: new Array(10),
        categories: new Array(5),
        projectMetrics: {
          totalMethods: 200,
          avgMethodsPerClass: 4.0,
          maxNestingDepth: 3,
          complexMethods: [],
        },
      },
      targetFileMap: { BDCore: [], BDService: [], BDPlayerUI: [] },
    };

    const result = buildProjectSkillContent(dim, candidates, ctx);
    expect(result).toContain('# Project Architecture');
    expect(result).toContain('Module Layering');
    expect(result).toContain('Classes/Structs: 50');
    expect(result).toContain('⛔');
  });

  // ── category-scan ──

  test('category-scan Skill 内容过长时自动拆分为多 part', () => {
    const dim = { id: 'category-scan', label: '基础类分类方法扫描' };
    // 制造大量 candidates，每个有很多方法签名
    const candidates = [];
    for (let i = 0; i < 50; i++) {
      const methods = [];
      for (let j = 0; j < 100; j++) {
        methods.push(`#### - (void)method${i}_${j}:(NSString *)param`);
      }
      candidates.push({
        subTopic: `category/NSString+BD${i}`,
        summary: `NSString 扩展 ${i}`,
        code: [
          `# NSString (BD${i})`,
          '',
          ...methods,
        ].join('\n'),
      });
    }

    const result = buildProjectSkillContent(dim, candidates, baseContext);

    // 应该返回数组（多 part）
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(1);
    // 每个 part 不超过 SKILL_PART_MAX_CHARS
    for (const part of result) {
      expect(part.length).toBeLessThanOrEqual(SKILL_PART_MAX_CHARS);
    }
    // 每个 part 都有 header 和 Instructions
    for (const part of result) {
      expect(part).toContain('Instructions for the agent');
    }
    // 每个 part 标题含 "Part X/Y"
    expect(result[0]).toMatch(/Part 1\//);
    // 没有内容被丢弃 — 所有 50 个 Category heading 都应该出现在某个 part 中
    const allContent = result.join('\n');
    for (let i = 0; i < 50; i++) {
      expect(allContent).toContain(`NSString (BD${i})`);
    }
  });

  test('category-scan Skill 内容不超限时返回单个字符串', () => {
    const dim = { id: 'category-scan', label: '基础类分类方法扫描' };
    const candidates = [{
      subTopic: `category/UIView+BDLayout`,
      summary: 'UIView 布局扩展',
      code: ['# UIView (BDLayout)', '', '#### - (void)test:(id)arg'].join('\n'),
    }];

    const result = buildProjectSkillContent(dim, candidates, baseContext);
    // 不超限返回数组但只有一个元素
    if (Array.isArray(result)) {
      expect(result).toHaveLength(1);
    } else {
      expect(typeof result).toBe('string');
    }
  });

  test('category-scan Skill 每个 Category 最多显示 30 个方法', () => {
    const dim = { id: 'category-scan', label: '基础类分类方法扫描' };
    const methods = [];
    for (let j = 0; j < 60; j++) {
      methods.push(`#### - (void)method_${j}:(id)arg`);
    }
    const candidates = [{
      subTopic: `category/UIView+BDLayout`,
      summary: 'UIView 布局扩展',
      code: ['# UIView (BDLayout)', '', ...methods].join('\n'),
    }];

    const result = buildProjectSkillContent(dim, candidates, baseContext);
    const content = Array.isArray(result) ? result.join('\n') : result;
    const methodLines = content.split('\n').filter(l => l.startsWith('- - (void)method_'));
    expect(methodLines.length).toBe(30);
    expect(content).toContain('另有 30 个方法');
  });

  // ── project-profile ──

  test('project-profile Skill 包含概览信息', () => {
    const dim = { id: 'project-profile', label: '项目特征' };
    const candidates = [{
      subTopic: 'overview',
      summary: '视频播放器项目',
      code: [
        '# 项目概览',
        '',
        '## 约定',
        '| 字段 | 值 |',
        '|---|---|',
        '| 语言 | ObjC |',
        '| 架构 | MVVM |',
      ].join('\n'),
    }];

    const result = buildProjectSkillContent(dim, candidates, baseContext);
    expect(result).toContain('# Project Profile');
    expect(result).toContain('MVVM');
  });

  // ── agent-guidelines ──

  test('agent-guidelines Skill 包含 Three Core Principles', () => {
    const dim = { id: 'agent-guidelines', label: 'Agent开发注意事项' };
    const candidates = [{
      subTopic: 'mandatory-rules',
      summary: '必须遵守的规则',
      code: [
        '# 强制规则',
        '',
        '## 约定',
        '- 禁止在主线程做网络请求',
        '',
        '## Agent 注意事项',
        '- 所有网络请求必须在后台线程',
      ].join('\n'),
    }];

    const result = buildProjectSkillContent(dim, candidates, baseContext);
    expect(result).toContain('Three Core Quality Principles');
    expect(result).toContain('Mandatory Rules');
    expect(result).toContain('禁止在主线程做网络请求');
  });

  // ── generic / fallback ──

  test('unknown dimension 使用 _buildGenericSkill', () => {
    const dim = { id: 'custom-dim', label: '自定义维度' };
    const candidates = [{
      subTopic: 'general',
      summary: 'Some info',
      code: '# Custom\n\n## 约定\n- Rule A',
    }];

    const result = buildProjectSkillContent(dim, candidates, baseContext);
    expect(result).toContain('# 自定义维度');
    expect(result).toContain('Rule A');
  });
});

// ─── createSkill frontmatter ──────────────────────────────

describe('createSkill — frontmatter title', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asd-skill-test-'));
    // 设置 ASD_PROJECT_DIR 指向临时目录
    process.env.ASD_PROJECT_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.ASD_PROJECT_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('传入 title 参数时写入 frontmatter', () => {
    const result = JSON.parse(createSkill({}, {
      name: 'test-skill-with-title',
      description: 'A test skill',
      content: '# My Skill Title\n\nSome content.',
      title: 'My Skill Title',
      createdBy: 'test',
    }));

    expect(result.success).toBe(true);

    const skillPath = result.data.path;
    const raw = fs.readFileSync(skillPath, 'utf-8');
    expect(raw).toContain('title: "My Skill Title"');
    expect(raw).toContain('name: test-skill-with-title');
    expect(raw).toContain('description: A test skill');
  });

  test('未传 title 时自动从 content # heading 提取', () => {
    const result = JSON.parse(createSkill({}, {
      name: 'test-auto-title',
      description: 'Auto title test',
      content: '# Auto Extracted Title\n\nBody here.',
      createdBy: 'test',
    }));

    expect(result.success).toBe(true);
    const raw = fs.readFileSync(result.data.path, 'utf-8');
    expect(raw).toContain('title: "Auto Extracted Title"');
  });

  test('content 无 # heading 时 frontmatter 无 title 字段', () => {
    const result = JSON.parse(createSkill({}, {
      name: 'test-no-title',
      description: 'No title test',
      content: 'Just plain content without heading.',
      createdBy: 'test',
    }));

    expect(result.success).toBe(true);
    const raw = fs.readFileSync(result.data.path, 'utf-8');
    expect(raw).not.toContain('title:');
  });

  test('title 包含双引号时正确转义', () => {
    const result = JSON.parse(createSkill({}, {
      name: 'test-escaped-title',
      description: 'Escaped title test',
      content: '# Title with "quotes"\n\nBody.',
      createdBy: 'test',
    }));

    expect(result.success).toBe(true);
    const raw = fs.readFileSync(result.data.path, 'utf-8');
    expect(raw).toContain('title: "Title with \\"quotes\\""');
  });
});

// ─── _parseCandidateDocForSkill — referenceSnippets ──────

describe('_parseCandidateDocForSkill — referenceSnippets via buildProjectSkillContent', () => {

  const baseContext = {
    primaryLang: 'objectivec',
    langStats: {},
    targetFileMap: {},
    depGraphData: null,
    guardAudit: null,
    astProjectSummary: null,
  };

  test('最多保留 3 个代码块（每个 ≤15 行）', () => {
    const dim = { id: 'code-standard', label: '代码规范' };
    const codeBlocks = [];
    for (let i = 0; i < 5; i++) {
      codeBlocks.push('```objectivec', `// block ${i}`, '```');
    }
    const candidates = [{
      subTopic: 'naming',
      summary: 'test',
      code: ['# Test', '', '## 约定', '- Rule 1', '', ...codeBlocks].join('\n'),
      sources: [],
    }];

    const result = buildProjectSkillContent(dim, candidates, baseContext);
    const blockCount = (result.match(/```objectivec/g) || []).length;
    expect(blockCount).toBe(3); // 最多 3 个
  });

  test('超过 15 行的代码块被丢弃', () => {
    const dim = { id: 'code-standard', label: '代码规范' };
    const longBlock = ['```objectivec'];
    for (let i = 0; i < 20; i++) longBlock.push(`// line ${i}`);
    longBlock.push('```');

    const shortBlock = ['```objectivec', '// short', '```'];

    const candidates = [{
      subTopic: 'naming',
      summary: 'test',
      code: ['# Test', '', ...longBlock, '', ...shortBlock].join('\n'),
      sources: [],
    }];

    const result = buildProjectSkillContent(dim, candidates, baseContext);
    expect(result).toContain('// short');
    expect(result).not.toContain('// line 0');
  });
});

// ─── _parseCandidateDocForSkill — section name flexibility ──

describe('_parseCandidateDocForSkill — flexible section parsing', () => {

  const baseContext = {
    primaryLang: 'objectivec',
    langStats: {},
    targetFileMap: {},
    depGraphData: null,
    guardAudit: null,
    astProjectSummary: null,
  };

  test('任意 ## section 下的列表项都被作为 conventions 收集', () => {
    const dim = { id: 'code-standard', label: '代码规范' };
    const candidates = [{
      subTopic: 'naming',
      summary: 'Naming conventions',
      code: [
        '# 命名约定',
        '',
        '## 前缀规范',
        '- BD 前缀用于所有公开类',
        '- UI 组件使用 BDUI 前缀',
        '',
        '## 方法命名',
        '- get/set 不使用 ObjC 风格',
        '| 模式 | 示例 |',
        '|---|---|',
        '| fetch | fetchUserInfo |',
      ].join('\n'),
      sources: [],
    }];

    const result = buildProjectSkillContent(dim, candidates, baseContext);
    expect(result).toContain('BD 前缀用于所有公开类');
    expect(result).toContain('UI 组件使用 BDUI 前缀');
    expect(result).toContain('get/set 不使用 ObjC 风格');
    expect(result).toContain('fetchUserInfo');
  });

  test('Agent 注意事项 section 仍单独收集为 agentNotes', () => {
    const dim = { id: 'agent-guidelines', label: 'Agent开发注意事项' };
    const candidates = [{
      subTopic: 'mandatory-rules',
      summary: 'Rules',
      code: [
        '# 强制规则',
        '',
        '## Agent 注意事项',
        '- 禁止在主线程做網络请求',
        '- 所有常量必须使用项目定义',
      ].join('\n'),
    }];

    const result = buildProjectSkillContent(dim, candidates, baseContext);
    expect(result).toContain('⛔ 禁止在主线程做網络请求');
    expect(result).toContain('⛔ 所有常量必须使用项目定义');
  });
});

// ─── category-scan — split parts ──

describe('category-scan — split instead of truncate', () => {

  const baseContext = {
    primaryLang: 'objectivec',
    langStats: {},
    targetFileMap: {},
    depGraphData: null,
    guardAudit: null,
    astProjectSummary: null,
  };

  test('大量 Category 拆分为多 part，每 part 不超 SKILL_PART_MAX_CHARS', () => {
    const dim = { id: 'category-scan', label: '基础类分类方法扫描' };
    const candidates = [];
    for (let i = 0; i < 50; i++) {
      const methods = [];
      for (let j = 0; j < 40; j++) {
        methods.push(`#### \`- (void)method_${i}_${j}:(NSString *)param defaultValue:(NSString *)defaultValue\` — ${j} 次调用`);
      }
      candidates.push({
        subTopic: `category/NSObject+BD${i}`,
        summary: `NSObject 扩展 ${i}: ${40} 个方法，100 次调用`,
        code: [`# NSObject (BD${i})`, '', ...methods].join('\n'),
      });
    }

    const result = buildProjectSkillContent(dim, candidates, baseContext);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(1);
    // 每个 part 不超过上限
    for (const part of result) {
      expect(part.length).toBeLessThanOrEqual(SKILL_PART_MAX_CHARS);
    }
    // 所有 50 个 Category 都在某个 part 中（无丢弃）
    const allContent = result.join('\n');
    for (let i = 0; i < 50; i++) {
      expect(allContent).toContain(`NSObject (BD${i})`);
    }
  });

  test('deep-scan 过长时也拆分为多 part', () => {
    const dim = { id: 'objc-deep-scan', label: '深度扫描（常量/Hook）' };
    const candidates = [];
    // 制造大量 defines candidates
    for (let i = 0; i < 30; i++) {
      const convs = [];
      for (let j = 0; j < 20; j++) convs.push(`- 常量 ${i}_${j}: 值 ${j}, 引用 ${j * 10} 次`);
      candidates.push({
        subTopic: `defines/MacroFile${i}.h`,
        summary: `MacroFile${i}.h 常量文件：${20} 个宏/常量`,
        code: [`# MacroFile${i} 常量`, '', '## 约定', ...convs].join('\n'),
      });
    }
    const result = buildProjectSkillContent(dim, candidates, baseContext);
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 1) {
      for (const part of result) {
        expect(part.length).toBeLessThanOrEqual(SKILL_PART_MAX_CHARS);
        expect(part).toContain('Instructions for the agent');
      }
    }
  });
});
