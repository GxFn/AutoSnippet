/**
 * XcodeSimulatorAPIClient
 * 
 * 职责：
 * - 与 Dashboard API 通信
 * - 健康检查
 * - 搜索 Recipe
 * - 创建 Candidate
 * - 执行代码审查
 * - 错误处理和重试
 */

const http = require('http');
const https = require('https');
const url = require('url');

class XcodeSimulatorAPIClient {
  constructor(baseURL = 'http://localhost:3000', options = {}) {
    this.baseURL = baseURL;
    this.timeout = options.timeout || 10000;
    this.retryAttempts = options.retryAttempts || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.logger = options.logger || console;
  }

  /**
   * 健康检查 - 验证 Dashboard 是否运行
   * @returns {Promise<{healthy: boolean, service: string, projectRoot: string}>}
   */
  async healthCheck() {
    try {
      const response = await this._request('GET', '/api/health');
      return {
        healthy: response.service === 'AutoSnippet Dashboard',
        service: response.service,
        projectRoot: response.projectRoot,
        timestamp: response.timestamp
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * 搜索 Recipe
   * @param {string} keyword - 搜索关键字
   * @param {object} options - 搜索选项 { limit, offset, scope }
   * @returns {Promise<{results: array, total: number}>}
   */
  async search(keyword, options = {}) {
    if (!keyword) {
      throw new Error('Keyword is required');
    }

    const params = {
      q: keyword,
      limit: options.limit || 10,
      offset: options.offset || 0,
      scope: options.scope || 'all'  // 'all', 'recipes', 'snippets'
    };

    try {
      const response = await this._request('GET', '/api/recipes', params);
      return {
        results: response.results || [],
        total: response.total || 0,
        keyword,
        timestamp: Date.now()
      };
    } catch (error) {
      this.logger.error(`[APIClient] Search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取单个 Recipe
   * @param {string} recipeId - Recipe ID
   * @returns {Promise<object>}
   */
  async getRecipe(recipeId) {
    if (!recipeId) {
      throw new Error('Recipe ID is required');
    }

    try {
      const response = await this._request('GET', `/api/recipes/${recipeId}`);
      return response;
    } catch (error) {
      this.logger.error(`[APIClient] Get recipe failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 创建 Candidate（从代码创建候选）
   * @param {object} payload - { code, filePath, language, description }
   * @returns {Promise<{candidateId, status, message}>}
   */
  async createCandidate(payload) {
    if (!payload.code || !payload.filePath) {
      throw new Error('code and filePath are required');
    }

    const body = {
      code: payload.code,
      filePath: payload.filePath,
      language: payload.language || 'swift',
      description: payload.description || '',
      source: payload.source || 'simulator',
      timestamp: Date.now()
    };

    try {
      const response = await this._request('POST', '/api/candidates', null, body);
      return {
        candidateId: response.id || response.candidateId,
        status: response.status || 'created',
        message: response.message || 'Candidate created successfully'
      };
    } catch (error) {
      this.logger.error(`[APIClient] Create candidate failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 执行代码审查（Guard）
   * @param {object} payload - { fileContent, keyword, scope, filePath }
   * @returns {Promise<{violations, suggestions, score}>}
   */
  async executeAudit(payload) {
    if (!payload.fileContent) {
      throw new Error('fileContent is required');
    }

    const body = {
      fileContent: payload.fileContent,
      filePath: payload.filePath || '',
      keyword: payload.keyword || '',
      scope: payload.scope || 'file',  // 'file', 'target', 'project'
      language: payload.language || 'swift'
    };

    try {
      const response = await this._request('POST', '/api/audit', null, body);
      return {
        violations: response.violations || [],
        suggestions: response.suggestions || [],
        score: response.score || 0,
        timestamp: Date.now()
      };
    } catch (error) {
      this.logger.error(`[APIClient] Audit failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取项目配置信息
   * @returns {Promise<object>}
   */
  async getSpec() {
    try {
      const response = await this._request('GET', '/api/spec');
      return {
        spec: response,
        timestamp: Date.now()
      };
    } catch (error) {
      this.logger.error(`[APIClient] Get spec failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取 Dashboard 统计信息
   * @returns {Promise<object>}
   */
  async getStats() {
    try {
      const response = await this._request('GET', '/api/stats');
      return {
        stats: response,
        timestamp: Date.now()
      };
    } catch (error) {
      this.logger.error(`[APIClient] Get stats failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 内部 HTTP 请求方法
   * @param {string} method - HTTP 方法 (GET, POST, PUT, DELETE)
   * @param {string} path - 请求路径
   * @param {object} params - 查询参数
   * @param {object} body - 请求体
   * @returns {Promise<object>}
   */
  async _request(method, path, params = null, body = null) {
    return this._retryRequest(
      () => this._makeRequest(method, path, params, body),
      1  // 当前重试次数
    );
  }

  /**
   * 重试 HTTP 请求
   */
  async _retryRequest(fn, attempt) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < this.retryAttempts) {
        this.logger.warn(`[APIClient] Retry ${attempt}/${this.retryAttempts} after ${this.retryDelay}ms`);
        await this.delay(this.retryDelay);
        return this._retryRequest(fn, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * 实际 HTTP 请求
   */
  _makeRequest(method, path, params = null, body = null) {
    return new Promise((resolve, reject) => {
      try {
        const parsedUrl = new url.URL(this.baseURL);
        
        // 构建完整 URL
        let urlString = this.baseURL + path;
        if (params && Object.keys(params).length > 0) {
          const queryString = Object.entries(params)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&');
          urlString += '?' + queryString;
        }

        const requestUrl = new url.URL(urlString);
        const protocol = requestUrl.protocol === 'https:' ? https : http;
        
        const options = {
          method,
          hostname: requestUrl.hostname,
          port: requestUrl.port || (requestUrl.protocol === 'https:' ? 443 : 80),
          path: requestUrl.pathname + requestUrl.search,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'XcodeSimulator/1.0'
          },
          timeout: this.timeout
        };

        const req = protocol.request(options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              const response = data ? JSON.parse(data) : {};

              if (res.statusCode >= 400) {
                const error = new Error(
                  response.message || `HTTP ${res.statusCode}`
                );
                error.statusCode = res.statusCode;
                error.response = response;
                reject(error);
              } else {
                resolve(response);
              }
            } catch (parseError) {
              reject(new Error(`Failed to parse response: ${parseError.message}`));
            }
          });
        });

        req.on('error', (error) => {
          reject(new Error(`Request failed: ${error.message}`));
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error(`Request timeout after ${this.timeout}ms`));
        });

        // 发送请求体
        if (body && (method === 'POST' || method === 'PUT')) {
          req.write(JSON.stringify(body));
        }

        req.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 延迟函数
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 设置基础 URL
   */
  setBaseURL(baseURL) {
    this.baseURL = baseURL;
  }

  /**
   * 获取基础 URL
   */
  getBaseURL() {
    return this.baseURL;
  }

  /**
   * 设置超时时间
   */
  setTimeout(ms) {
    this.timeout = ms;
  }

  /**
   * 设置重试配置
   */
  setRetryConfig(attempts, delayMs) {
    this.retryAttempts = attempts;
    this.retryDelay = delayMs;
  }
}

module.exports = XcodeSimulatorAPIClient;
