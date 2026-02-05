/**
 * LearnAgent - 学习和教育Agent
 * 提供概念解释、教程和学习路径
 */

const { EventEmitter } = require('events');

class LearnAgent extends EventEmitter {
  constructor(options = {}) {
  super();
  this.name = 'learn';
  this.version = '1.0.0';
  this.capabilities = [
    'concept-explanation',
    'learning-paths',
    'tutorials',
    'skill-assessment'
  ];

  // 配置
  this.config = {
    timeout: options.timeout || 5000,
    learningLevel: options.learningLevel || 'intermediate', // 'beginner', 'intermediate', 'advanced'
    format: options.format || 'comprehensive', // 'quick', 'comprehensive', 'detailed'
    language: options.language || 'javascript',
    ...options
  };

  // 依赖注入
  this.knowledgeGraph = options.knowledgeGraph; // 知识图谱
  this.retrievalFunnel = options.retrievalFunnel;
  this.logger = options.logger || console;

  // 学习资源库
  this.concepts = this._initializeConcepts();
  this.tutorials = this._initializeTutorials();
  this.progressTracking = new Map();

  // 统计
  this.stats = {
    totalLearningRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    conceptsExplained: 0,
    learningPathsCreated: 0,
    avgComprehensionScore: 0,
    lastRequest: null
  };
  }

  /**
   * 初始化概念库
   * @private
   */
  _initializeConcepts() {
  return {
    'async': {
    description: 'Asynchronous programming allows code to run without blocking',
    difficulty: 'intermediate',
    keywords: ['promise', 'callback', 'await', 'event loop'],
    examples: [
      'async/await syntax',
      'Promise chains',
      'setTimeout and event loop'
    ],
    prerequisites: ['javascript-basics', 'functions']
    },
    'promise': {
    description: 'A Promise is a JavaScript object that produces a value in the future',
    difficulty: 'intermediate',
    keywords: ['async', 'resolve', 'reject', 'then'],
    examples: [
      'Creating a promise',
      'Promise chaining',
      'Promise.all() and Promise.race()'
    ],
    prerequisites: ['javascript-basics', 'callbacks']
    },
    'error-handling': {
    description: 'Techniques to gracefully handle errors in code',
    difficulty: 'beginner',
    keywords: ['try', 'catch', 'finally', 'throw'],
    examples: [
      'Try-catch blocks',
      'Custom error classes',
      'Error propagation'
    ],
    prerequisites: ['javascript-basics']
    },
    'closures': {
    description: 'A function bundled together with lexical environment',
    difficulty: 'advanced',
    keywords: ['scope', 'lexical', 'variable', 'function'],
    examples: [
      'Creating closures',
      'Private variables',
      'Function factories'
    ],
    prerequisites: ['functions', 'scope']
    },
    'react': {
    description: 'A JavaScript library for building user interfaces',
    difficulty: 'intermediate',
    keywords: ['component', 'jsx', 'hooks', 'state'],
    examples: [
      'Functional components',
      'React hooks',
      'State management'
    ],
    prerequisites: ['javascript-basics', 'jsx']
    }
  };
  }

  /**
   * 初始化教程库
   * @private
   */
  _initializeTutorials() {
  return {
    'async-await-guide': {
    title: 'Complete Guide to Async/Await',
    topic: 'async',
    duration: '30 minutes',
    level: 'intermediate',
    steps: [
      'Understand Promises',
      'Learn async function syntax',
      'Handle errors with try-catch',
      'Parallel execution with Promise.all',
      'Build a real-world example'
    ]
    },
    'error-handling-patterns': {
    title: 'Error Handling Best Practices',
    topic: 'error-handling',
    duration: '20 minutes',
    level: 'beginner',
    steps: [
      'Try-catch-finally blocks',
      'Error types in JavaScript',
      'Custom error classes',
      'Error propagation',
      'Global error handling'
    ]
    },
    'react-hooks-explained': {
    title: 'Understanding React Hooks',
    topic: 'react',
    duration: '45 minutes',
    level: 'intermediate',
    steps: [
      'What are hooks?',
      'useState hook',
      'useEffect hook',
      'Custom hooks',
      'Best practices'
    ]
    }
  };
  }

