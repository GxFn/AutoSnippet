/**
 * AI Service 使用示例
 * 展示新架构下的 AI 服务如何使用
 */

/**
 * 示例 1: 基础使用
 */
async function example1_basicUsage() {
  const { bootstrap } = require('./bootstrap');
  
  // 启动应用
  const container = await bootstrap({
  projectRoot: process.cwd(),
  autoLoadPlugins: true
  });

  // 获取 AI 服务
  const aiService = container.resolve('ai-service');

  // 初始化服务（加载 Provider）
  await aiService.initialize({
  autoLoad: true,
  defaultProvider: 'google'
  });

  // 使用 AI 服务
  const response = await aiService.chat('What is JavaScript?', {
  temperature: 0.7
  });

  console.log('AI Response:', response);
}

/**
 * 示例 2: 切换 Provider
 */
async function example2_switchProvider() {
  const { bootstrap } = require('./bootstrap');
  
  const container = await bootstrap();
  const aiService = container.resolve('ai-service');

  await aiService.initialize();

  // 列出所有可用 Provider
  console.log('Available providers:', aiService.listProviders());

  // 切换到 OpenAI Provider
  const openaiProvider = aiService.switchProvider('openai', {
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o'
  });

  console.log('Current provider:', aiService.getCurrentProvider());
  console.log('Current model:', aiService.getModel());

  // 使用新 Provider
  const response = await aiService.chat('Hello!');
  console.log('Response:', response);
}

/**
 * 示例 3: 代码总结
 */
async function example3_summarizeCode() {
  const { bootstrap } = require('./bootstrap');
  
  const container = await bootstrap();
  const aiService = container.resolve('ai-service');

  await aiService.initialize({
  defaultProvider: 'google'
  });

  const code = `
  async function fetchData(url) {
    try {
    const response = await fetch(url);
    return await response.json();
    } catch (error) {
    console.error('Failed to fetch:', error);
    throw error;
    }
  }
  `;

  const summary = await aiService.summarize(code, {
  language: 'javascript'
  });

  console.log('Code Summary:');
  console.log('- Summary:', summary.summary);
  console.log('- Keywords:', summary.keywords);
  console.log('- Category:', summary.category);
  console.log('- Quality:', summary.quality);
}

/**
 * 示例 4: 生成向量嵌入
 */
async function example4_generateEmbeddings() {
  const { bootstrap } = require('./bootstrap');
  
  const container = await bootstrap();
  const aiService = container.resolve('ai-service');

  await aiService.initialize({
  defaultProvider: 'openai'
  });

  // 单个文本
  const embedding1 = await aiService.embed('The quick brown fox');
  console.log('Single embedding:', embedding1.length, 'dimensions');

  // 多个文本
  const embeddings = await aiService.embed([
  'Hello world',
  'JavaScript programming',
  'Machine learning'
  ]);

  console.log('Multiple embeddings:', embeddings.length, 'items');
  console.log('First embedding:', embeddings[0].length, 'dimensions');
}

/**
 * 示例 5: 代码生成
 */
async function example5_generateCode() {
  const { bootstrap } = require('./bootstrap');
  
  const container = await bootstrap();
  const aiService = container.resolve('ai-service');

  await aiService.initialize({
  defaultProvider: 'google'
  });

  const code = await aiService.generate(
  'Create a function to check if a number is prime',
  {
    language: 'javascript',
    maxTokens: 2048
  }
  );

  console.log('Generated code:');
  console.log(code);
}

/**
 * 示例 6: 搜索和排名
 */
async function example6_rankingCandidates() {
  const { bootstrap } = require('./bootstrap');
  
  const container = await bootstrap();
  const aiService = container.resolve('ai-service');

  await aiService.initialize({
  defaultProvider: 'google'
  });

  const candidates = [
  'map() method to transform arrays',
  'forEach() for array iteration',
  'filter() to select elements',
  'reduce() for array aggregation',
  'sort() to order elements'
  ];

  const query = 'transform array elements with a function';

  const ranked = await aiService.rank(query, candidates, {
  topK: 3
  });

  console.log('Ranked results for query:', query);
  for (const result of ranked) {
  console.log(`- ${result.item} (score: ${result.score.toFixed(2)})`);
  }
}

