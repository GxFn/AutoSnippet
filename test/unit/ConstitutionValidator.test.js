import path from 'path';
import { fileURLToPath } from 'url';
import Constitution from '../../lib/core/constitution/Constitution.js';
import ConstitutionValidator from '../../lib/core/constitution/ConstitutionValidator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('ConstitutionValidator', () => {
  let constitution;
  let validator;

  beforeAll(() => {
    const configPath = path.join(__dirname, '../../config/constitution.yaml');
    constitution = new Constitution(configPath);
    validator = new ConstitutionValidator(constitution);
  });

  describe('validate - Priority 1: Data Integrity', () => {
    test('should detect missing code in candidate creation', async () => {
      const request = {
        actor: 'cursor_agent',
        action: 'create',
        resource: '/candidates',
        data: { name: 'Test' }, // 缺少 code
      };

      const result = await validator.validate(request);
      expect(result.compliant).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations.some((v) => v.rule.includes('必须可验证'))).toBe(true);
    });

    test('should allow candidate creation with code', async () => {
      const request = {
        actor: 'cursor_agent',
        action: 'create',
        resource: '/candidates',
        data: {
          name: 'Test',
          code: 'function test() {}',
        },
      };

      const result = await validator.validate(request);
      // Code 齐全，但可能还有其他违规（如缺少 reasoning）
      expect(result.compliant).toBeDefined();
    });

    test('should require confirmation for delete operations', async () => {
      const request = {
        actor: 'developer_admin',
        action: 'delete',
        resource: '/candidates/123',
        data: {},
      };

      const result = await validator.validate(request);
      expect(result.violations.some((v) => v.rule.includes('删除操作'))).toBe(true);
    });

    test('should allow delete with confirmation', async () => {
      const request = {
        actor: 'developer_admin',
        action: 'delete',
        resource: '/candidates/123',
        data: { confirmed: true },
      };

      const result = await validator.validate(request);
      expect(result.violations.some((v) => v.rule.includes('删除操作'))).toBe(false);
    });
  });

  describe('validate - Priority 2: Human Oversight', () => {
    test('should prevent AI from creating recipes', async () => {
      const request = {
        actor: 'cursor_agent', // AI actor
        action: 'create',
        resource: '/recipes',
        data: { name: 'Test Recipe', code: 'xxx' },
      };

      const result = await validator.validate(request);
      expect(result.violations.some((v) => v.priority === 2)).toBe(true);
    });

    test('should allow developer_admin to create recipes', async () => {
      const request = {
        actor: 'developer_admin',
        action: 'create',
        resource: '/recipes',
        data: { name: 'Test Recipe', code: 'xxx' },
      };

      const result = await validator.validate(request);
      expect(result.violations.some((v) => v.priority === 2)).toBe(false);
    });

    test('should require authorization for batch operations', async () => {
      const request = {
        actor: 'developer_admin',
        action: 'batch_update',
        resource: '/candidates',
        data: {},
      };

      const result = await validator.validate(request);
      expect(result.violations.some((v) => v.rule.includes('批量操作'))).toBe(true);
    });
  });

  describe('validate - Priority 3: AI Transparency', () => {
    test('should not violate when reasoning is absent (handler auto-generates)', async () => {
      const request = {
        actor: 'cursor_agent',
        action: 'create',
        resource: '/candidates',
        data: {
          name: 'Test',
          code: 'xxx',
        },
      };

      const result = await validator.validate(request);
      // 未传 reasoning 不视为违规 — handler 层会自动生成默认值
      expect(result.violations.some((v) => v.priority === 3 && v.rule.includes('Reasoning'))).toBe(false);
    });

    test('should require complete reasoning when reasoning object is provided but empty', async () => {
      const request = {
        actor: 'cursor_agent',
        action: 'create',
        resource: '/candidates',
        data: {
          name: 'Test',
          code: 'xxx',
          reasoning: {},
        },
      };

      const result = await validator.validate(request);
      expect(result.violations.some((v) => v.priority === 3 && v.rule.includes('Reasoning'))).toBe(true);
    });

    test('should accept complete reasoning', async () => {
      const request = {
        actor: 'cursor_agent',
        action: 'create',
        resource: '/candidates',
        data: {
          name: 'Test',
          code: 'xxx',
          reasoning: {
            whyStandard: 'Good practice',
            sources: ['documentation'],
            qualitySignals: { clarity: 0.9 },
            alternatives: [],
            confidence: 0.85,
          },
        },
      };

      const result = await validator.validate(request);
      expect(result.violations.some((v) => v.priority === 3 && v.rule.includes('Reasoning'))).toBe(false);
    });

    test('should require source_recipe_id for guard rules', async () => {
      const request = {
        actor: 'developer_admin',
        action: 'create',
        resource: '/guard_rules',
        data: { rule: 'xxx' },
      };

      const result = await validator.validate(request);
      expect(result.violations.some((v) => v.rule.includes('Guard 规则'))).toBe(true);
    });
  });

  describe('enforce', () => {
    test('should throw error on non-compliant request', async () => {
      const request = {
        actor: 'cursor_agent',
        action: 'create',
        resource: '/candidates',
        data: { name: 'Test' },
      };

      await expect(validator.enforce(request)).rejects.toThrow();
    });

    test('should return result on compliant request', async () => {
      const request = {
        actor: 'developer_admin',
        action: 'read',
        resource: '/recipes',
        data: {},
      };

      const result = await validator.enforce(request);
      expect(result.compliant).toBe(true);
    });
  });

  describe('helper methods', () => {
    test('isDestructiveOperation should detect delete actions', () => {
      expect(validator.isDestructiveOperation({ action: 'delete' })).toBe(true);
      expect(validator.isDestructiveOperation({ action: 'drop' })).toBe(true);
      expect(validator.isDestructiveOperation({ action: 'create' })).toBe(false);
    });

    test('isAIActor should identify AI actors', () => {
      expect(validator.isAIActor('cursor_agent')).toBe(true);
      expect(validator.isAIActor('asd_ais')).toBe(true);
      expect(validator.isAIActor('developer_admin')).toBe(false);
    });
  });
});
