/**
 * AI Provider 抽象基类
 */
class AiProvider {
  constructor(config) {
    this.config = config;
  }

  /**
   * 发送聊天请求
   * @param {string} prompt 
   * @param {Object} context 
   */
  async chat(prompt, context) {
    throw new Error('Method chat() must be implemented');
  }

  /**
   * 生成代码摘要和 Skill 描述
   * @param {string} code 
   */
  async summarize(code) {
    throw new Error('Method summarize() must be implemented');
  }
}

module.exports = AiProvider;
