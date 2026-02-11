/**
 * Domain 层索引
 * 导出所有实体、值对象和仓储接口
 */

// Candidate 相关
export { Candidate } from './candidate/Candidate.js';
export { default as Reasoning } from './candidate/Reasoning.js';
export { CandidateStatus, isValidCandidateStatus, isValidStateTransition } from './types/CandidateStatus.js';
export { default as CandidateRepository } from './candidate/CandidateRepository.js';

// Recipe 相关（统一知识实体）
export {
  Recipe, RecipeStatus, KnowledgeType, Complexity,
  RelationType, Kind, inferKind,
} from './recipe/Recipe.js';
export { default as RecipeRepository } from './recipe/RecipeRepository.js';

// Snippet 相关
export { Snippet } from './snippet/Snippet.js';
