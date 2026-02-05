const { generateId } = require('./id');

class RecipeV2 {
  constructor(data = {}) {
  this.id = data.id || generateId('recipe');
  this.version = data.version || '1.0.0';
  this.title = data.title || '';
  this.description = data.description || '';
  this.content = data.content || '';
  this.codeBlocks = Array.isArray(data.codeBlocks) ? data.codeBlocks : [];
  this.category = data.category || '';
  this.difficulty = data.difficulty || 'beginner';
  this.language = data.language || '';
  this.frameworks = Array.isArray(data.frameworks) ? data.frameworks : [];
  this.tags = Array.isArray(data.tags) ? data.tags : [];
  this.keywords = Array.isArray(data.keywords) ? data.keywords : [];
  this.relatedRecipes = Array.isArray(data.relatedRecipes) ? data.relatedRecipes : [];
  this.relatedSnippets = Array.isArray(data.relatedSnippets) ? data.relatedSnippets : [];
  this.author = data.author || '';
  this.createdAt = data.createdAt || Date.now();
  this.modifiedAt = data.modifiedAt || Date.now();
  this.status = data.status || 'draft';
  this.references = Array.isArray(data.references) ? data.references : [];
  this.viewCount = data.viewCount || 0;
  this.usageCount = data.usageCount || 0;
  this.userRating = data.userRating || 0;
  }

  isValid() {
  return !!(this.id && this.title && this.language && this.category);
  }

  validate() {
  if (!this.id) return 'Recipe id is required';
  if (!this.title) return 'Recipe title is required';
  if (!this.language) return 'Recipe language is required';
  if (!this.category) return 'Recipe category is required';

  return null;
  }

  update(updates = {}) {
  Object.assign(this, updates);
  if (updates.codeBlocks && !Array.isArray(updates.codeBlocks)) {
    this.codeBlocks = [];
  }
  this.modifiedAt = Date.now();
  return this;
  }

  addTag(tag) {
  if (tag && !this.tags.includes(tag)) {
    this.tags.push(tag);
    this.modifiedAt = Date.now();
  }
  return this;
  }

  addKeyword(keyword) {
  if (keyword && !this.keywords.includes(keyword)) {
    this.keywords.push(keyword);
    this.modifiedAt = Date.now();
  }
  return this;
  }

  recordView(count = 1) {
  this.viewCount += Math.max(0, count);
  this.modifiedAt = Date.now();
  return this;
  }

  recordUsage(count = 1) {
  this.usageCount += Math.max(0, count);
  this.modifiedAt = Date.now();
  return this;
  }

  setRating(rating) {
  const normalized = Math.max(0, Math.min(5, Number(rating)));
  this.userRating = Number.isNaN(normalized) ? this.userRating : normalized;
  this.modifiedAt = Date.now();
  return this;
  }

  toJSON() {
  return {
    id: this.id,
    version: this.version,
    title: this.title,
    description: this.description,
    content: this.content,
    codeBlocks: this.codeBlocks,
    category: this.category,
    difficulty: this.difficulty,
    language: this.language,
    frameworks: this.frameworks,
    tags: this.tags,
    keywords: this.keywords,
    relatedRecipes: this.relatedRecipes,
    relatedSnippets: this.relatedSnippets,
    author: this.author,
    createdAt: this.createdAt,
    modifiedAt: this.modifiedAt,
    status: this.status,
    references: this.references,
    viewCount: this.viewCount,
    usageCount: this.usageCount,
    userRating: this.userRating
  };
  }

  static fromJSON(json) {
  return new RecipeV2(json);
  }

  clone() {
  return new RecipeV2(this.toJSON());
  }
}

module.exports = RecipeV2;