  /**
   * 执行学习请求
   * @param {Object} context - 执行上下文
   * @param {string} context.topic - 学习主题
   * @param {string} context.type - 学习类型 ('explain', 'tutorial', 'assessment')
   * @param {string} context.currentLevel - 用户当前水平
   * @param {Object} context.sessionContext - 会话上下文
   * @returns {Promise<Object>} 学习内容
   */
  async execute(context) {
  const startTime = Date.now();
  this.stats.totalLearningRequests++;

  try {
    // 参数验证
    if (!context || !context.topic) {
    throw new Error('Missing required context.topic');
    }

    const topic = context.topic;
    const type = context.type || 'explain';
    const currentLevel = context.currentLevel || this.config.learningLevel;
    const userId = context.sessionContext?.userId;

    // 查询知识图谱获取相关概念
    const relatedConcepts = await this._findRelatedConcepts(topic);

    // 根据类型执行不同的学习操作
    let learningContent;
    let contentType = 'default';

    if (type === 'explain') {
    learningContent = await this._explainConcept(topic, currentLevel, relatedConcepts);
    contentType = 'explanation';
    } else if (type === 'tutorial') {
    learningContent = await this._createTutorial(topic, currentLevel, relatedConcepts);
    contentType = 'tutorial';
    } else if (type === 'assessment') {
    learningContent = await this._createAssessment(topic, currentLevel);
    contentType = 'assessment';
    } else if (type === 'path') {
    learningContent = await this._generateLearningPath(topic, currentLevel);
    contentType = 'learning-path';
    } else {
    learningContent = await this._explainConcept(topic, currentLevel, relatedConcepts);
    contentType = 'explanation';
    }

    // 生成学习建议
    const recommendations = this._generateRecommendations(topic, currentLevel, contentType);

    // 更新进度跟踪
    if (userId) {
    this._updateProgress(userId, topic, contentType);
    }

    const executionTime = Date.now() - startTime;
    this.stats.successfulRequests++;
    this._updateStats(contentType, executionTime);

    const result = {
    agentId: this.name,
    success: true,
    topic,
    type: contentType,
    level: currentLevel,
    content: learningContent,
    relatedConcepts,
    recommendations,
    executionTime,
    timestamp: new Date().toISOString()
    };

    this.emit('learning_complete', { context, result });
    return result;
  } catch (error) {
    this.stats.failedRequests++;
    const executionTime = Date.now() - startTime;
    this._updateStats('error', executionTime, true);

    const errorResult = {
    agentId: this.name,
    success: false,
    topic: context.topic,
    error: error.message,
    content: null,
    executionTime,
    timestamp: new Date().toISOString()
    };

    this.emit('learning_error', { context, error, result: errorResult });
    throw error;
  }
  }

  /**
   * 解释概念
   * @private
   */
  async _explainConcept(topic, level, relatedConcepts) {
  const concept = this.concepts[topic.toLowerCase()];

  if (!concept) {
    return {
    title: `Understanding ${topic}`,
    introduction: `Let's learn about ${topic}`,
    mainExplanation: `${topic} is an important concept in programming.`,
    keyPoints: [
      `${topic} allows for better code organization`,
      `Understanding ${topic} is crucial for advanced development`,
      `Practice is essential to master ${topic}`
    ],
    examples: this._generateExamples(topic, level),
    commonMistakes: this._generateCommonMistakes(topic),
    resources: this._findResources(topic)
    };
  }

  // 根据难度级别调整解释
  const explanation = {
    title: `Understanding ${topic}`,
    introduction: concept.description,
    difficulty: concept.difficulty,
    keyPoints: concept.keywords,
    mainExplanation: this._adaptExplanation(concept.description, level),
    examples: concept.examples.map(ex => this._generateCodeExample(ex, topic, level)),
    prerequisites: concept.prerequisites,
    commonMistakes: this._generateCommonMistakes(topic),
    nextSteps: this._suggestNextSteps(topic, relatedConcepts),
    resources: this._findResources(topic)
  };

  return explanation;
  }

  /**
   * 适配解释难度
   * @private
   */
  _adaptExplanation(description, level) {
  if (level === 'beginner') {
    return `${description}\n\nThink of it like this: [analogy]`;
  } else if (level === 'intermediate') {
    return `${description}\n\nUnder the hood, [technical details]`;
  } else {
    return `${description}\n\nAdvanced considerations: [deep dive]`;
  }
  }

