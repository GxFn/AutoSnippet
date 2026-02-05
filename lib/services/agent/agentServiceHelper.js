const path = require('path');
const { createContainer } = require('../../bootstrap');

const agentServiceCache = new Map();

async function getAgentService(projectRoot) {
  const cacheKey = projectRoot || process.cwd();
  if (agentServiceCache.has(cacheKey)) {
  return agentServiceCache.get(cacheKey);
  }

  const container = createContainer(cacheKey);
  container.boot();

  const aiService = container.resolve('ai-service');
  await aiService.initialize({ autoLoad: true });

  const agentService = container.resolve('agent-service');
  await agentService.initialize({
  autoLoad: true,
  agentsPath: path.join(__dirname, 'agents'),
  toolsPath: path.join(__dirname, 'tools')
  });

  const payload = { agentService, container };
  agentServiceCache.set(cacheKey, payload);
  return payload;
}

module.exports = {
  getAgentService
};
