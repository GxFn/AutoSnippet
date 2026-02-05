const { fromLegacyRecipe } = require('../../../lib/domain/entities/v2');

class RecipeMigrator {
  async migrateOne(legacy) {
  const recipe = fromLegacyRecipe(legacy);

  if (legacy.createdAt) recipe.createdAt = legacy.createdAt;
  if (legacy.updatedAt) recipe.modifiedAt = legacy.updatedAt;
  if (legacy.status) recipe.status = legacy.status;
  if (legacy.frameworks) recipe.frameworks = legacy.frameworks;
  if (legacy.keywords) recipe.keywords = legacy.keywords;

  const validationError = recipe.validate();
  if (validationError) {
    throw new Error(validationError);
  }

  return recipe;
  }
}

module.exports = RecipeMigrator;
