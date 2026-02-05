const SnippetV2 = require('./SnippetV2');
const RecipeV2 = require('./RecipeV2');

function fromLegacySnippet(legacy = {}) {
  const id = legacy.id || legacy.identifier || legacy.snippetId;
  const title = legacy.title || legacy.name || '';
  const trigger = legacy.trigger || '';
  const completion = legacy.completion || '';
  const summary = legacy.summary || '';
  const language = legacy.language || legacy.languageShort || '';
  const category = legacy.category || '';
  const body = legacy.body || legacy.content || '';

  return new SnippetV2({
  id,
  title,
  trigger,
  completion,
  summary,
  language,
  category,
  body,
  metadata: legacy.metadata || {}
  });
}

function fromLegacyRecipe(legacy = {}) {
  const id = legacy.id || legacy.recipeId;
  const title = legacy.title || '';
  const description = legacy.description || '';
  const content = legacy.content || '';
  const language = legacy.language || '';
  const category = legacy.category || '';

  return new RecipeV2({
  id,
  title,
  description,
  content,
  language,
  category,
  tags: legacy.semanticTags || legacy.tags || [],
  keywords: legacy.keywords || []
  });
}

module.exports = {
  fromLegacySnippet,
  fromLegacyRecipe
};
