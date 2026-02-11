import { jest } from '@jest/globals';
import { RecipeService } from '../../lib/service/recipe/RecipeService.js';
import { ValidationError, NotFoundError, ConflictError } from '../../lib/shared/errors/BaseError.js';

/* ────────────────────────────────────────────
 *  Helpers: mock factories
 * ──────────────────────────────────────────── */
function makeMockRepo() {
  return {
    create: jest.fn(async (r) => ({ ...r })),
    findById: jest.fn(async () => null),
    update: jest.fn(async (_id, fields) => ({ id: _id, ...fields })),
    delete: jest.fn(async () => true),
    findByKind: jest.fn(async () => ({ items: [], total: 0 })),
    findWithPagination: jest.fn(async () => ({ items: [], total: 0 })),
    search: jest.fn(async () => ({ items: [], total: 0 })),
    getRecommendations: jest.fn(async () => []),
    getStats: jest.fn(async () => ({ total: 0 })),
  };
}

function makeMockAuditLogger() {
  return { log: jest.fn(async () => {}) };
}

function makeMockFileWriter() {
  return {
    persistRecipe: jest.fn(() => {}),
    removeRecipe: jest.fn(() => {}),
  };
}

function makeCtx(userId = 'test-user') {
  return { userId };
}

function makeValidRecipeData(overrides = {}) {
  return {
    title: 'iOS URLSession 标准配置',
    description: 'Standard URLSession configuration',
    language: 'swift',
    category: 'Network',
    content: {
      pattern: 'let session = URLSession(configuration: .default)',
    },
    ...overrides,
  };
}

/**
 * Build a mock recipe entity returned by repo.findById
 * with domain-like methods (publish, deprecate, etc.)
 */
function makeMockRecipeEntity(overrides = {}) {
  const base = {
    id: 'r-1',
    title: 'Test Recipe',
    status: 'draft',
    quality: { codeCompleteness: 0, projectAdaptation: 0, documentationClarity: 0, overall: 0 },
    statistics: { adoptionCount: 0, applicationCount: 0, guardHitCount: 0, viewCount: 0, successCount: 0, feedbackScore: 0 },
    relations: {},
    ...overrides,
  };

  base.publish = jest.fn((userId) => {
    if (base.status !== 'draft') return { success: false, error: 'Not in draft' };
    base.status = 'active';
    base.publishedBy = userId;
    base.publishedAt = Math.floor(Date.now() / 1000);
    return { success: true };
  });

  base.deprecate = jest.fn((reason) => {
    base.status = 'deprecated';
    base.deprecation = { reason, deprecatedAt: Math.floor(Date.now() / 1000) };
  });

  base.updateQuality = jest.fn((metrics) => {
    Object.assign(base.quality, metrics);
    base.quality.overall = (
      (base.quality.codeCompleteness || 0) +
      (base.quality.projectAdaptation || 0) +
      (base.quality.documentationClarity || 0)
    ) / 3;
  });

  base.incrementUsage = jest.fn((type) => {
    if (type === 'application') base.statistics.applicationCount++;
    else base.statistics.adoptionCount++;
  });

  return base;
}

/* ────────────────────────────────────────────
 *  Tests
 * ──────────────────────────────────────────── */
