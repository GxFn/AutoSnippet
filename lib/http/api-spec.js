/**
 * API 文档 - OpenAPI 3.0 规范
 */

export const apiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'AutoSnippet API',
    description: '自动代码片段管理系统 REST API',
    version: '2.0.0',
    contact: {
      name: 'AutoSnippet Team',
      url: 'https://github.com/autosnippet',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000/api/v1',
      description: 'Development server',
    },
    {
      url: 'https://api.autosnippet.dev/api/v1',
      description: 'Production server',
    },
  ],
  paths: {
    '/health': {
      get: {
        summary: '健康检查',
        description: '检查服务器是否正常运行',
        tags: ['System'],
        responses: {
          200: {
            description: '服务器状态正常',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    status: { type: 'string', example: 'healthy' },
                    timestamp: { type: 'number', example: 1675900000 },
                    uptime: { type: 'number', example: 3600 },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/health/ready': {
      get: {
        summary: '就绪检查',
        description: '检查服务器是否已准备好处理请求',
        tags: ['System'],
        responses: {
          200: {
            description: '服务器已准备好',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    ready: { type: 'boolean', example: true },
                    timestamp: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/candidates': {
      get: {
        summary: '获取候选人列表',
        description: '分页获取所有候选人',
        tags: ['Candidates'],
        parameters: [
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', default: 1 },
            description: '页码',
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 20 },
            description: '每页数量',
          },
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
            description: '候选人状态',
          },
        ],
        responses: {
          200: {
            description: '候选人列表',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        candidates: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/Candidate' },
                        },
                        page: { type: 'integer' },
                        limit: { type: 'integer' },
                        total: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: '创建候选人',
        description: '创建新的候选人记录',
        tags: ['Candidates'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'source'],
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  source: { type: 'string' },
                  metadata: { type: 'object' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: '候选人创建成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/Candidate' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/candidates/{id}': {
      get: {
        summary: '获取候选人详情',
        tags: ['Candidates'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: '候选人详情',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/Candidate' },
                  },
                },
              },
            },
          },
          404: {
            description: '候选人不存在',
          },
        },
      },
    },
    '/candidates/{id}/approve': {
      patch: {
        summary: '批准候选人',
        tags: ['Candidates'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  reasoning: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: '批准成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/Candidate' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/candidates/{id}/reject': {
      patch: {
        summary: '拒绝候选人',
        tags: ['Candidates'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  reasoning: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: '拒绝成功',
          },
        },
      },
    },
    '/recipes': {
      get: {
        summary: '获取食谱列表',
        tags: ['Recipes'],
        parameters: [
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', default: 1 },
          },
          {
            name: 'category',
            in: 'query',
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: '食谱列表',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        recipes: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/Recipe' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: '创建食谱',
        tags: ['Recipes'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'category', 'content'],
                properties: {
                  name: { type: 'string' },
                  category: { type: 'string' },
                  description: { type: 'string' },
                  content: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: '食谱创建成功',
          },
        },
      },
    },
    '/recipes/{id}': {
      get: {
        summary: '获取食谱详情',
        tags: ['Recipes'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: '食谱详情',
          },
          404: {
            description: '食谱不存在',
          },
        },
      },
      patch: {
        summary: '更新食谱',
        tags: ['Recipes'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: '更新成功',
          },
        },
      },
    },
    '/recipes/{id}/publish': {
      patch: {
        summary: '发布食谱',
        tags: ['Recipes'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  version: { type: 'string' },
                  releaseNotes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: '发布成功',
          },
        },
      },
    },
    '/recipes/{id}/quality': {
      patch: {
        summary: '更新食谱质量指标',
        tags: ['Recipes'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: '更新成功',
          },
        },
      },
    },
    '/rules': {
      get: {
        summary: '获取防护规则列表',
        tags: ['GuardRules'],
        responses: {
          200: {
            description: '规则列表',
          },
        },
      },
      post: {
        summary: '创建防护规则',
        tags: ['GuardRules'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'pattern', 'action'],
                properties: {
                  name: { type: 'string' },
                  category: { type: 'string' },
                  pattern: { type: 'string' },
                  condition: { type: 'object' },
                  action: { type: 'string' },
                  priority: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: '规则创建成功',
          },
        },
      },
    },
    '/rules/{id}': {
      get: {
        summary: '获取规则详情',
        tags: ['GuardRules'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: '规则详情',
          },
        },
      },
    },
    '/rules/{id}/enable': {
      patch: {
        summary: '启用规则',
        tags: ['GuardRules'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: '启用成功',
          },
        },
      },
    },
    '/rules/{id}/disable': {
      patch: {
        summary: '禁用规则',
        tags: ['GuardRules'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: '禁用成功',
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Candidate: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          source: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
          createdAt: { type: 'number' },
          updatedAt: { type: 'number' },
        },
      },
      Recipe: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          category: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['draft', 'published', 'deprecated'] },
          createdAt: { type: 'number' },
          updatedAt: { type: 'number' },
        },
      },
      GuardRule: {
        type: 'object',
        description: 'Guard rules are now boundary-constraint type Recipes',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          knowledgeType: { type: 'string', enum: ['boundary-constraint'] },
          constraints: { type: 'object' },
          status: { type: 'string' },
          createdAt: { type: 'number' },
        },
      },
    },
  },
};

export default apiSpec;
