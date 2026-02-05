/**
 * RecipeAgent - Recipe 推荐与搜索 Agent
 */

const BaseAgent = require('../BaseAgent');
const { AgentTaskType, AgentCapability } = require('../IAgent');
const SearchServiceV2 = require('../../../search/SearchServiceV2');

class RecipeAgent extends BaseAgent {
  static defaultConfig = {
  name: 'recipe-agent',
  description: 'Recipe search and recommendation agent',
  version: '1.0.0'
  };

  getCapabilities() {
  return [
    AgentCapability.RECIPE_RECOMMENDATION,
    AgentCapability.SEMANTIC_SEARCH,
    AgentCapability.KEYWORD_SEARCH
  ];
  }

  async _executeTask(task, options = {}) {
  const projectRoot = this.config.projectRoot || process.cwd();
  const taskType = task.type || AgentTaskType.RECIPE_SEARCH;
  const keyword = task.keyword || task.query || task.text || '';

  if (!keyword) {
    return { success: false, error: 'Missing keyword for recipe search' };
  }

  if (taskType === AgentTaskType.RECIPE_RECOMMEND) {
    // 简单基于关键词的推荐（可扩展为 AI 推荐）
    const searchService = new SearchServiceV2(projectRoot);
    const results = await searchService.search(keyword, {
    semantic: true,
    limit: task.limit || 10
    });

    const recipes = results.filter(r => r.type === 'recipe');

    return {
    success: true,
    result: {
      recommendations: recipes,
      count: recipes.length
    }
    };
  }

  // 默认搜索
  const searchService = new SearchServiceV2(projectRoot);
  const results = await searchService.search(keyword, {
    semantic: task.semantic || false,
    limit: task.limit || 10
  });

  const recipes = results.filter(r => r.type === 'recipe');

  return {
    success: true,
    result: {
    recipes,
    count: recipes.length
    }
  };
  }

  async _processMessage(message, context = {}) {
  return {
    reply: `Provide a keyword to search recipes. Example: "search recipe for networking". Your message: ${message}`
  };
  }
}

module.exports = RecipeAgent;