  /**
   * 创建教程
   * @private
   */
  async _createTutorial(topic, level, relatedConcepts) {
  const tutorial = this.tutorials[Object.keys(this.tutorials)[0]];

  return {
    title: `Learn ${topic}`,
    introduction: `Welcome to the ${topic} tutorial!`,
    duration: '45 minutes',
    level: level,
    learningObjectives: [
    `Understand the basics of ${topic}`,
    `Learn best practices`,
    `Build a practical example`,
    `Know when to use ${topic}`
    ],
    steps: [
    {
      number: 1,
      title: 'Introduction',
      content: `Learn what ${topic} is and why it matters`,
      duration: '5 minutes',
      code: `// Example starter code\n// Placeholder`
    },
    {
      number: 2,
      title: 'Core Concepts',
      content: `Dive into the core concepts of ${topic}`,
      duration: '15 minutes',
      code: `// Core example\n// Implementation`
    },
    {
      number: 3,
      title: 'Practical Exercise',
      content: `Build something with ${topic}`,
      duration: '20 minutes',
      code: `// Your task:\n// Build a ${topic} example`
    },
    {
      number: 4,
      title: 'Best Practices',
      content: `Learn best practices and common pitfalls`,
      duration: '5 minutes',
      code: `// DO: Best practice example\n// DON'T: Anti-pattern`
    }
    ],
    assignment: {
    title: `Create a ${topic} example`,
    description: 'Apply what you learned',
    requirements: [
      'Use the concepts from this tutorial',
      'Include error handling',
      'Add comments explaining your code'
    ]
    },
    resources: this._findResources(topic),
    nextTopics: relatedConcepts.slice(0, 3)
  };
  }

  /**
   * 创建评估
   * @private
   */
  async _createAssessment(topic, level) {
  return {
    title: `${topic} Assessment`,
    description: `Test your knowledge of ${topic}`,
    difficulty: level,
    questions: [
    {
      id: 1,
      type: 'multiple-choice',
      question: `What is ${topic}?`,
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      correctAnswer: 'Option A',
      explanation: 'Correct! Because...'
    },
    {
      id: 2,
      type: 'code-completion',
      question: `Complete this ${topic} example`,
      starter: `function example() {\n  // TODO: Complete this\n}`,
      solution: `function example() {\n  return result;\n}`,
      hints: ['Start with a return statement', 'Use proper syntax']
    },
    {
      id: 3,
      type: 'true-false',
      question: `${topic} is always the best solution?`,
      answer: false,
      explanation: 'Correct! Use the right tool for the right job.'
    }
    ],
    passingScore: 70,
    timeLimit: 30
  };
  }

  /**
   * 生成学习路径
   * @private
   */
  async _generateLearningPath(topic, level) {
  const concept = this.concepts[topic.toLowerCase()];
  const prerequisites = concept?.prerequisites || [];
  const relatedTopics = Object.keys(this.concepts)
    .filter(key => key !== topic.toLowerCase())
    .slice(0, 3);

  return {
    title: `Learning Path for ${topic}`,
    currentLevel: level,
    estimatedDuration: '2-3 weeks',
    pathType: 'structured',
    phases: [
    {
      phase: 1,
      title: 'Foundations',
      duration: '3-4 days',
      topics: prerequisites,
      description: 'Master the prerequisites for understanding this topic'
    },
    {
      phase: 2,
      title: 'Core Concepts',
      duration: '4-5 days',
      topics: [topic],
      description: 'Deep dive into the main concepts'
    },
    {
      phase: 3,
      title: 'Advanced Topics',
      duration: '3-4 days',
      topics: relatedTopics,
      description: 'Explore related and advanced concepts'
    },
    {
      phase: 4,
      title: 'Project',
      duration: '3-5 days',
      project: `Build a comprehensive ${topic} project`,
      description: 'Apply everything you learned in a real project'
    }
    ],
    milestones: [
    { milestone: 1, goal: 'Complete all prerequisites' },
    { milestone: 2, goal: `Master ${topic}` },
    { milestone: 3, goal: 'Understand advanced concepts' },
    { milestone: 4, goal: 'Complete final project' }
    ],
    resources: this._findResources(topic),
    assessments: [
    'Quiz after each phase',
    'Code challenge after phase 2',
    'Project review after phase 4'
    ]
  };
  }

  /**
   * 查找相关概念
   * @private
   */
  async _findRelatedConcepts(topic) {
  // 在实际系统中，这会使用知识图谱
  if (this.knowledgeGraph && this.knowledgeGraph.findRelated) {
    try {
    return await this.knowledgeGraph.findRelated(topic, { limit: 5 });
    } catch (err) {
    this.logger.warn('[LearnAgent] KnowledgeGraph search failed:', err.message);
    }
  }

  // 备选实现
  const conceptMap = {
    'async': ['promise', 'callback', 'event-loop'],
    'promise': ['async', 'then', 'error-handling'],
    'react': ['jsx', 'hooks', 'component'],
    'error-handling': ['try-catch', 'debugging', 'exceptions']
  };

  return conceptMap[topic.toLowerCase()] || [];
  }

