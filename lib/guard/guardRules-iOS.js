/**
 * guardRules-iOS：仅负责 iOS（objc/swift）的规则与审计
 * 统一接入在 lib/guard/guardRules.js
 */

const {
	RULES_FILENAME,
	SCHEMA_VERSION,
	DEFAULT_RULES,
	getRulesPath,
	getGuardRules,
	addOrUpdateRule
} = require('./ios/defaultRules');

const { getRulesForLanguage, runStaticCheck } = require('./ios/staticCheck');

const {
	AUDIT_DIMENSIONS,
	AUDIT_BY_LANGUAGE,
	getSupportedAuditLanguages,
	runFileAudit,
	runStaticCheckForScope,
	runObjcCategoryDuplicateInFile,
	runObjcCategoryDuplicateInTarget,
	runObjcCategoryDuplicateCheckProject
} = require('./ios/audit');

module.exports = {
	RULES_FILENAME,
	SCHEMA_VERSION,
	DEFAULT_RULES,
	getRulesPath,
	getGuardRules,
	addOrUpdateRule,
	getRulesForLanguage,
	runStaticCheck,
	runFileAudit,
	runStaticCheckForScope,
	AUDIT_BY_LANGUAGE,
	getSupportedAuditLanguages,
	AUDIT_DIMENSIONS,
	runObjcCategoryDuplicateInFile,
	runObjcCategoryDuplicateInTarget,
	runObjcCategoryDuplicateCheckProject
};
