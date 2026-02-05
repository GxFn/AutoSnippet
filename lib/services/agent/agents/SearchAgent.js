/**
 * SearchAgent - 搜索 Agent
 */

const BaseAgent = require('../BaseAgent');
const { AgentTaskType, AgentCapability } = require('../IAgent');
const SearchServiceV2 = require('../../../search/SearchServiceV2');

class SearchAgent extends BaseAgent {
  static defaultConfig = {
  name: 'search-agent',
  description: 'Unified search agent',
  version: '1.0.0'
  };

  getCapabilities() {
  return [
    AgentCapability.SEMANTIC_SEARCH,
    AgentCapability.KEYWORD_SEARCH,
    AgentCapability.CONTEXT_AWARENESS
  ];
  }

  async _executeTask(task, options = {}) {
  const projectRoot = this.config.projectRoot || process.cwd();
  const taskType = task.type || AgentTaskType.KEYWORD_SEARCH;
  const keyword = task.keyword || task.query || task.text || '';

  if (!keyword) {
    return { success: false, error: 'Missing keyword for search' };
  }

  const semantic = taskType === AgentTaskType.SEMANTIC_SEARCH || task.semantic === true;
  const limit = task.limit || 10;

  const searchService = new SearchServiceV2(projectRoot);
  const results = await searchService.search(keyword, {
    semantic,
    limit,
    filter: task.filter || {}
  });

  return {
    success: true,
    result: {
    results,
    count: results.length
    }
  };
  }

  async _processMessage(message, context = {}) {
  return {
    reply: `Provide a keyword to search snippets/recipes. Example: "search debounce". Your message: ${message}`
  };
  }
}

module.exports = SearchAgent;
