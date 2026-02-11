import { jest } from '@jest/globals';
import { CandidateService } from '../../lib/service/candidate/CandidateService.js';
import { ValidationError, ConflictError, NotFoundError } from '../../lib/shared/errors/BaseError.js';

/* ────────────────────────────────────────────
 *  Helpers: mock factories
 * ──────────────────────────────────────────── */
function makeMockRepo() {
  return {
    create: jest.fn(async (c) => ({ ...c })),
    findById: jest.fn(async () => null),
    update: jest.fn(async (c) => c),
    findWithPagination: jest.fn(async () => ({ items: [], total: 0 })),
    search: jest.fn(async () => ({ items: [], total: 0 })),
    getStats: jest.fn(async () => ({ total: 0, byStatus: {} })),
  };
}

function makeMockAuditLogger() {
  return { log: jest.fn(async () => {}) };
}

function makeCtx(userId = 'test-user') {
  return { userId };
}

function makeValidData(overrides = {}) {
  return {
    code: 'func hello() { print("world") }',
    language: 'swift',
    category: 'Utility',
    reasoning: {
      whyStandard: 'common greeting pattern',
      sources: ['file.swift'],
      confidence: 0.9,
    },
    ...overrides,
  };
}

/* ────────────────────────────────────────────
 *  Tests
 * ──────────────────────────────────────────── */
describe('CandidateService', () => {
  let svc, repo, audit;

  beforeEach(() => {
    repo = makeMockRepo();
    audit = makeMockAuditLogger();
    svc = new CandidateService(repo, audit, null);
  });

  /* ── createCandidate ─────────────────────── */
  describe('createCandidate', () => {
    test('should create a valid candidate', async () => {
      const result = await svc.createCandidate(makeValidData(), makeCtx());

      expect(result).toBeDefined();
      expect(result.code).toBe('func hello() { print("world") }');
      expect(result.language).toBe('swift');
      expect(result.status).toBe('pending');
      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledTimes(1);
    });

    test('should reject missing code', async () => {
      await expect(
        svc.createCandidate(makeValidData({ code: '' }), makeCtx()),
      ).rejects.toThrow(ValidationError);
    });

    test('should reject missing language', async () => {
      await expect(
        svc.createCandidate(makeValidData({ language: '' }), makeCtx()),
      ).rejects.toThrow(ValidationError);
    });

    test('should accept large code (no size limit in validation)', async () => {
      const result = await svc.createCandidate(
        makeValidData({ code: 'x'.repeat(51000) }),
        makeCtx(),
      );
      expect(result).toBeDefined();
    });

    test('should reject reasoning without whyStandard', async () => {
      await expect(
        svc.createCandidate(
          makeValidData({ reasoning: { sources: [], confidence: 0.5 } }),
          makeCtx(),
        ),
      ).rejects.toThrow(ValidationError);
    });

    test('should reject candidate without reasoning', async () => {
      const data = makeValidData();
      delete data.reasoning;
      await expect(
        svc.createCandidate(data, makeCtx()),
      ).rejects.toThrow(ValidationError);
    });
  });

  /* ── approveCandidate ────────────────────── */
  describe('approveCandidate', () => {
    test('should approve a pending candidate', async () => {
      repo.findById.mockResolvedValue({
        id: 'c-1',
        status: 'pending',
        approve: jest.fn(() => ({ success: true })),
      });
      repo.update.mockResolvedValue({ id: 'c-1', status: 'approved' });

      const result = await svc.approveCandidate('c-1', makeCtx());
      expect(result.status).toBe('approved');
      expect(audit.log).toHaveBeenCalled();
    });

    test('should throw NotFoundError for non-existent candidate', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        svc.approveCandidate('non-existent', makeCtx()),
      ).rejects.toThrow(NotFoundError);
    });

    test('should throw ConflictError for already rejected candidate', async () => {
      repo.findById.mockResolvedValue({
        id: 'c-2',
        status: 'rejected',
      });

      await expect(
        svc.approveCandidate('c-2', makeCtx()),
      ).rejects.toThrow(ConflictError);
    });
  });

  /* ── rejectCandidate ─────────────────────── */
  describe('rejectCandidate', () => {
    test('should reject a pending candidate with reason', async () => {
      repo.findById.mockResolvedValue({
        id: 'c-3',
        status: 'pending',
        reject: jest.fn(() => ({ success: true })),
      });
      repo.update.mockResolvedValue({ id: 'c-3', status: 'rejected' });

      const result = await svc.rejectCandidate('c-3', 'low quality', makeCtx());
      expect(result.status).toBe('rejected');
    });

    test('should throw ValidationError if reason is empty', async () => {
      repo.findById.mockResolvedValue({ id: 'c-4', status: 'pending' });

      await expect(
        svc.rejectCandidate('c-4', '', makeCtx()),
      ).rejects.toThrow(ValidationError);
    });
  });

  /* ── applyToRecipe ───────────────────────── */
  describe('applyToRecipe', () => {
    test('should apply an approved candidate to recipe', async () => {
      repo.findById.mockResolvedValue({
        id: 'c-5',
        status: 'approved',
        applyToRecipe: jest.fn(() => ({ success: true })),
      });
      repo.update.mockResolvedValue({ id: 'c-5', status: 'applied', appliedRecipeId: 'r-1' });

      const result = await svc.applyToRecipe('c-5', 'r-1', makeCtx());
      expect(result.status).toBe('applied');
    });

    test('should throw ConflictError for pending candidate', async () => {
      repo.findById.mockResolvedValue({
        id: 'c-6',
        status: 'pending',
      });

      await expect(
        svc.applyToRecipe('c-6', 'r-1', makeCtx()),
      ).rejects.toThrow(ConflictError);
    });
  });

  /* ── listCandidates ──────────────────────── */
  describe('listCandidates', () => {
    test('should delegate to repo with filters', async () => {
      repo.findWithPagination.mockResolvedValue({
        items: [{ id: 'c-7' }],
        total: 1,
      });

      const result = await svc.listCandidates({ status: 'pending' }, { page: 1, limit: 10 });
      expect(result.total).toBe(1);
      expect(repo.findWithPagination).toHaveBeenCalled();
    });
  });

  /* ── searchCandidates ────────────────────── */
  describe('searchCandidates', () => {
    test('should delegate keyword search to repo', async () => {
      repo.search.mockResolvedValue({ items: [], total: 0 });

      const result = await svc.searchCandidates('hello', { page: 1 });
      expect(result.total).toBe(0);
      expect(repo.search).toHaveBeenCalledWith('hello', expect.any(Object));
    });
  });

  /* ── getCandidateStats ───────────────────── */
  describe('getCandidateStats', () => {
    test('should return stats from repo', async () => {
      repo.getStats.mockResolvedValue({ total: 42, byStatus: { pending: 10 } });

      const stats = await svc.getCandidateStats();
      expect(stats.total).toBe(42);
    });
  });
});
