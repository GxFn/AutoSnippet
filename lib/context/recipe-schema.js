/**
 * Recipe 元数据 Schema (v2)
 * 扩展从 8 字段 → 25+ 字段
 * 用于知识库结构化和语义理解
 */

const RecipeSchema = {
  // ============= 基础信息 (5 fields) =============
  id: {
    type: 'string',
    description: 'Recipe 唯一标识符',
    example: 'recipe_async_await_001',
    required: true
  },
  
  title: {
    type: 'string',
    description: 'Recipe 标题',
    example: '使用 async/await 处理异步操作',
    required: true,
    maxLength: 200
  },
  
  language: {
    type: 'string',
    description: '编程语言',
    enum: ['javascript', 'typescript', 'python', 'swift', 'kotlin', 'java', 'cpp', 'rust', 'go', 'ruby', 'php', 'csharp', 'other'],
    required: true
  },
  
  category: {
    type: 'string',
    description: 'Recipe 分类',
    example: 'async-patterns',
    required: true
  },
  
  description: {
    type: 'string',
    description: 'Recipe 简短描述',
    maxLength: 500
  },

  // ============= 内容相关 (3 fields) =============
  code: {
    type: 'string',
    description: '代码片段内容',
    required: true
  },
  
  codeBlocks: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        language: 'string',
        content: 'string',
        description: 'string'
      }
    },
    description: '多个代码块'
  },
  
  documentation: {
    type: 'string',
    description: '详细的使用说明和解释',
    maxLength: 5000
  },

  // ============= 语义标签 (3 fields) =============
  semanticTags: {
    type: 'array',
    items: 'string',
    description: '语义标签（自动提取或人工标注）',
    example: ['asynchronous-programming', 'promise-handling', 'error-recovery']
  },
  
  keywords: {
    type: 'array',
    items: 'string',
    description: '关键词（用于 BM25 搜索）',
    example: ['async', 'await', 'promise', 'error handling']
  },
  
  topics: {
    type: 'array',
    items: 'string',
    description: 'Recipe 涵盖的主题',
    example: ['concurrency', 'error-handling', 'best-practices']
  },

  // ============= 使用语境 (4 fields) =============
  whenToUse: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: '何时应该使用此 Recipe'
      },
      conditions: {
        type: 'array',
        items: 'string',
        description: '适用条件列表'
      },
      scenarioScores: {
        type: 'object',
        description: '在不同场景中的适用度（0-1）',
        example: {
          'data-fetching': 0.95,
          'file-operations': 0.85,
          'database-queries': 0.9,
          'cpu-intensive': 0.3
        }
      }
    }
  },
  
  whenNotToUse: {
    type: 'object',
    properties: {
      cases: {
        type: 'array',
        items: 'string',
        description: '不应该使用的情况'
      },
      antiPatterns: {
        type: 'array',
        items: 'string',
        description: '常见的反面例子'
      }
    }
  },
  
  useCases: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        scenario: 'string',
        description: 'string',
        example: 'string'
      }
    },
    description: '具体的使用场景示例'
  },
  
  prerequisites: {
    type: 'array',
    items: 'string',
    description: '需要先掌握的前置知识',
    example: ['Promise basics', 'callback functions']
  },

  // ============= 替代方案 (1 field) =============
  alternatives: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        recipeId: {
          type: 'string',
          description: '替代 Recipe 的 ID'
        },
        reason: {
          type: 'string',
          description: '为什么这是替代方案'
        },
        tradeoffs: {
          type: 'string',
          description: '使用此替代方案的权衡'
        },
        similarityScore: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: '与原 Recipe 的相似度'
        }
      }
    },
    description: '替代方案列表'
  },

  // ============= 质量指标 (6 fields) =============
  quality: {
    type: 'object',
    properties: {
      codeReviewStatus: {
        type: 'string',
        enum: ['draft', 'review', 'approved', 'deprecated'],
        description: 'Code Review 状态'
      },
      testCoverage: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: '测试覆盖率'
      },
      securityAudit: {
        type: 'string',
        enum: ['pending', 'fail', 'pass'],
        description: '安全审计结果'
      },
      performanceScore: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: '性能得分'
      },
      maintenanceScore: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: '可维护性得分'
      },
      authorityScore: {
        type: 'number',
        minimum: 0,
        maximum: 5,
        description: '权威性评分（0-5 scale）'
      }
    }
  },
  
  security: {
    type: 'object',
    properties: {
      riskLevel: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: '安全风险等级'
      },
      commonPitfalls: {
        type: 'array',
        items: 'string',
        description: '常见陷阱和容易出错的地方'
      },
      bestPractices: {
        type: 'array',
        items: 'string',
        description: '最佳实践建议'
      },
      securityConsiderations: {
        type: 'array',
        items: 'string',
        description: '安全相关的注意事项'
      }
    }
  },
  
  performance: {
    type: 'object',
    properties: {
      timeComplexity: {
        type: 'string',
        example: 'O(n)',
        description: '时间复杂度'
      },
      spaceComplexity: {
        type: 'string',
        example: 'O(n)',
        description: '空间复杂度'
      },
      typicalExecutionTime: {
        type: 'string',
        description: '典型执行时间单位',
        example: 'ms'
      },
      scalabilityNotes: {
        type: 'string',
        description: '可扩展性说明'
      },
      benchmarks: {
        type: 'object',
        description: '性能基准数据'
      }
    }
  },
  
  compatibility: {
    type: 'object',
    properties: {
      minVersion: {
        type: 'string',
        description: '最低支持版本'
      },
      maxVersion: {
        type: 'string',
        description: '最高支持版本'
      },
      platforms: {
        type: 'array',
        items: 'string',
        description: '支持的平台'
      },
      runtimes: {
        type: 'array',
        items: 'string',
        description: '支持的运行环境'
      }
    }
  },
  
  dependencies: {
    type: 'object',
    properties: {
      requires: {
        type: 'array',
        items: 'string',
        description: '前置 Recipe ID 列表'
      },
      usedBy: {
        type: 'array',
        items: 'string',
        description: '被哪些 Recipe 使用'
      },
      conflicts: {
        type: 'array',
        items: 'string',
        description: '与哪些 Recipe 冲突'
      },
      relatedRecipes: {
        type: 'array',
        items: 'string',
        description: '相关的 Recipe'
      }
    }
  },

  // ============= 版本与维护 (4 fields) =============
  version: {
    type: 'string',
    description: 'Recipe 版本号',
    example: '1.2.0'
  },
  
  lastModified: {
    type: 'string',
    format: 'date-time',
    description: '最后修改时间',
    required: true
  },
  
  author: {
    type: 'string',
    description: '作者'
  },
  
  deprecated: {
    type: 'boolean',
    default: false,
    description: '是否已过时'
  },
  
  deprecationReason: {
    type: 'string',
    description: '过时原因'
  },
  
  replacedBy: {
    type: 'string',
    description: '被哪个 Recipe 替代'
  },

  // ============= 向量嵌入 (2 fields) =============
  embedding: {
    type: 'array',
    items: 'number',
    description: '密集向量嵌入（768 维）',
    length: 768
  },
  
  embeddingModel: {
    type: 'string',
    description: '向量模型名称',
    example: 'text-embedding-3-small'
  },

  // ============= 统计数据 (3 fields) =============
  stats: {
    type: 'object',
    properties: {
      guardUsageCount: {
        type: 'integer',
        minimum: 0,
        description: '被 Guard (Lint) 使用的次数'
      },
      humanUsageCount: {
        type: 'integer',
        minimum: 0,
        description: '被人工使用的次数'
      },
      aiUsageCount: {
        type: 'integer',
        minimum: 0,
        description: '被 AI 使用的次数'
      },
      usageHeat: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: '使用热度（综合指标）'
      },
      lastUsedAt: {
        type: 'string',
        format: 'date-time',
        description: '最后使用时间'
      }
    }
  },
  
  feedback: {
    type: 'object',
    properties: {
      averageRating: {
        type: 'number',
        minimum: 0,
        maximum: 5,
        description: '平均评分'
      },
      ratingCount: {
        type: 'integer',
        description: '评分数量'
      },
      comments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            user: 'string',
            rating: 'number',
            comment: 'string',
            timestamp: 'string'
          }
        },
        description: '用户反馈'
      }
    }
  },
  
  metadata: {
    type: 'object',
    description: '其他自定义元数据',
    additionalProperties: true
  }
};

module.exports = {
  RecipeSchema,
  
  // 必需字段列表
  required: [
    'id',
    'title',
    'language',
    'category',
    'code',
    'lastModified',
    'embedding'
  ],
  
  // 字段分组
  fieldGroups: {
    basic: ['id', 'title', 'language', 'category', 'description'],
    content: ['code', 'codeBlocks', 'documentation'],
    semantic: ['semanticTags', 'keywords', 'topics'],
    context: ['whenToUse', 'whenNotToUse', 'useCases', 'prerequisites'],
    alternatives: ['alternatives'],
    quality: ['quality', 'security', 'performance', 'compatibility', 'dependencies'],
    version: ['version', 'lastModified', 'author', 'deprecated', 'deprecationReason', 'replacedBy'],
    embedding: ['embedding', 'embeddingModel'],
    stats: ['stats', 'feedback', 'metadata']
  },
  
  // 验证规则
  validation: {
    idPattern: /^recipe_[a-z0-9_]+_\d{3}$/,  // recipe_category_001
    titleMaxLength: 200,
    codeMaxLength: 50000,
    semanticTagsMaxCount: 20,
    keywordsMaxCount: 30
  }
};
