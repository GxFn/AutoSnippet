const { GuardRuleV2 } = require('../../../lib/domain/entities/v2');

class GuardRuleMigrator {
  async migrateOne(legacy = {}) {
    const rule = new GuardRuleV2({
      id: legacy.id || legacy.ruleId,
      title: legacy.title || legacy.name || '',
      description: legacy.description || '',
      category: legacy.category || 'general',
      severity: legacy.severity || 'warning',
      languages: legacy.languages || (legacy.language ? [legacy.language] : []),
      scope: legacy.scope || 'file',
      pattern: legacy.pattern || legacy.regex || '',
      message: legacy.message || legacy.tip || '',
      enabled: legacy.enabled !== false,
      autoFix: legacy.autoFix || { enabled: false, strategy: '' },
      excludePaths: legacy.excludePaths || [],
      suppressRules: legacy.suppressRules || [],
      status: legacy.status || 'active',
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt
    });

    const validationError = rule.validate();
    if (validationError) {
      throw new Error(validationError);
    }

    return rule;
  }
}

module.exports = GuardRuleMigrator;