  /**
   * 生成代码示例
   * @private
   */
  _generateCodeExample(example, topic, level) {
  const codeMap = {
    'async/await syntax': `async function fetchData() {
  try {
  const response = await fetch(url);
  const data = await response.json();
  return data;
  } catch (error) {
  console.error('Error:', error);
  }
}`,
    'Promise chains': `fetch(url)
  .then(res => res.json())
  .then(data => console.log(data))
  .catch(err => console.error(err))`,
    'Try-catch blocks': `try {
  // Code that might throw
  riskyOperation();
} catch (error) {
  // Handle error
  console.error(error.message);
} finally {
  // Cleanup
  cleanup();
}`
  };

  return codeMap[example] || `// ${example} example`;
  }

  /**
   * 生成常见错误
   * @private
   */
  _generateCommonMistakes(topic) {
  const mistakeMap = {
    'async': [
    'Forgetting await keyword',
    'Not handling promise rejections',
    'Blocking operations in async code'
    ],
    'error-handling': [
    'Not catching errors',
    'Swallowing errors silently',
    'Not providing meaningful error messages'
    ],
    'react': [
    'Modifying state directly',
    'Missing dependencies in useEffect',
    'Creating new objects in render'
    ]
  };

  return mistakeMap[topic.toLowerCase()] || [
    'Common mistake 1',
    'Common mistake 2'
  ];
  }

  /**
   * 生成示例
   * @private
   */
  _generateExamples(topic, level) {
  if (level === 'beginner') {
    return ['Basic example 1', 'Simple use case'];
  } else if (level === 'intermediate') {
    return ['Common use case', 'Integration example', 'Best practices'];
  } else {
    return ['Advanced pattern', 'Edge cases', 'Performance optimization'];
  }
  }

  /**
   * 建议下一步
   * @private
   */
  _suggestNextSteps(topic, relatedConcepts) {
  return [
    `Practice ${topic} with small exercises`,
    `Build a project using ${topic}`,
    `Learn related concepts: ${relatedConcepts.join(', ')}`,
    `Explore advanced patterns and optimizations`
  ];
  }

  /**
   * 查找资源
   * @private
   */
  _findResources(topic) {
  return {
    documentation: [`MDN - ${topic}`, 'Official documentation'],
    articles: [`Understanding ${topic}`, 'Best practices guide'],
    videos: [`${topic} explained`, 'Tutorial series'],
    books: [`Mastering ${topic}`, 'Advanced concepts']
  };
  }

  /**
   * 生成建议
   * @private
   */
  _generateRecommendations(topic, level, contentType) {
  const recommendations = [];

  if (level === 'beginner') {
    recommendations.push('Start with the basics tutorial');
    recommendations.push('Take the beginner assessment');
  } else if (level === 'intermediate') {
    recommendations.push('Explore advanced patterns');
    recommendations.push('Build a practical project');
  } else {
    recommendations.push('Read the official specification');
    recommendations.push('Contribute to open source');
  }

  if (contentType === 'tutorial') {
    recommendations.push('Complete the assignment');
    recommendations.push('Take the follow-up assessment');
  } else if (contentType === 'assessment') {
    recommendations.push('Review failed questions');
    recommendations.push('Practice more exercises');
  }

  return recommendations;
  }

  /**
   * 更新进度
   * @private
   */
  _updateProgress(userId, topic, contentType) {
  const key = `${userId}_progress`;
  const progress = this.progressTracking.get(key) || {};

  if (!progress[topic]) {
    progress[topic] = {
    lastAccessed: new Date().toISOString(),
    views: 0,
    comprehension: 0
    };
  }

  progress[topic].lastAccessed = new Date().toISOString();
  progress[topic].views++;

  this.progressTracking.set(key, progress);
  }

  /**
   * 更新统计信息
   * @private
   */
  _updateStats(contentType, executionTime, isError = false) {
  if (contentType === 'explanation') {
    this.stats.conceptsExplained++;
  } else if (contentType === 'tutorial') {
    this.stats.learningPathsCreated++;
  }

  this.stats.lastRequest = {
    timestamp: new Date().toISOString(),
    executionTime,
    contentType,
    success: !isError
  };
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
  return {
    ...this.stats,
    name: this.name,
    version: this.version,
    capabilities: this.capabilities
  };
  }

  /**
   * 获取用户进度
   */
  getUserProgress(userId) {
  const key = `${userId}_progress`;
  return this.progressTracking.get(key) || {};
  }

  /**
   * 重置统计信息
   */
  resetStatistics() {
  this.stats = {
    totalLearningRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    conceptsExplained: 0,
    learningPathsCreated: 0,
    avgComprehensionScore: 0,
    lastRequest: null
  };
  }
}

module.exports = LearnAgent;
