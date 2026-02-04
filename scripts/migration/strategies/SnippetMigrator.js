const { fromLegacySnippet } = require('../../../lib/domain/entities/v2');

class SnippetMigrator {
  async migrateOne(legacy) {
    const snippet = fromLegacySnippet(legacy);

    if (legacy.createdAt) snippet.createdAt = legacy.createdAt;
    if (legacy.updatedAt) snippet.modifiedAt = legacy.updatedAt;
    if (legacy.tags) snippet.tags = Array.isArray(legacy.tags) ? legacy.tags : [];
    if (legacy.relatedSnippets) snippet.relatedSnippets = legacy.relatedSnippets;

    const validationError = snippet.validate();
    if (validationError) {
      throw new Error(validationError);
    }

    return snippet;
  }
}

module.exports = SnippetMigrator;
