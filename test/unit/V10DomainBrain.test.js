import { jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* ────────────────────────────────────────────
 *  动态导入
 * ──────────────────────────────────────────── */
let ALL_TOOLS;
let buildMinimalPrompt, buildDimensionProductionPrompt;

beforeAll(async () => {
  const toolsMod = await import('../../lib/service/chat/tools.js');
  ALL_TOOLS = toolsMod.ALL_TOOLS || toolsMod.default;

  const promptsMod = await import('../../lib/external/mcp/handlers/bootstrap/pipeline/production-prompts.js');
  buildMinimalPrompt = promptsMod.buildMinimalPrompt;
  buildDimensionProductionPrompt = promptsMod.buildDimensionProductionPrompt;
});

/* ────────────────────────────────────────────
 *  Helpers
 * ──────────────────────────────────────────── */
function findTool(name) {
  return ALL_TOOLS.find(t => t.name === name);
}

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

// 创建临时项目目录结构用于工具测试
let tmpDir;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asd-v10-test-'));
  // 创建目录结构
  fs.mkdirSync(path.join(tmpDir, 'src', 'models'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'src', 'services'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });

  // 创建一个 ObjC 文件
  fs.writeFileSync(path.join(tmpDir, 'src', 'models', 'User.m'), `
#import "User.h"
#import <Foundation/Foundation.h>

@interface User : NSObject
@property (nonatomic, copy) NSString *name;
@property (nonatomic, assign) NSInteger age;
- (instancetype)initWithName:(NSString *)name age:(NSInteger)age;
- (NSDictionary *)toDictionary;
@end

@implementation User
- (instancetype)initWithName:(NSString *)name age:(NSInteger)age {
    self = [super init];
    if (self) {
        _name = [name copy];
        _age = age;
    }
    return self;
}
- (NSDictionary *)toDictionary {
    return @{@"name": self.name, @"age": @(self.age)};
}
@end
`);

  // 创建一个 Swift 文件
  fs.writeFileSync(path.join(tmpDir, 'src', 'services', 'NetworkManager.swift'), `
import Foundation
import Alamofire

public class NetworkManager {
    static let shared = NetworkManager()
    private var session: URLSession
    
    private init() {
        let config = URLSessionConfiguration.default
        self.session = URLSession(configuration: config)
    }
    
    func request(_ url: String, completion: @escaping (Result<Data, Error>) -> Void) {
        guard let url = URL(string: url) else { return }
        session.dataTask(with: url) { data, _, error in
            if let error = error {
                completion(.failure(error))
            } else if let data = data {
                completion(.success(data))
            }
        }.resume()
    }
}
`);

  // 创建一个 JS 文件
  fs.writeFileSync(path.join(tmpDir, 'src', 'services', 'ApiClient.js'), `
import axios from 'axios';
import { Logger } from '../utils/Logger.js';

export class ApiClient {
  #baseUrl;
  #logger;

  constructor(baseUrl) {
    this.#baseUrl = baseUrl;
    this.#logger = new Logger('ApiClient');
  }

  async get(endpoint) {
    this.#logger.info('GET', endpoint);
    return axios.get(this.#baseUrl + endpoint);
  }

  async post(endpoint, data) {
    return axios.post(this.#baseUrl + endpoint, data);
  }
}
`);

  // 创建 node_modules 中的文件（应被过滤）
  fs.mkdirSync(path.join(tmpDir, 'node_modules', 'some-lib'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'node_modules', 'some-lib', 'index.js'), 'module.exports = {}');
});

