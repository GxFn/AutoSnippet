const GoogleGeminiProvider = require('./providers/GoogleGeminiProvider');

class AiFactory {
  /**
   * 创建 AI Provider 实例
   * @param {Object} options 
   * @returns {AiProvider}
   */
  static create(options = {}) {
    const provider = options.provider || process.env.ASD_AI_PROVIDER || 'google';
    const apiKey = options.apiKey || (provider === 'google' ? process.env.ASD_GOOGLE_API_KEY : null);
    
    if (!apiKey) {
      throw new Error(`API Key is missing for provider: ${provider}`);
    }

    switch (provider.toLowerCase()) {
              case 'google':
                return new GoogleGeminiProvider({
                  apiKey,
                  model: options.model || process.env.ASD_AI_MODEL || 'gemini-2.0-flash'
                });
      default:
        throw new Error(`Unsupported AI provider: ${provider}`);
    }
  }
}

module.exports = AiFactory;
