import { ConstitutionViolation } from '../../shared/errors/BaseError.js';
import Logger from '../../infrastructure/logging/Logger.js';

/**
 * ConstitutionValidator - 宪法验证器
 */
export class ConstitutionValidator {
  constructor(constitution) {
    this.constitution = constitution;
    this.logger = Logger.getInstance();
  }

  /**
   * 验证操作是否违反宪法
   */
  async validate(request) {
    const violations = [];
    const priorities = this.constitution.getPriorities();

    for (const priority of priorities) {
      const priorityViolations = await this.checkPriority(priority, request);
      violations.push(...priorityViolations);
    }

    // 按优先级排序（优先级 1 最重要）
    violations.sort((a, b) => a.priority - b.priority);

    const result = {
      compliant: violations.length === 0,
      violations: violations,
      highestViolatedPriority: violations[0]?.priority || null,
    };

    if (!result.compliant) {
      this.logger.warn('Constitution violations detected', {
        actor: request.actor,
        action: request.action,
        violations: result.violations.length,
      });
    }

    return result;
  }

  /**
   * 检查特定优先级的规则
   */
  async checkPriority(priority, request) {
    const violations = [];
    const verb = this._extractVerb(request.action);
    const resName = this._extractResourceName(request.action, request.resource);

    // Priority 1: Data Integrity
    if (priority.id === 1) {
      // 检查破坏性操作
      if (this.isDestructiveOperation(request)) {
        if (!request.data?.confirmed && !request.confirmed) {
          violations.push({
            priority: 1,
            rule: '删除操作必须有确认步骤',
            reason: '操作未经确认',
            suggestion: '添加 confirmed: true 或 --confirm 标志',
          });
        }
      }

      // 检查数据完整性
      // 支持 Gateway 格式 (candidate:create) + REST 格式 (create + /candidates) + Legacy 格式 (create_candidate)
      const isCandidateOrRecipeCreation =
        (verb === 'create' && (resName.includes('candidate') || resName.includes('recipe'))) ||
        (request.action === 'create' && (request.resource?.includes('/candidates') || request.resource?.includes('/recipes'))) ||
        request.action === 'create_candidate' ||
        request.action === 'create_recipe';

      if (isCandidateOrRecipeCreation) {
        // 单条: data.code / data.content
        // 批量: data.items (每条内含 code)
        // 草稿: data.filePaths (内容在文件中)
        const hasContent = request.data?.code || request.code || request.data?.content
          || (Array.isArray(request.data?.items) && request.data.items.length > 0)
          || request.data?.filePaths;
        if (!hasContent) {
          violations.push({
            priority: 1,
            rule: '所有内容必须可验证',
            reason: '缺少 code/content 字段',
            suggestion: '提供完整的代码或内容',
          });
        }
      }
    }

    // Priority 2: Human Oversight
    if (priority.id === 2) {
      // AI 不能直接批准或创建 Recipe
      // 支持 Gateway 格式 (recipe:create, candidate:approve, recipe:publish) + Legacy 格式
      const isRecipeModification =
        (verb === 'create' && resName.includes('recipe')) ||
        (verb === 'approve') ||
        (verb === 'publish' && resName.includes('recipe')) ||
        (request.action === 'create' && request.resource?.includes('/recipes')) ||
        request.action === 'approve_candidate' ||
        request.action === 'approve_recipe' ||
        request.action === 'create_recipe';

      if (isRecipeModification) {
        if (this.isAIActor(request.actor)) {
          violations.push({
            priority: 2,
            rule: 'AI 生成的 Candidate 必须经人工审核',
            reason: 'AI 不能直接批准或创建 Recipe',
            suggestion: '通过 Dashboard 人工审批或使用 developer_admin 角色',
          });
        }
      }

      // 批量操作需要授权
      if (request.action === 'batch_update' || request.action === 'batch_delete') {
        if (!request.data?.authorized && !request.authorized) {
          violations.push({
            priority: 2,
            rule: '批量操作需要明确授权',
            reason: '缺少授权标志',
            suggestion: '添加 authorized: true 标志',
          });
        }
      }
    }

    // Priority 3: AI Transparency
    if (priority.id === 3) {
      // AI 生成必须有 reasoning
      // 支持 Gateway 格式 (candidate:create) + REST 格式 + Legacy 格式
      const isCandidateCreation =
        (verb === 'create' && resName.includes('candidate')) ||
        (request.action === 'create' && request.resource?.includes('/candidates')) ||
        request.action === 'create_candidate';

      if (isCandidateCreation) {
        if (this.isAIActor(request.actor)) {
          // MCP handler (_createCandidateItem) 会自动生成默认 reasoning，
          // 此处仅在 reasoning 明确为空对象时警告，不阻断提交
          const r = request.data?.reasoning;
          if (r && typeof r === 'object') {
            if (!r.whyStandard && !r.sources) {
              violations.push({
                priority: 3,
                rule: 'Reasoning 信息必须完整',
                reason: '提供了 reasoning 但缺少 whyStandard 和 sources',
                suggestion: '提供完整的推理过程说明',
              });
            }
          }
          // 未传 reasoning 时不视为违规 — handler 层会自动生成默认值
        }
      }

      // Guard 规则（现在是 Recipe）必须有来源
      // 支持 Gateway 格式 (guard_rule:create) + REST 格式 + Legacy 格式
      const isGuardRuleModification =
        ((verb === 'create' || verb === 'update' || verb === 'enable') && resName.includes('guard')) ||
        (request.action === 'create' && request.resource?.includes('/guard')) ||
        (request.action === 'update' && request.resource?.includes('/guard')) ||
        request.action === 'create_guard_rule' ||
        request.action === 'update_guard_rule';

      if (isGuardRuleModification) {
        if (!request.data?.source_recipe_id && !request.data?.sourceCandidate) {
          violations.push({
            priority: 3,
            rule: 'Guard 规则必须关联来源',
            reason: '缺少 source_recipe_id 或 sourceCandidate',
            suggestion: '指定规则来源的 Recipe ID 或 Candidate ID',
          });
        }
      }
    }

    // Priority 4: Helpfulness - 通常不会导致违规，仅提示优化建议
    // （此优先级主要用于质量评估，而非硬性限制）

    return violations;
  }

