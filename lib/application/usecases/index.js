/**
 * Use Cases 导出
 * 统一的 use case 入口
 */

module.exports = {
  // Recipe use cases
  SearchRecipe: require('./recipe/SearchRecipe'),

  // Snippet use cases
  CreateSnippet: require('./snippet/CreateSnippet'),

  // Injection use cases
  InjectCode: require('./injection/InjectCode'),

  // Guard use cases
  ValidateGuard: require('./guard/ValidateGuard')
};
