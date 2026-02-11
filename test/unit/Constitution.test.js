import path from 'path';
import { fileURLToPath } from 'url';
import Constitution from '../../lib/core/constitution/Constitution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Constitution', () => {
  let constitution;

  beforeAll(() => {
    const configPath = path.join(__dirname, '../../config/constitution.yaml');
    constitution = new Constitution(configPath);
  });

  describe('load config', () => {
    test('should load constitution from YAML file', () => {
      expect(constitution.config).toBeDefined();
      expect(constitution.config.version).toBe('2.0');
    });

    test('should have 4 priorities', () => {
      const priorities = constitution.getPriorities();
      expect(priorities).toHaveLength(4);
      expect(priorities[0].id).toBe(1);
      expect(priorities[0].name).toBe('Data Integrity');
    });

    test('should have 5 roles', () => {
      const roles = constitution.getAllRoles();
      expect(roles).toHaveLength(6);
      const roleIds = roles.map((r) => r.id);
      expect(roleIds).toContain('cursor_agent');
      expect(roleIds).toContain('developer_admin');
    });
  });

  describe('get priority', () => {
    test('should return priority by id', () => {
      const priority = constitution.getPriority(1);
      expect(priority).toBeDefined();
      expect(priority.name).toBe('Data Integrity');
    });

    test('should return undefined for non-existent priority', () => {
      const priority = constitution.getPriority(999);
      expect(priority).toBeUndefined();
    });
  });

  describe('get role', () => {
    test('should return role by id', () => {
      const role = constitution.getRole('cursor_agent');
      expect(role).toBeDefined();
      expect(role.name).toBe('Cursor / Copilot Agent');
    });

    test('should return null for non-existent role', () => {
      const role = constitution.getRole('non_existent_role');
      expect(role).toBeUndefined();
    });
  });

  describe('get role permissions', () => {
    test('should return permissions for cursor_agent', () => {
      const permissions = constitution.getRolePermissions('cursor_agent');
      expect(Array.isArray(permissions)).toBe(true);
      expect(permissions.length).toBeGreaterThan(0);
      expect(permissions).toContain('create:candidates');
    });

    test('should return empty array for non-existent role', () => {
      const permissions = constitution.getRolePermissions('non_existent');
      expect(permissions).toEqual([]);
    });
  });

  describe('get role constraints', () => {
    test('should return constraints for cursor_agent', () => {
      const constraints = constitution.getRoleConstraints('cursor_agent');
      expect(Array.isArray(constraints)).toBe(true);
      expect(constraints.length).toBeGreaterThan(0);
    });
  });

  describe('has role', () => {
    test('should return true for existing role', () => {
      expect(constitution.hasRole('cursor_agent')).toBe(true);
    });

    test('should return false for non-existent role', () => {
      expect(constitution.hasRole('non_existent')).toBe(false);
    });
  });

  describe('toJSON', () => {
    test('should export summary in JSON format', () => {
      const json = constitution.toJSON();
      expect(json).toHaveProperty('version');
      expect(json).toHaveProperty('effectiveDate');
      expect(json).toHaveProperty('priorities');
      expect(json).toHaveProperty('roles');
      expect(json.priorities).toHaveLength(4);
      expect(json.roles).toHaveLength(6);
    });
  });

  describe('reload', () => {
    test('should reload constitution from file', () => {
      const originalVersion = constitution.config.version;
      constitution.reload();
      expect(constitution.config.version).toBe(originalVersion);
    });
  });
});