/**
 * 示例 7: 注册自定义 Provider
 */
async function example7_customProvider() {
  const { bootstrap } = require('./bootstrap');
  const BaseAiProvider = require('./services/ai/BaseAiProvider');

  // 创建自定义 Provider
  class MyCustomProvider extends BaseAiProvider {
  constructor(config = {}) {
    super({
    name: 'custom',
    model: 'my-model',
    ...config
    });
  }

  async chat(prompt, context = {}) {
    return `Custom response to: ${prompt}`;
  }

  async summarize(code, options = {}) {
    return {
    summary: 'Custom summary',
    keywords: ['custom'],
    category: 'custom',
    quality: 0.9
    };
  }

  async embed(text, options = {}) {
    return new Array(10).fill(0.1);
  }

  async generate(prompt, options = {}) {
    return `// Custom generated code: ${prompt}`;
  }

  async rank(query, candidates, options = {}) {
    return candidates.map((item, i) => ({
    item,
    score: Math.random()
    }));
  }
  }

  const container = await bootstrap();
  const aiService = container.resolve('ai-service');

  // 注册自定义 Provider
  aiService.registerProvider('custom', MyCustomProvider, true);

  // 使用自定义 Provider
  const response = await aiService.chat('test');
  console.log('Custom provider response:', response);
}

/**
 * 示例 8: 健康检查和统计
 */
async function example8_healthCheckAndStats() {
  const { bootstrap } = require('./bootstrap');
  
  const container = await bootstrap();
  const aiService = container.resolve('ai-service');

  await aiService.initialize({
  defaultProvider: 'google'
  });

  // 健康检查
  const health = await aiService.healthCheck();
  console.log('Health check result:');
  console.log(health);

  // 获取统计信息
  const stats = aiService.getStats();
  console.log('\nService statistics:');
  console.log(JSON.stringify(stats, null, 2));

  // 获取当前模型
  console.log('\nCurrent model:', aiService.getModel());

  // 更改模型
  aiService.setModel('gemini-1.5-pro');
  console.log('New model:', aiService.getModel());
}

/**
 * 示例 9: 高级 - 使用 ProviderManager
 */
async function example9_providerManager() {
  const { bootstrap } = require('./bootstrap');
  
  const container = await bootstrap();
  const aiService = container.resolve('ai-service');

  await aiService.initialize();

  // 获取 ProviderManager（高级用法）
  const manager = aiService.getProviderManager();

  // 直接操作 Provider Manager
  console.log('All providers:', manager.list());
  console.log('Current provider:', manager.getCurrentName());
  console.log('Manager stats:', manager.getStats());

  // 清空缓存
  manager.clearCache();
  console.log('Cache cleared');
}

/**
 * 示例 10: 集成与错误处理
 */
async function example10_errorHandling() {
  const { bootstrap } = require('./bootstrap');
  
  const container = await bootstrap();
  const aiService = container.resolve('ai-service');

  try {
  await aiService.initialize({
    defaultProvider: 'invalid-provider'
  });
  } catch (error) {
  console.error('Initialization error:', error.message);
  }

  try {
  // 尝试在没有 Provider 的情况下执行
  const response = await aiService.chat('test');
  } catch (error) {
  console.error('Chat error:', error.message);
  }

  try {
  // 切换到有效的 Provider
  aiService.registerProvider('mock', require('./services/ai/../../../test/unit/services/AiService.test.js'));
  } catch (error) {
  console.error('Provider registration error:', error.message);
  }
}

// 导出示例
module.exports = {
  example1_basicUsage,
  example2_switchProvider,
  example3_summarizeCode,
  example4_generateEmbeddings,
  example5_generateCode,
  example6_rankingCandidates,
  example7_customProvider,
  example8_healthCheckAndStats,
  example9_providerManager,
  example10_errorHandling
};

// 如果直接运行此文件，执行示例 1
if (require.main === module) {
  example1_basicUsage().catch(console.error);
}
