const { GoogleGenerativeAI } = require('@google/generative-ai');
const AiProvider = require('../AiProvider');

class GoogleGeminiProvider extends AiProvider {
  constructor(config) {
    super(config);
    
    // 处理代理逻辑
    const proxyUrl = process.env.https_proxy || process.env.http_proxy;
    let requestOptions = {};
    
    if (proxyUrl) {
      try {
        const { ProxyAgent, setGlobalDispatcher } = require('undici');
        const proxyAgent = new ProxyAgent(proxyUrl);
        setGlobalDispatcher(proxyAgent);
        console.log(`[AI] 已启用代理: ${proxyUrl}`);
      } catch (e) {
        console.warn('[AI] 尝试启用代理失败，请检查是否安装了 undici 模块');
      }
    }

    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.modelName = config.model || 'gemini-2.0-flash'; // 默认为 2.0 Flash
  }

  async _withRetry(fn, retries = 3, delay = 2000) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err) {
        // 只有 429 错误才重试
        if (err.status === 429 && i < retries - 1) {
          const waitTime = delay * Math.pow(2, i); // 指数退避
          console.warn(`[AI] 触发频率限制 (429)，${waitTime/1000}s 后进行第 ${i+1} 次重试...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        throw err;
      }
    }
  }

  async chat(prompt, history = [], systemInstruction = '') {
    return this._withRetry(async () => {
      const model = this.genAI.getGenerativeModel({ 
        model: this.modelName,
        systemInstruction: systemInstruction 
      });

      const chat = model.startChat({
        history: history.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        })),
      });

      const result = await chat.sendMessage(prompt);
      const response = await result.response;
      return response.text();
    });
  }

  async summarize(code, language = 'auto') {
    return this._withRetry(async () => {
      const model = this.genAI.getGenerativeModel({ model: this.modelName });
      
    const prompt = `
      You are an expert iOS developer.
      Analyze the following code and generate a structured summary for a knowledge base.
      
      IMPORTANT: 
      1. Detect the language correctly. If it contains '@interface', '[[... alloc] init]', it is "objectivec". If it contains 'func', 'let', 'var', it is "swift".
      2. If a README or Header file is provided, prioritize them to understand the **public API** and **recommended usage patterns**.
      3. Provide title, summary, and usageGuide in BOTH Chinese (Simplified) and English.
      4. The \`code\` field MUST be a **standardized usage example** (how to call the API/class) rather than the implementation.
      
      Provide the result in JSON format with the following keys:
      - title: A concise title (in English).
      - title_cn: A concise title (in Chinese).
      - summary_cn: A brief description (in Chinese).
      - summary_en: A brief description (in English).
      - trigger: A suggested short completion key (e.g., #network).
      - category: One of [View, Service, Tool, Model, Network, Storage, UI, Utility].
      - language: "swift" or "objectivec".
      - tags: An array of relevant tags.
      - usageGuide_cn: A Markdown formatted guide (in Chinese).
      - usageGuide_en: A Markdown formatted guide (in English).
      - code: A standardized usage example of this code (how to use it).

      Code/Context to Analyze:
      ${code}
    `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // 尝试解析 JSON
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : { error: 'Failed to parse AI response', raw: text };
      } catch (e) {
        return { error: 'JSON parse error', raw: text };
      }
    });
  }

  async extractSkills(targetName, filesContent) {
    return this._withRetry(async () => {
      const model = this.genAI.getGenerativeModel({ model: this.modelName });
      
      const prompt = `
        You are an expert iOS developer and technical writer. 
        I will provide you with several source files from the SPM target "${targetName}".
        
      Your task is to:
      1. Identify useful, reusable code snippets, focusing on **critical usage patterns** and **standardized examples** of how to use the code.
      2. For each snippet, extract its required header imports.
      3. For each snippet, extract a "Skill" (a deep usage guide).
      
      IMPORTANT: 
      - **Prioritize README.md and Header (.h) files**: Use them to identify the public API and standard usage patterns as intended by the author.
      - The \`code\` field MUST prioritize **usage examples** (how to call the API/class) rather than the internal implementation.
      - Provide Summary and Usage Guide in BOTH Chinese (Simplified) and English.
      
      Provide the result in JSON format as an array of objects, where each object has:
              - title: A concise name for the skill/snippet.
              - summary_cn: What this code does (in Chinese).
              - summary_en: What this code does (in English).
              - trigger: A short shortcut (starting with #, e.g., #network).
              - category: One of [View, Service, Tool, Model, Network, Storage, UI, Utility].
      - language: "swift" or "objectivec".
      - code: The actual reusable code block (focus on usage examples).
      - headers: An array of strings, each being a full import line required for this snippet.
      - usageGuide_cn: A detailed Markdown formatted guide (in Chinese) covering when to use, constraints, and parameters.
      - usageGuide_en: A detailed Markdown formatted guide (in English) covering when to use, constraints, and parameters.

        Files Content:
        ${filesContent.map(f => `--- FILE: ${f.name} ---\n${f.content}`).join('\n\n')}
      `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      try {
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : { error: 'Failed to parse AI response', raw: text };
      } catch (e) {
        return { error: 'JSON parse error', raw: text };
      }
    });
  }
}

module.exports = GoogleGeminiProvider;