afterAll(() => {
  // 清理临时目录
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/* ════════════════════════════════════════════════════════════
 *  P0: list_project_structure
 * ════════════════════════════════════════════════════════════ */
describe('P0: list_project_structure', () => {
  const ctx = () => ({ projectRoot: tmpDir });

  test('tool exists in ALL_TOOLS', () => {
    const tool = findTool('list_project_structure');
    expect(tool).toBeDefined();
    expect(tool.name).toBe('list_project_structure');
    expect(tool.parameters.properties).toHaveProperty('directory');
    expect(tool.parameters.properties).toHaveProperty('depth');
  });

  test('returns directory tree with file stats', async () => {
    const tool = findTool('list_project_structure');
    const result = await tool.handler({}, ctx());

    expect(result.tree).toBeDefined();
    expect(result.tree).toContain('src/');
    expect(result.stats).toBeDefined();
    expect(result.stats.totalFiles).toBeGreaterThan(0);
    expect(result.stats.byLanguage).toBeDefined();
  });

  test('filters out node_modules', async () => {
    const tool = findTool('list_project_structure');
    const result = await tool.handler({ depth: 5 }, ctx());

    expect(result.tree).not.toContain('node_modules');
  });

  test('respects directory parameter', async () => {
    const tool = findTool('list_project_structure');
    const result = await tool.handler({ directory: 'src/models' }, ctx());

    expect(result.tree).toContain('User.m');
    expect(result.directory).toBe('src/models');
  });

  test('respects depth limit', async () => {
    const tool = findTool('list_project_structure');
    const result = await tool.handler({ depth: 1 }, ctx());

    // At depth 1, should show top-level dirs but not their contents
    expect(result.tree).toContain('src/');
    // Sub-files inside src should NOT appear at depth 1 since src itself is at depth 1
    // and its children would be at depth 2
  });

  test('rejects path traversal', async () => {
    const tool = findTool('list_project_structure');
    const result = await tool.handler({ directory: '../../etc' }, ctx());
    expect(result.error).toContain('Path traversal');
  });

  test('works with includeStats=false', async () => {
    const tool = findTool('list_project_structure');
    const result = await tool.handler({ includeStats: false }, ctx());

    expect(result.tree).toBeDefined();
    expect(result.stats).toBeUndefined();
  });
});

/* ════════════════════════════════════════════════════════════
 *  P0: get_file_summary
 * ════════════════════════════════════════════════════════════ */
describe('P0: get_file_summary', () => {
  const ctx = () => ({ projectRoot: tmpDir });

  test('tool exists in ALL_TOOLS', () => {
    const tool = findTool('get_file_summary');
    expect(tool).toBeDefined();
    expect(tool.parameters.required).toContain('filePath');
  });

  test('extracts ObjC declarations from .m file', async () => {
    const tool = findTool('get_file_summary');
    const result = await tool.handler({ filePath: 'src/models/User.m' }, ctx());

    expect(result.language).toBe('objectivec');
    expect(result.lineCount).toBeGreaterThan(10);
    expect(result.imports.length).toBeGreaterThanOrEqual(1);
    expect(result.declarations.length).toBeGreaterThanOrEqual(1);
    expect(result.methods.length).toBeGreaterThanOrEqual(2);
    expect(result.properties.length).toBeGreaterThanOrEqual(2);
  });

  test('extracts Swift declarations', async () => {
    const tool = findTool('get_file_summary');
    const result = await tool.handler({ filePath: 'src/services/NetworkManager.swift' }, ctx());

    expect(result.language).toBe('swift');
    expect(result.imports).toEqual(expect.arrayContaining([
      expect.stringContaining('Foundation'),
    ]));
    expect(result.declarations.length).toBeGreaterThanOrEqual(1);
    expect(result.methods.length).toBeGreaterThanOrEqual(1);
  });

  test('extracts JS declarations', async () => {
    const tool = findTool('get_file_summary');
    const result = await tool.handler({ filePath: 'src/services/ApiClient.js' }, ctx());

    expect(result.language).toBe('javascript');
    expect(result.imports.length).toBeGreaterThanOrEqual(1);
    expect(result.declarations.length).toBeGreaterThanOrEqual(1);
  });

  test('handles file not found', async () => {
    const tool = findTool('get_file_summary');
    const result = await tool.handler({ filePath: 'nonexistent.swift' }, ctx());
    expect(result.error).toContain('not found');
  });

  test('rejects path traversal', async () => {
    const tool = findTool('get_file_summary');
    const result = await tool.handler({ filePath: '../../../etc/passwd' }, ctx());
    expect(result.error).toContain('Path traversal');
  });

  test('uses fileCache when available', async () => {
    const tool = findTool('get_file_summary');
    const result = await tool.handler(
      { filePath: 'cached-file.swift' },
      {
        projectRoot: tmpDir,
        fileCache: [
          { relativePath: 'cached-file.swift', content: 'import UIKit\nclass MyView: UIView {\n  func setup() {\n  }\n}' },
        ],
      },
    );

    expect(result.language).toBe('swift');
    expect(result.imports).toEqual(expect.arrayContaining([expect.stringContaining('UIKit')]));
    expect(result.declarations.length).toBeGreaterThanOrEqual(1);
  });
});

/* ════════════════════════════════════════════════════════════
 *  P1: semantic_search_code
 * ════════════════════════════════════════════════════════════ */
describe('P1: semantic_search_code', () => {
  test('tool exists in ALL_TOOLS', () => {
    const tool = findTool('semantic_search_code');
    expect(tool).toBeDefined();
    expect(tool.parameters.required).toContain('query');
    expect(tool.parameters.properties).toHaveProperty('topK');
    expect(tool.parameters.properties).toHaveProperty('category');
    expect(tool.parameters.properties).toHaveProperty('language');
  });

  test('returns fallback error when no engine available', async () => {
    const tool = findTool('semantic_search_code');
    const result = await tool.handler(
      { query: 'error handling' },
      { projectRoot: tmpDir, container: null },
    );

    expect(result.error).toBeDefined();
    expect(result.fallbackTool).toBe('search_project_code');
  });

  test('handles empty query', async () => {
    const tool = findTool('semantic_search_code');
    const result = await tool.handler(
      { query: '' },
      { container: { get: () => null } },
    );
    expect(result.error).toContain('query');
  });

  test('uses SearchEngine when available', async () => {
    const tool = findTool('semantic_search_code');
    const mockEngine = {
      search: jest.fn().mockResolvedValue({
        items: [
          { id: '1', title: 'Error Handler', description: 'Handles errors', score: 0.95, knowledgeType: 'code-pattern', category: 'Service', language: 'swift' },
        ],
        mode: 'bm25',
      }),
    };
    const mockContainer = { get: (name) => name === 'searchEngine' ? mockEngine : null };

    const result = await tool.handler(
      { query: 'error handling', topK: 3 },
      { container: mockContainer },
    );

    expect(result.mode).toBe('bm25');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('Error Handler');
    expect(mockEngine.search).toHaveBeenCalledWith('error handling', expect.objectContaining({ mode: 'semantic' }));
  });
});

/* ════════════════════════════════════════════════════════════
 *  P2: buildMinimalPrompt
 * ════════════════════════════════════════════════════════════ */
describe('P2: buildMinimalPrompt', () => {
  test('produces shorter prompt than v9 with realistic signal count', () => {
    const dim = makeDim();
    const context = makeContext();
    const budget = { maxSubmits: 6 };

    const minimal = buildMinimalPrompt(dim, context, { budget });

    // v9 with 10 realistic signals (typical dimension)
    const signals = Array.from({ length: 10 }, (_, i) => ({
      dimId: 'code-pattern', subTopic: `signal-${i}`,
      evidence: {
        matchCount: 5 + i,
        topFiles: [`File${i}.m`, `File${i}2.m`],
        distribution: [{ label: `variant-${i}`, fileCount: 3, pct: 60, boilerplate: false }],
        samples: [
          { file: `File${i}.m`, line: 10 * i, code: `// sample code ${i}\n+ (void)method${i} {\n  // implementation\n}`, variant: 'default' },
        ],
        searchHints: [`search${i}`],
      },
      heuristicHints: [`hint ${i}`],
    }));
    const fullSignal = buildDimensionProductionPrompt(dim, signals, context, { budget });

    // v10 minimal should be much shorter than a real v9 prompt
    expect(minimal.length).toBeLessThan(fullSignal.length);
    // v10 minimal should be under 5000 chars (~1600 tokens) even with few-shot
    expect(minimal.length).toBeLessThan(5000);
  });

  test('includes task description', () => {
    const dim = makeDim({ label: '架构分析', guide: '分析项目架构层次' });
    const context = makeContext();

    const prompt = buildMinimalPrompt(dim, context);

    expect(prompt).toContain('架构分析');
    expect(prompt).toContain('分析项目架构层次');
  });

  test('includes project summary', () => {
    const context = makeContext({
      project: { projectName: 'MyApp', primaryLang: 'swift', fileCount: 1200, modules: ['Core', 'UI'] },
    });
    const prompt = buildMinimalPrompt(makeDim(), context);

    expect(prompt).toContain('MyApp');
    expect(prompt).toContain('swift');
    expect(prompt).toContain('1200');
  });

  test('does NOT include signals', () => {
    const prompt = buildMinimalPrompt(makeDim(), makeContext());

    expect(prompt).not.toContain('扫描信号');
    expect(prompt).not.toContain('Signal');
    expect(prompt).not.toContain('matchCount');
  });

  test('includes exploration strategy', () => {
    const prompt = buildMinimalPrompt(makeDim(), makeContext());

    expect(prompt).toContain('list_project_structure');
    expect(prompt).toContain('get_file_summary');
    expect(prompt).toContain('semantic_search_code');
    expect(prompt).toContain('search_project_code');
    expect(prompt).toContain('read_project_file');
  });

  test('includes output type for candidate dims', () => {
    const prompt = buildMinimalPrompt(makeDim(), makeContext(), { budget: { maxSubmits: 8 } });

    expect(prompt).toContain('CANDIDATE');
    expect(prompt).toContain('submit_candidate');
    expect(prompt).toContain('8');
  });

  test('shows SKILL for skill-only dims', () => {
    const dim = makeDim({ skillWorthy: true, dualOutput: false });
    const prompt = buildMinimalPrompt(dim, makeContext());

    expect(prompt).toContain('SKILL');
    expect(prompt).not.toContain('submit_candidate 参数');
  });

  test('shows DUAL for dual-output dims', () => {
    const dim = makeDim({ skillWorthy: true, dualOutput: true });
    const prompt = buildMinimalPrompt(dim, makeContext());

    expect(prompt).toContain('DUAL');
    expect(prompt).toContain('submit_candidate');
  });

  test('includes previously completed dimensions', () => {
    const context = makeContext({
      previousDimensions: { 'objc-deep-scan': { summary: 'done' }, 'category-scan': { summary: 'done' } },
    });
    const prompt = buildMinimalPrompt(makeDim(), context);

    expect(prompt).toContain('✅ objc-deep-scan');
    expect(prompt).toContain('✅ category-scan');
  });

  test('includes recalculation context', () => {
    const prompt = buildMinimalPrompt(makeDim(), makeContext(), {
      isRecalculation: true,
      existingCandidates: [{ title: '[Bootstrap] code-pattern/singleton', summary: '单例模式分析' }],
    });

    expect(prompt).toContain('重算模式');
    expect(prompt).toContain('singleton');
  });

  test('includes dimensionDigest schema', () => {
    const prompt = buildMinimalPrompt(makeDim(), makeContext());
    expect(prompt).toContain('dimensionDigest');
    expect(prompt).toContain('candidateCount');
  });

  test('includes quality principles', () => {
    const prompt = buildMinimalPrompt(makeDim(), makeContext());
    expect(prompt).toContain('质量原则');
    expect(prompt).toContain('代码必须真实');
  });

  test('includes dimension-specific exploration goals', () => {
    const dim = makeDim({ id: 'code-pattern', label: '设计模式与代码惯例' });
    const prompt = buildMinimalPrompt(dim, makeContext());

    expect(prompt).toContain('探索目标');
    expect(prompt).toContain('单例模式');
    expect(prompt).toContain('委托模式');
    expect(prompt).toContain('Category/Extension');
  });

  test('includes exploration goals for architecture dimension', () => {
    const dim = makeDim({ id: 'architecture', label: '架构模式' });
    const prompt = buildMinimalPrompt(dim, makeContext());

    expect(prompt).toContain('分层结构');
    expect(prompt).toContain('模块边界');
    expect(prompt).toContain('依赖图');
  });

  test('includes exploration goals for best-practice dimension', () => {
    const dim = makeDim({ id: 'best-practice', label: '最佳实践' });
    const prompt = buildMinimalPrompt(dim, makeContext());

    expect(prompt).toContain('错误处理');
    expect(prompt).toContain('并发安全');
    expect(prompt).toContain('内存管理');
  });

  test('falls back to guide text for unknown dimensions', () => {
    const dim = makeDim({ id: 'unknown-dimension', guide: '自定义维度说明' });
    const prompt = buildMinimalPrompt(dim, makeContext());

    expect(prompt).toContain('自定义维度说明');
    expect(prompt).toContain('自主规划探索方向');
  });

  test('includes 项目特写 definition for candidate dims', () => {
    const prompt = buildMinimalPrompt(makeDim(), makeContext());

    expect(prompt).toContain('基本用法与项目特征的融合');
    expect(prompt).toContain('项目选择了什么');
    expect(prompt).toContain('项目禁止什么');
    expect(prompt).toContain('项目真实类名');
    expect(prompt).toContain('代码来源标注');
  });

  test('does NOT include style guide for skill-only dims', () => {
    const dim = makeDim({ skillWorthy: true, dualOutput: false });
    const prompt = buildMinimalPrompt(dim, makeContext());

    expect(prompt).not.toContain('基本用法与项目特征的融合');
    expect(prompt).not.toContain('Few-shot');
  });

  test('includes Few-shot example for code-pattern dim', () => {
    const dim = makeDim({ id: 'code-pattern' });
    const prompt = buildMinimalPrompt(dim, makeContext());

    expect(prompt).toContain('Few-shot 示例');
    expect(prompt).toContain('XYNetworkManager');
    expect(prompt).toContain('dispatch_once');
    expect(prompt).toContain('项目特写');
    expect(prompt).toContain('来源:');
  });

  test('includes deep-scan Few-shot for objc-deep-scan dim', () => {
    const dim = makeDim({ id: 'objc-deep-scan', skillWorthy: true, dualOutput: true });
    const prompt = buildMinimalPrompt(dim, makeContext());

    expect(prompt).toContain('Few-shot 示例');
    expect(prompt).toContain('#define');
    expect(prompt).toContain('kXYBaseURL');
  });

  test('enhanced quality principles mention anti-patterns', () => {
    const prompt = buildMinimalPrompt(makeDim(), makeContext());

    expect(prompt).toContain('假阳性');
    expect(prompt).toContain('泛化描述');
    expect(prompt).toContain('四大要素缺一不可');
  });
});

/* ════════════════════════════════════════════════════════════
 *  P3: Tool count & ALL_TOOLS integrity
 * ════════════════════════════════════════════════════════════ */
describe('P3: ALL_TOOLS integrity', () => {
  test('contains 47 tools (44 original + 3 new)', () => {
    expect(ALL_TOOLS.length).toBe(47);
  });

  test('all new tools have name, description, parameters, handler', () => {
    const newTools = ['list_project_structure', 'get_file_summary', 'semantic_search_code'];
    for (const name of newTools) {
      const tool = findTool(name);
      expect(tool).toBeDefined();
      expect(typeof tool.description).toBe('string');
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    }
  });

  test('no duplicate tool names', () => {
    const names = ALL_TOOLS.map(t => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});
