/**
 * AgentCoordinator - 多 Agent 协调层
 * 
 * 职责：
 * - 协调 Lint、Generate、Search、Learn 四个 Agent
 * - 基于用户输入的意图进行任务规划
 * - 管理 Agent 之间的通信和结果融合
 * - 维护操作历史和上下文记忆
 * 
 * 架构：
 *                     User Input
 *                          ↓
 *              ┌──────────────────────┐
 *              │   AgentCoordinator   │
 *              │   ┌──────────────┐   │
 *              │   │ Intent Class │   │ ← 意图分类
 *              │   └──────────────┘   │
 *              │   ┌──────────────┐   │
 *              │   │ Plan Exec    │   │ ← 执行计划
 *              │   └──────────────┘   │
 *              └──────────────────────┘
 *                          ↓
 *         ┌────┬────┬────┬─────┐
 *         ↓    ↓    ↓    ↓     ↓
 *       Lint Search Gen Learn Other
 *       Agent Agent  Agent Agent
 *         ↓    ↓    ↓    ↓
 *         └────┴────┴────┴─────┐
 *                              ↓
 *                    ┌─────────────────┐
 *                    │ Result Synthesis│
 *                    └─────────────────┘
 *                              ↓
 *                         Final Output
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const ContextMapper = require('./ContextMapper');
const ErrorHandler = require('./ErrorHandler');
const ConversationManager = require('./ConversationManager');
const ResultFusion = require('./ResultFusion');

class AgentCoordinator extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.agents = new Map();
    this.memoryManager = options.memoryManager || null;
    this.knowledgeGraph = options.knowledgeGraph || null;
    this.retrieverFunnel = options.retrievelFunnel || null;
    this.contextMapper = new ContextMapper({ logger: options.logger });
    this.errorHandler = new ErrorHandler({ 
      logger: options.logger,
      maxRetries: options.maxRetries || 2,
      ...options.errorHandlerConfig
    });
    this.conversationManager = new ConversationManager({ 
      logger: options.logger,
      ...options.conversationConfig
    });
    this.resultFusion = new ResultFusion({ 
      logger: options.logger,
      ...options.fusionConfig
    });
    
    // 执行配置
    this.coordinatorConfig = {
      timeout: options.timeout || 30000,
      maxRetries: options.maxRetries || 2,
      fallbackStrategy: options.fallbackStrategy || 'search',
      parallelExecution: options.parallelExecution !== false,
      debug: options.debug || false
    };
    
    // 会话管理
    this.sessions = new Map();
    this.executionHistory = [];
    
    // 意图配置
    this.intentConfig = {
      lint: {
        agents: ['lint'],
        priority: 'high',
        parallelizable: false
      },
      generate: {
        agents: ['lint', 'search', 'generate'],
        priority: 'high',
        parallelizable: true
      },
      search: {
        agents: ['search'],
        priority: 'normal',
        parallelizable: false
      },
      learn: {
        agents: ['search', 'learn'],
        priority: 'normal',
        parallelizable: true
      },
      analyze: {
        agents: ['lint', 'search', 'learn'],
        priority: 'normal',
        parallelizable: true
      }
    };
    
    this.initializePersistence();
  }
  
  /**
   * 注册 Agent
   * @param {string} agentId - Agent 标识符
   * @param {Object} agent - Agent 实例
   */
  registerAgent(agentId, agent) {
    if (!agent || typeof agent.execute !== 'function') {
      throw new Error(`Invalid agent: ${agentId}. Must have execute() method`);
    }
    
    this.agents.set(agentId, {
      id: agentId,
      instance: agent,
      status: 'idle',
      lastExecuted: null,
      totalExecutions: 0,
      totalErrors: 0,
      avgExecutionTime: 0
    });
    
    console.log(`[AgentCoordinator] Agent registered: ${agentId}`);
  }
  
  /**
   * 处理用户请求
   * @param {string} userInput - 用户输入
   * @param {Object} sessionContext - 会话上下文
   * @returns {Promise<Object>} 协调结果
   */
  async handleRequest(userInput, sessionContext = {}) {
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    
    try {
      console.log(`\n[Coordinator] Processing request: ${requestId}`);
      console.log(`  Input: "${userInput}"`);
      
      // Step 1: 初始化请求上下文
      const context = this.initializeContext(userInput, sessionContext, requestId);
      
      // Step 2: 分类用户意图
      const intent = await this.classifyIntent(userInput, context);
      console.log(`  Intent: ${intent.type} (confidence: ${intent.confidence.toFixed(2)})`);
      
      // Step 3: 生成执行计划
      const plan = this.generatePlan(intent, context);
      console.log(`  Plan: ${plan.steps.length} steps, ${plan.totalAgents} agents`);
      
      // Step 4: 执行计划
      const results = await this.executePlan(plan, context);
      
      // Step 5: 融合结果
      const finalOutput = this.synthesizeResults(results, plan, context);
      
      // Step 6: 更新记忆
      if (this.memoryManager) {
        await this.memoryManager.recordExecution(context, finalOutput);
      }
      
      // Step 7: 记录执行历史
      this.recordExecution({
        requestId,
        intent: intent.type,
        plan,
        results,
        finalOutput,
        executionTime: Date.now() - startTime,
        timestamp: new Date().toISOString()
      });
      
      console.log(`  Completed in ${Date.now() - startTime}ms\n`);
      
      return finalOutput;
      
    } catch (error) {
      console.error(`[Coordinator] Error processing request ${requestId}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * 初始化请求上下文
   */
  initializeContext(userInput, sessionContext, requestId) {
    return {
      requestId,
      userInput,
      sessionId: sessionContext.sessionId || this.generateSessionId(),
      userId: sessionContext.userId || 'unknown',
      timestamp: Date.now(),
      conversationHistory: sessionContext.conversationHistory || [],
      userProfile: sessionContext.userProfile || {},
      knowledgeGraph: this.knowledgeGraph,
      retrieverFunnel: this.retrieverFunnel,
      executionPlan: null,
      agentResults: new Map(),
      metadata: {}
    };
  }
  
  /**
   * 分类用户意图
   * @param {string} userInput - 用户输入
   * @param {Object} context - 请求上下文
   * @returns {Object} 意图信息
   */
  async classifyIntent(userInput, context) {
    const inputLower = userInput.toLowerCase();
    
    // 关键词匹配规则
    const intentPatterns = {
      lint: {
        keywords: ['check', 'lint', 'validate', 'audit', '检查', '校验', '验证'],
        patterns: /\b(check|lint|validate|audit|verify|检查|校验)\b/i,
        confidence: 0.9
      },
      generate: {
        keywords: ['create', 'write', 'generate', 'implement', 'code', '创建', '生成', '实现', '代码'],
        patterns: /\b(create|write|generate|implement|code|build|创建|生成|实现|代码|编写)\b/i,
        confidence: 0.85
      },
      search: {
        keywords: ['find', 'search', 'look for', 'get', '查找', '搜索', '找'],
        patterns: /\b(find|search|look for|get|show|查找|搜索|找)\b/i,
        confidence: 0.8
      },
      learn: {
        keywords: ['learn', 'explain', 'tutorial', 'how to', 'understand', '学习', '解释', '教程', '怎样'],
        patterns: /\b(learn|explain|tutorial|how to|understand|guide|学习|解释|教程|怎样)\b/i,
        confidence: 0.8
      }
    };
    
    // 匹配意图
    let bestMatch = { type: 'search', confidence: 0.5 };
    
    for (const [type, config] of Object.entries(intentPatterns)) {
      if (config.patterns.test(inputLower)) {
        if (config.confidence > bestMatch.confidence) {
          bestMatch = { type, confidence: config.confidence };
        }
      }
    }
    
    // 考虑对话历史来改进意图分类
    if (context.conversationHistory.length > 0) {
      const recentIntents = context.conversationHistory
        .slice(-3)
        .map(h => h.intent);
      
      // 如果最近有相同意图，增加信心
      if (recentIntents.includes(bestMatch.type)) {
        bestMatch.confidence = Math.min(bestMatch.confidence * 1.1, 1.0);
      }
    }
    
    return bestMatch;
  }
  
  /**
   * 生成执行计划
   * @param {Object} intent - 分类的意图
   * @param {Object} context - 请求上下文
   * @returns {Object} 执行计划
   */
  generatePlan(intent, context) {
    const config = this.intentConfig[intent.type] || this.intentConfig.search;
    
    const steps = [];
    let stepId = 1;
    
    for (const agentId of config.agents) {
      if (this.agents.has(agentId)) {
        steps.push({
          id: stepId++,
          agentId,
          depends: this.getDependencies(agentId, config.agents),
          priority: config.priority,
          parallel: config.parallelizable && stepId > 1,
          timeout: this.coordinatorConfig.timeout,
          retries: this.coordinatorConfig.maxRetries
        });
      }
    }
    
    // 构建依赖关系
    const dependencyMap = this.buildDependencyMap(steps);
    
    return {
      intentType: intent.type,
      confidence: intent.confidence,
      steps,
      totalAgents: steps.length,
      dependencyMap,
      estimatedTime: steps.length * 100,  // 粗略估计
      createdAt: Date.now()
    };
  }
  
  /**
   * 获取 Agent 的依赖
   */
  getDependencies(agentId, allAgents) {
    const dependencyRules = {
      lint: [],
      search: [],
      generate: ['lint', 'search'],  // Generate 依赖 Lint 和 Search
      learn: ['search']  // Learn 依赖 Search
    };
    
    return (dependencyRules[agentId] || []).filter(dep => allAgents.includes(dep));
  }
  
  /**
   * 构建依赖关系图
   */
  buildDependencyMap(steps) {
    const map = new Map();
    
    for (const step of steps) {
      map.set(step.id, {
        agentId: step.agentId,
        dependencies: step.depends.map(dep => 
          steps.find(s => s.agentId === dep)?.id
        ).filter(Boolean),
        dependents: []
      });
    }
    
    // 反向关系
    for (const [stepId, info] of map) {
      for (const depId of info.dependencies) {
        map.get(depId).dependents.push(stepId);
      }
    }
    
    return map;
  }
  
  /**
   * 执行计划
   * @param {Object} plan - 执行计划
   * @param {Object} context - 请求上下文
   * @returns {Promise<Map>} 执行结果
   */
  async executePlan(plan, context) {
    console.log(`[Coordinator] Executing plan with ${plan.steps.length} steps...`);
    
    const results = new Map();
    const completedSteps = new Set();
    
    // 拓扑排序执行
    while (completedSteps.size < plan.steps.length) {
      const readySteps = plan.steps.filter(step => {
        // 所有依赖都已完成
        const depsReady = step.depends.every(depId => {
          const depStep = plan.steps.find(s => s.agentId === depId);
          return completedSteps.has(depStep.id);
        });
        
        return depsReady && !completedSteps.has(step.id);
      });
      
      if (readySteps.length === 0) {
        // 检查循环依赖
        throw new Error('Circular dependency detected in execution plan');
      }
      
      // 并行执行就绪的步骤（如果配置允许）
      const executionPromises = readySteps.map(step =>
        this.executeStep(step, context, results)
      );
      
      await Promise.all(executionPromises);
      
      readySteps.forEach(step => completedSteps.add(step.id));
    }
    
    console.log(`[Coordinator] Plan execution completed`);
    return results;
  }
  
  /**
   * 执行单个步骤
   */
  async executeStep(step, context, results) {
    const agent = this.agents.get(step.agentId);
    
    if (!agent) {
      console.warn(`[Coordinator] Agent not found: ${step.agentId}`);
      return;
    }
    
    const stepStartTime = Date.now();
    agent.status = 'executing';
    
    try {
      console.log(`  [Step ${step.id}] Executing agent: ${step.agentId}`);
      
      // 使用ContextMapper将用户输入映射到Agent特定的上下文
      const agentSpecificContext = this.contextMapper.mapUserInputToContext(
        context.userInput,
        context.intent,
        context.sessionContext,
        this.knowledgeGraph
      );

      // 为 Agent 提供上下文
      const agentContext = {
        ...agentSpecificContext,
        requestId: context.requestId,
        userInput: context.userInput,
        conversationHistory: context.conversationHistory,
        previousResults: new Map(results)  // 只读副本
      };
      
      // 执行 Agent
      const result = await Promise.race([
        agent.instance.execute(agentContext),
        this.createTimeout(step.timeout)
      ]);
      
      results.set(step.agentId, {
        status: 'success',
        data: result,
        executionTime: Date.now() - stepStartTime,
        timestamp: new Date().toISOString()
      });
      
      agent.status = 'idle';
      agent.lastExecuted = Date.now();
      agent.totalExecutions++;
      
      console.log(`    → Completed in ${Date.now() - stepStartTime}ms`);
      
    } catch (error) {
      console.error(`  [Step ${step.id}] Error: ${error.message}`);
      
      results.set(step.agentId, {
        status: 'failed',
        error: error.message,
        executionTime: Date.now() - stepStartTime,
        timestamp: new Date().toISOString()
      });
      
      agent.status = 'error';
      agent.totalErrors++;
      
      // 检查是否应该降级
      if (this.shouldFallback(step.agentId, context)) {
        console.log(`    → Attempting fallback to ${this.coordinatorConfig.fallbackStrategy}`);
        // 尝试使用降级策略
      }
    }
  }
  
  /**
   * 融合多个 Agent 的结果
   */
  synthesizeResults(results, plan, context) {
    const synthesis = {
      requestId: context.requestId,
      intent: plan.intentType,
      timestamp: Date.now(),
      agentResults: {}
    };
    
    // 收集所有 Agent 的结果
    for (const [agentId, result] of results) {
      synthesis.agentResults[agentId] = {
        status: result.status,
        executionTime: result.executionTime
      };
      
      if (result.status === 'success') {
        synthesis.agentResults[agentId].data = result.data;
      } else {
        synthesis.agentResults[agentId].error = result.error;
      }
    }
    
    // 生成最终响应（取决于意图类型）
    synthesis.response = this.generateResponse(plan.intentType, results);
    
    // 附加元信息
    synthesis.metadata = {
      totalAgents: plan.totalAgents,
      successfulAgents: Array.from(results.values()).filter(r => r.status === 'success').length,
      failedAgents: Array.from(results.values()).filter(r => r.status === 'failed').length,
      totalExecutionTime: Array.from(results.values()).reduce((sum, r) => sum + r.executionTime, 0)
    };
    
    return synthesis;
  }
  
  /**
   * 生成最终响应
   */
  generateResponse(intentType, results) {
    switch (intentType) {
      case 'lint':
        return this.synthesizeLintResponse(results);
      case 'generate':
        return this.synthesizeGenerateResponse(results);
      case 'search':
        return this.synthesizeSearchResponse(results);
      case 'learn':
        return this.synthesizeLearnResponse(results);
      default:
        return this.synthesizeDefaultResponse(results);
    }
  }
  
  synthesizeLintResponse(results) {
    const lintResult = results.get('lint');
    return {
      type: 'lint_result',
      violations: lintResult?.data?.violations || [],
      summary: `Found ${lintResult?.data?.violations?.length || 0} issues`,
      suggestions: lintResult?.data?.suggestions || []
    };
  }
  
  synthesizeGenerateResponse(results) {
    const searchResult = results.get('search');
    const generateResult = results.get('generate');
    
    return {
      type: 'generate_result',
      code: generateResult?.data?.code || '',
      relatedRecipes: searchResult?.data?.recipes || [],
      explanation: generateResult?.data?.explanation || ''
    };
  }
  
  synthesizeSearchResponse(results) {
    const searchResult = results.get('search');
    
    return {
      type: 'search_result',
      recipes: searchResult?.data?.recipes || [],
      totalCount: searchResult?.data?.totalCount || 0,
      explanation: 'Based on semantic and keyword search'
    };
  }
  
  synthesizeLearnResponse(results) {
    const searchResult = results.get('search');
    const learnResult = results.get('learn');
    
    return {
      type: 'learn_result',
      learningPath: learnResult?.data?.path || [],
      relatedRecipes: searchResult?.data?.recipes || [],
      nextSteps: learnResult?.data?.nextSteps || []
    };
  }
  
  synthesizeDefaultResponse(results) {
    return {
      type: 'default',
      agentCount: results.size,
      successCount: Array.from(results.values()).filter(r => r.status === 'success').length
    };
  }
  
  /**
   * 检查是否应该降级
   */
  shouldFallback(failedAgentId, context) {
    return this.coordinatorConfig.fallbackStrategy &&
           failedAgentId !== this.coordinatorConfig.fallbackStrategy;
  }
  
  /**
   * 创建超时 Promise
   */
  createTimeout(ms) {
    return new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    );
  }
  
  /**
   * 记录执行历史
   */
  recordExecution(executionRecord) {
    this.executionHistory.push(executionRecord);
    
    // 保留最近 100 次执行记录
    if (this.executionHistory.length > 100) {
      this.executionHistory.shift();
    }
    
    // 定期持久化
    if (this.executionHistory.length % 10 === 0) {
      this.persistExecutionHistory();
    }
  }
  
  /**
   * 获取执行统计
   */
  getStatistics() {
    const stats = {
      totalRequests: this.executionHistory.length,
      agentStats: {}
    };
    
    for (const [agentId, agent] of this.agents) {
      stats.agentStats[agentId] = {
        totalExecutions: agent.totalExecutions,
        totalErrors: agent.totalErrors,
        successRate: agent.totalExecutions > 0 
          ? ((agent.totalExecutions - agent.totalErrors) / agent.totalExecutions * 100).toFixed(2) + '%'
          : 'N/A',
        status: agent.status
      };
    }
    
    return stats;
  }
  
  /**
   * 初始化持久化
   */
  initializePersistence() {
    this.historyPath = '.autosnippet/coordinator';
    if (!fs.existsSync(this.historyPath)) {
      fs.mkdirSync(this.historyPath, { recursive: true });
    }
  }
  
  /**
   * 持久化执行历史
   */
  persistExecutionHistory() {
    const filePath = path.join(this.historyPath, 'execution-history.json');
    try {
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          records: this.executionHistory,
          timestamp: new Date().toISOString()
        }, null, 2)
      );
    } catch (error) {
      console.warn(`[AgentCoordinator] Failed to persist history: ${error.message}`);
    }
  }
  
  /**
   * 生成请求 ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * 生成会话 ID
   */
  generateSessionId() {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = AgentCoordinator;
