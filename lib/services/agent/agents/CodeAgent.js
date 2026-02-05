/**
 * CodeAgent - 代码相关 Agent
 * 负责代码分析、生成与重构
 */

const BaseAgent = require('../BaseAgent');
const { AgentTaskType, AgentCapability } = require('../IAgent');

class CodeAgent extends BaseAgent {
  static defaultConfig = {
  name: 'code-agent',
  description: 'Code analysis and generation agent',
  version: '1.0.0'
  };

  getCapabilities() {
  return [
    AgentCapability.CODE_UNDERSTANDING,
    AgentCapability.CODE_GENERATION,
    AgentCapability.REASONING,
    AgentCapability.TOOL_USAGE
  ];
  }

  async _executeTask(task, options = {}) {
  const aiService = this._getAiService();
  const taskType = task.type || AgentTaskType.CODE_ANALYSIS;
  const instruction = task.instruction || task.prompt || '';
  const code = task.code || task.content || '';

  let systemHint = '';
  switch (taskType) {
    case AgentTaskType.CODE_GENERATION:
    systemHint = 'Generate code based on the instruction.';
    break;
    case AgentTaskType.CODE_REFACTOR:
    systemHint = 'Refactor the provided code.';
    break;
    case AgentTaskType.CODE_ANALYSIS:
    default:
    systemHint = 'Analyze the provided code.';
    break;
  }

  const prompt = [
    `You are a code assistant. ${systemHint}`,
    instruction ? `Instruction: ${instruction}` : null,
    code ? `Code:\n${code}` : null,
    'Provide concise and actionable output.'
  ].filter(Boolean).join('\n\n');

  const response = await aiService.chat(prompt, options);

  return {
    success: true,
    result: {
    output: response,
    taskType
    }
  };
  }

  async _processMessage(message, context = {}) {
  const aiService = this._getAiService();
  const prompt = this._buildPrompt(message, context);
  const response = await aiService.chat(prompt);
  return { reply: response };
  }
}

module.exports = CodeAgent;
