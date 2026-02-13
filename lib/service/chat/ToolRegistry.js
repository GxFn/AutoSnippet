/**
 * ToolRegistry — 统一工具注册表
 *
 * 管理 ChatAgent 可调用的所有工具定义。
 * 每个工具包含: name, description, parameters(JSON Schema), handler
 *
 * 设计原则:
 * - 所有 AI 能力均封装为 Tool，不再散落在各处
 * - Tool handler 仅做参数整理 + 调用已有 Service，不含业务逻辑
 * - 支持 programmatic 直接调用 (executeTool) 和 Agent ReAct 循环调用
 */

import Logger from '../../infrastructure/logging/Logger.js';

export class ToolRegistry {
  #tools = new Map();
  #logger;

  constructor() {
    this.#logger = Logger.getInstance();
  }

  /**
   * 注册一个工具
   * @param {object} toolDef
   * @param {string} toolDef.name        — 工具唯一名称 (snake_case)
   * @param {string} toolDef.description  — 给 LLM 看的工具描述
   * @param {object} toolDef.parameters   — JSON Schema 格式的参数定义
   * @param {Function} toolDef.handler    — async (params, context) => result
   */
  register(toolDef) {
    const { name, description, handler, parameters = {} } = toolDef;
    if (!name || !handler) throw new Error('Tool must have name and handler');
    this.#tools.set(name, { name, description, parameters, handler });
  }

  /**
   * 批量注册
   * @param {Array<object>} defs
   */
  registerAll(defs) {
    for (const def of defs) this.register(def);
    this.#logger.info(`[ToolRegistry] ${defs.length} tools registered`);
  }

  /**
   * 获取工具定义（不含 handler，给 LLM prompt 使用）
   */
  getToolSchemas() {
    const schemas = [];
    for (const [, tool] of this.#tools) {
      schemas.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      });
    }
    return schemas;
  }

  /**
   * 直接执行某个工具
   * @param {string} name
   * @param {object} params
   * @param {object} context — { container, aiProvider, projectRoot, ... }
   * @returns {Promise<any>}
   */
  async execute(name, params, context = {}) {
    const tool = this.#tools.get(name);
    if (!tool) throw new Error(`Tool '${name}' not found`);

    this.#logger.debug(`Tool execute: ${name}`, { params: Object.keys(params) });
    try {
      const result = await tool.handler(params, context);
      return result;
    } catch (err) {
      this.#logger.error(`Tool '${name}' failed`, { error: err.message });
      return { error: err.message };
    }
  }

  /**
   * 检查工具是否存在
   */
  has(name) {
    return this.#tools.has(name);
  }

  /**
   * 获取所有工具名
   */
  getToolNames() {
    return [...this.#tools.keys()];
  }

  /**
   * 工具数量
   */
  get size() {
    return this.#tools.size;
  }
}

export default ToolRegistry;