describe('RecipeService', () => {
  let svc, repo, audit, fileWriter;

  beforeEach(() => {
    repo = makeMockRepo();
    audit = makeMockAuditLogger();
    fileWriter = makeMockFileWriter();
    // knowledgeGraphService = null → _syncRelationsToGraph/removeAllEdges → early return
    svc = new RecipeService(repo, audit, null, null, { fileWriter });
  });

  /* ── createRecipe ────────────────────────── */
  describe('createRecipe', () => {
    test('should create a valid recipe in draft status', async () => {
      const result = await svc.createRecipe(makeValidRecipeData(), makeCtx());

      expect(result).toBeDefined();
      expect(result.title).toBe('iOS URLSession 标准配置');
      expect(result.language).toBe('swift');
      expect(result.status).toBe('draft');
      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledTimes(1);
    });

    test('should persist to file via fileWriter', async () => {
      await svc.createRecipe(makeValidRecipeData(), makeCtx());
      expect(fileWriter.persistRecipe).toHaveBeenCalledTimes(1);
    });

    test('should reject missing title', async () => {
      await expect(
        svc.createRecipe(makeValidRecipeData({ title: '' }), makeCtx()),
      ).rejects.toThrow(ValidationError);
    });

    test('should reject missing language', async () => {
      await expect(
        svc.createRecipe(makeValidRecipeData({ language: '' }), makeCtx()),
      ).rejects.toThrow(ValidationError);
    });

    test('should reject missing category', async () => {
      await expect(
        svc.createRecipe(makeValidRecipeData({ category: '' }), makeCtx()),
      ).rejects.toThrow(ValidationError);
    });

    test('should reject empty content', async () => {
      await expect(
        svc.createRecipe(makeValidRecipeData({ content: {} }), makeCtx()),
      ).rejects.toThrow(ValidationError);
    });

    test('should work without fileWriter', async () => {
      const svcNoWriter = new RecipeService(repo, audit, null, null);
      const result = await svcNoWriter.createRecipe(makeValidRecipeData(), makeCtx());
      expect(result).toBeDefined();
    });
  });

  /* ── publishRecipe ───────────────────────── */
  describe('publishRecipe', () => {
    test('should publish a draft recipe', async () => {
      const mockRecipe = makeMockRecipeEntity({ id: 'r-1', status: 'draft' });
      repo.findById.mockResolvedValue(mockRecipe);
      repo.update.mockResolvedValue({ id: 'r-1', status: 'active' });

      const result = await svc.publishRecipe('r-1', makeCtx());
      expect(result.status).toBe('active');
      expect(mockRecipe.publish).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalled();
    });

    test('should throw NotFoundError for non-existent recipe', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        svc.publishRecipe('non-existent', makeCtx()),
      ).rejects.toThrow(NotFoundError);
    });

    test('should throw ConflictError for already active recipe', async () => {
      const mockRecipe = makeMockRecipeEntity({ id: 'r-2', status: 'active' });
      repo.findById.mockResolvedValue(mockRecipe);

      await expect(
        svc.publishRecipe('r-2', makeCtx()),
      ).rejects.toThrow(ConflictError);
    });
  });

  /* ── deprecateRecipe ─────────────────────── */
  describe('deprecateRecipe', () => {
    test('should deprecate an active recipe', async () => {
      const mockRecipe = makeMockRecipeEntity({ id: 'r-3', status: 'active' });
      repo.findById.mockResolvedValue(mockRecipe);
      repo.update.mockResolvedValue({ id: 'r-3', status: 'deprecated' });

      const result = await svc.deprecateRecipe('r-3', 'outdated', makeCtx());
      expect(result.status).toBe('deprecated');
      expect(mockRecipe.deprecate).toHaveBeenCalledWith('outdated');
    });

    test('should throw ConflictError for non-active recipe', async () => {
      const mockRecipe = makeMockRecipeEntity({ id: 'r-4', status: 'draft' });
      repo.findById.mockResolvedValue(mockRecipe);

      await expect(
        svc.deprecateRecipe('r-4', 'reason', makeCtx()),
      ).rejects.toThrow(ConflictError);
    });

    test('should throw ValidationError without reason', async () => {
      const mockRecipe = makeMockRecipeEntity({ id: 'r-4', status: 'active' });
      repo.findById.mockResolvedValue(mockRecipe);

      await expect(
        svc.deprecateRecipe('r-4', '', makeCtx()),
      ).rejects.toThrow(ValidationError);
    });
  });

  /* ── updateQuality ───────────────────────── */
  describe('updateQuality', () => {
    test('should update quality metrics in [0,1] range', async () => {
      const mockRecipe = makeMockRecipeEntity({ id: 'r-5', status: 'active' });
      repo.findById.mockResolvedValue(mockRecipe);
      repo.update.mockImplementation(async (_id, fields) => ({ id: _id, ...fields }));

      const result = await svc.updateQuality(
        'r-5',
        { codeCompleteness: 0.9, projectAdaptation: 0.85 },
        makeCtx(),
      );
      expect(result).toBeDefined();
      expect(mockRecipe.updateQuality).toHaveBeenCalled();
    });

    test('should throw ValidationError for out-of-range metrics', async () => {
      const mockRecipe = makeMockRecipeEntity({ id: 'r-6', status: 'active' });
      repo.findById.mockResolvedValue(mockRecipe);

      await expect(
        svc.updateQuality('r-6', { codeCompleteness: 1.5 }, makeCtx()),
      ).rejects.toThrow(ValidationError);
    });
  });

  /* ── deleteRecipe ────────────────────────── */
  describe('deleteRecipe', () => {
    test('should delete recipe, file, and graph edges', async () => {
      const mockRecipe = makeMockRecipeEntity({
        id: 'r-7',
        status: 'draft',
        source_file: '/tmp/test.md',
      });
      repo.findById.mockResolvedValue(mockRecipe);

      await svc.deleteRecipe('r-7', makeCtx());

      expect(fileWriter.removeRecipe).toHaveBeenCalledWith(mockRecipe);
      expect(repo.delete).toHaveBeenCalledWith('r-7');
      expect(audit.log).toHaveBeenCalled();
    });

    test('should throw NotFoundError for non-existent recipe', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        svc.deleteRecipe('non-existent', makeCtx()),
      ).rejects.toThrow(NotFoundError);
    });
  });

  /* ── incrementUsage ──────────────────────── */
  describe('incrementUsage', () => {
    test('should increment adoption count', async () => {
      const mockRecipe = makeMockRecipeEntity({ id: 'r-8', status: 'active' });
      repo.findById.mockResolvedValue(mockRecipe);
      repo.update.mockImplementation(async (_id, fields) => ({ id: _id, ...fields }));

      const result = await svc.incrementUsage('r-8', 'adoption');
      expect(result).toBeDefined();
      expect(mockRecipe.incrementUsage).toHaveBeenCalledWith('adoption');
    });

    test('should throw NotFoundError for missing recipe', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(svc.incrementUsage('non-existent')).rejects.toThrow(NotFoundError);
    });
  });

  /* ── listRecipes ─────────────────────────── */
  describe('listRecipes', () => {
    test('should delegate to repo with filters', async () => {
      repo.findWithPagination.mockResolvedValue({ items: [{ id: 'r-9' }], total: 1 });

      const result = await svc.listRecipes({ language: 'swift' });
      expect(result.total).toBe(1);
      expect(repo.findWithPagination).toHaveBeenCalled();
    });
  });

  /* ── searchRecipes ───────────────────────── */
  describe('searchRecipes', () => {
    test('should delegate keyword search to repo', async () => {
      repo.search.mockResolvedValue({ items: [], total: 0 });

      const result = await svc.searchRecipes('URLSession');
      expect(result.total).toBe(0);
      expect(repo.search).toHaveBeenCalledWith('URLSession', expect.any(Object));
    });
  });

  /* ── getRecipe ───────────────────────────── */
  describe('getRecipe', () => {
    test('should return recipe by id', async () => {
      repo.findById.mockResolvedValue({ id: 'r-10', title: 'Test' });

      const recipe = await svc.getRecipe('r-10');
      expect(recipe.title).toBe('Test');
    });

    test('should throw NotFoundError for missing recipe', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(svc.getRecipe('non-existent')).rejects.toThrow(NotFoundError);
    });
  });

  /* ── getRecipeStats ──────────────────────── */
  describe('getRecipeStats', () => {
    test('should return stats from repo', async () => {
      repo.getStats.mockResolvedValue({ total: 100, byKind: {} });

      const stats = await svc.getRecipeStats();
      expect(stats.total).toBe(100);
    });
  });
});
