/**
 * GuardAgent - 质量检查 Agent
 * 负责静态规则检查与违规报告
 */

const path = require('path');
const BaseAgent = require('../BaseAgent');
const { AgentTaskType, AgentCapability } = require('../IAgent');
const guardRules = require('../../../guard/guardRules');

class GuardAgent extends BaseAgent {
  static defaultConfig = {
  name: 'guard-agent',
  description: 'Guard and quality check agent',
  version: '1.0.0'
  };

  getCapabilities() {
  return [
    AgentCapability.STATIC_ANALYSIS,
    AgentCapability.QUALITY_CHECK,
    AgentCapability.REASONING
  ];
  }

  async _executeTask(task, options = {}) {
  const taskType = task.type || AgentTaskType.GUARD_CHECK;
  if (taskType !== AgentTaskType.GUARD_CHECK) {
    return { success: false, error: `Unsupported task type: ${taskType}` };
  }

  const projectRoot = this.config.projectRoot || process.cwd();
  const code = task.code || '';
  const language = task.language || guardRules.getLanguageFromPath?.(task.filePath || '') || null;
  const scope = task.scope || 'file';

  if (!code && !task.filePath) {
    return { success: false, error: 'Missing code or filePath for guard check' };
  }

  let violations = [];

  if (code && language) {
    violations = guardRules.runStaticCheck(projectRoot, code, language, scope) || [];
  } else if (task.filePath) {
    const relativePath = path.relative(projectRoot, task.filePath);
    const inferredLang = guardRules.getLanguageFromPath(relativePath);
    if (inferredLang && task.fileScope) {
    violations = await guardRules.runStaticCheckForScope(
      projectRoot,
      task.fileScope,
      task.filePath,
      scope
    );
    } else {
    return { success: false, error: 'Cannot infer language for guard check' };
    }
  }

  return {
    success: true,
    result: {
    violations,
    count: violations.length
    }
  };
  }

  async _processMessage(message, context = {}) {
  return {
    reply: `GuardAgent ready. Provide code or filePath for checks. Message: ${message}`
  };
  }
}

module.exports = GuardAgent;
