/**
 * 集成测试数据和 fixtures
 * 提供测试场景所需的模拟数据和辅助函数
 */

// 测试 Recipe 数据
const testRecipes = {
  basicRecipe: {
    name: 'test-basic-recipe',
    title: 'Basic Test Recipe',
    content: `---
title: Basic Test Recipe
trigger: basic
category: testing
---

## Snippet / Code Reference

\`\`\`javascript
console.log('Hello, World!');
\`\`\`

## AI Context / Usage Guide

This is a basic test recipe for integration testing purposes.
`
  },

  advancedRecipe: {
    name: 'test-advanced-recipe',
    title: 'Advanced Recipe with Metadata',
    content: `---
title: Advanced Recipe with Metadata
trigger: advanced
category: advanced
tags: [test, advanced, metadata]
authority: 5
---

## Snippet / Code Reference

\`\`\`typescript
interface TestData {
  id: string;
  name: string;
  value: number;
}

const processData = (data: TestData[]): void => {
  data.forEach(item => {
    console.log(\`Processing: \${item.name}\`);
  });
};
\`\`\`

## AI Context / Usage Guide

Advanced recipe demonstrating TypeScript usage and complex scenarios.
Includes metadata for authority scoring and categorization.
`
  },

  minimalRecipe: {
    name: 'test-minimal',
    title: 'Minimal Recipe',
    content: `---
title: Minimal
trigger: min
---

Simple content.
`
  },

  invalidRecipe: {
    name: '../../../etc/passwd',
    title: 'Path Traversal Attempt',
    content: 'Malicious content'
  }
};

// 测试搜索和候选项数据
const testCandidates = {
  basicCandidate: {
    id: 'candidate-001',
    name: 'test-candidate',
    code: 'function test() { return true; }',
    sourcePath: '/test/path/test.js',
    type: 'function',
    metadata: {
      language: 'javascript',
      complexity: 'low'
    }
  },

  multipleTargets: {
    id: 'candidate-002',
    name: 'multi-target-candidate',
    code: 'const multiply = (a, b) => a * b;',
    targetPaths: [
      '/test/path/math.js',
      '/test/path/utils.js'
    ]
  }
};

// 测试权限检查数据
const permissionTests = {
  validDirectory: {
    path: '/Users/gaoxuefeng/Documents/github/AutoSnippet/recipes',
    hasWritePermission: true,
    gitPushDryRun: true
  },

  invalidDirectory: {
    path: '/root/forbidden',
    hasWritePermission: false,
    gitPushDryRun: false
  },

  noRemoteRepo: {
    path: '/tmp/local-git-repo',
    hasRemote: false,
    expectLocalMode: true
  }
};

// 测试搜索查询
const testQueries = {
  semanticSearch: {
    query: 'test recipe',
    k: 5,
    threshold: 0.5
  },

  keywordSearch: {
    keyword: 'test',
    limit: 10
  },

  contextSearch: {
    projectContext: 'test project',
    snippetCode: 'console.log("test");',
    k: 3
  }
};

// 测试 Guard 规则数据
const guardRules = {
  basicRule: {
    id: 'rule-001',
    pattern: '*.test.js',
    action: 'flag',
    severity: 'low',
    message: 'Test file detected'
  },

  complexRule: {
    id: 'rule-002',
    pattern: '^src/.*\\.ts$',
    conditions: [
      { type: 'size_exceeds', value: 1000 },
      { type: 'contains_pattern', value: 'TODO' }
    ],
    action: 'warn',
    severity: 'medium'
  }
};

// 测试 AI 配置
const aiConfigs = {
  openai: {
    provider: 'openai',
    apiKey: 'sk-test-key',
    model: 'gpt-4',
    temperature: 0.7
  },

  local: {
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'mistral',
    temperature: 0.5
  }
};

// 测试提取功能数据
const extractTests = {
  pathExtraction: {
    projectPath: '/Users/gaoxuefeng/Documents/github/AutoSnippet',
    patterns: ['**/*.js', '**/*.ts', '**/*.json'],
    excludePatterns: ['node_modules/**', 'dist/**']
  },

  textExtraction: {
    text: 'TODO: Fix this bug. FIXME: Optimize performance.',
    patterns: ['TODO', 'FIXME', 'HACK'],
    context: 2
  }
};

// 测试跨项目数据
const crossProjectTests = {
  sourceProject: {
    path: '/Users/gaoxuefeng/Documents/github/AutoSnippet',
    name: 'AutoSnippet'
  },

  targetProject: {
    path: '/Users/gaoxuefeng/Documents/github/BiliDemo',
    name: 'BiliDemo'
  },

  sharedResource: {
    type: 'recipe',
    name: 'shared-utility',
    source: 'AutoSnippet',
    target: 'BiliDemo'
  }
};

// 测试性能数据
const performanceTests = {
  largeRecipe: {
    name: 'performance-large-recipe',
    size: 500000, // 500KB
    complexity: 'high'
  },

  bulkOperation: {
    count: 100,
    operation: 'save',
    expectedTime: 5000 // 毫秒
  },

  cachedSearch: {
    query: 'performance test',
    iterations: 100,
    expectedCacheHits: 95
  }
};

// 辅助函数：生成随机 Recipe
function generateRandomRecipe(index) {
  return {
    name: `test-random-recipe-${index}`,
    title: `Random Recipe #${index}`,
    content: `---
title: Random Recipe #${index}
trigger: random${index}
---

Random content generated for test #${index}
Timestamp: ${Date.now()}
`
  };
}

// 辅助函数：生成测试用例组合
function generateTestCombinations() {
  return [
    { recipe: testRecipes.basicRecipe, authority: 1 },
    { recipe: testRecipes.basicRecipe, authority: 3 },
    { recipe: testRecipes.basicRecipe, authority: 5 },
    { recipe: testRecipes.advancedRecipe, authority: 5 },
    { recipe: testRecipes.minimalRecipe, authority: 0 }
  ];
}

// 辅助函数：验证 Recipe 结构
function validateRecipeStructure(recipe) {
  const required = ['name', 'title', 'content'];
  return required.every(field => field in recipe && recipe[field]);
}

// 辅助函数：验证响应格式
function validateResponseFormat(response, expectedFields) {
  return expectedFields.every(field => field in response);
}

module.exports = {
  testRecipes,
  testCandidates,
  permissionTests,
  testQueries,
  guardRules,
  aiConfigs,
  extractTests,
  crossProjectTests,
  performanceTests,
  generateRandomRecipe,
  generateTestCombinations,
  validateRecipeStructure,
  validateResponseFormat
};