  /**
   * 判断是否为破坏性操作
   */
  isDestructiveOperation(request) {
    const destructiveActions = [
      'delete',
      'remove',
      'destroy',
      'purge',
      'truncate',
      'drop',
      'batch_delete',
    ];

    return destructiveActions.some((word) => request.action.toLowerCase().includes(word));
  }

  /**
   * 判断是否为 AI 角色
   */
  isAIActor(actor) {
    const aiActors = ['cursor_agent', 'asd_ais', 'guard_engine'];
    return aiActors.some((ai) => actor.toLowerCase().includes(ai));
  }

  /**
   * 从 action 字符串提取动词
   * 支持多种格式:
   *   'create'              → 'create'
   *   'candidate:create'    → 'create'   (Gateway)
   *   'create_candidate'    → 'create'   (Legacy)
   */
  _extractVerb(action) {
    if (!action) return '';
    // Gateway resource:verb 格式
    if (action.includes(':')) return action.split(':').pop();
    // 其他格式直接返回
    return action;
  }

  /**
   * 从 action 和 resource 提取资源名（单数形式）
   * 支持:
   *   'candidate:create' → 'candidate'       (Gateway)
   *   '/candidates/123'  → 'candidates'      (REST path)
   *   'candidates'       → 'candidates'      (plain)
   */
  _extractResourceName(action, resource) {
    // 优先从 Gateway action 格式提取
    if (action?.includes(':')) {
      return action.split(':')[0];
    }
    // 从 resource 提取
    if (typeof resource === 'string') {
      if (resource.startsWith('/')) {
        const match = resource.match(/^\/([^/]+)/);
        return match ? match[1] : resource;
      }
      return resource;
    }
    return '';
  }

  /**
   * 强制验证（违规时抛出异常）
   */
  async enforce(request) {
    const result = await this.validate(request);
    if (!result.compliant) {
      throw new ConstitutionViolation(result.violations);
    }
    return result;
  }
}

export default ConstitutionValidator;
