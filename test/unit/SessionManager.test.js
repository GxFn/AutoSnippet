import path from 'path';
import { fileURLToPath } from 'url';
import DatabaseConnection from '../../lib/infrastructure/database/DatabaseConnection.js';
import SessionManager from '../../lib/core/session/SessionManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('SessionManager', () => {
  let db;
  let sessionManager;

  beforeAll(async () => {
    const dbPath = path.join(__dirname, '../../data/test-session.db');
    db = new DatabaseConnection({ path: dbPath });
    await db.connect();
    await db.runMigrations();
    sessionManager = new SessionManager(db);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('create', () => {
    test('should create project scope session', () => {
      const session = sessionManager.create({
        scope: 'project',
        scopeId: '/path/to/project',
        actor: 'cursor_agent',
        metadata: { projectName: 'MyProject' },
      });

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.scope).toBe('project');
      expect(session.scope_id).toBe('/path/to/project');
      expect(session.expired_at).toBeDefined();
    });

    test('should create target scope session', () => {
      const session = sessionManager.create({
        scope: 'target',
        scopeId: 'npm',
      });

      expect(session.scope).toBe('target');
    });

    test('should create file scope session', () => {
      const session = sessionManager.create({
        scope: 'file',
        scopeId: '/path/to/file.js',
      });

      expect(session.scope).toBe('file');
    });

    test('should create developer scope session', () => {
      const session = sessionManager.create({
        scope: 'developer',
        scopeId: 'user123',
      });

      expect(session.scope).toBe('developer');
    });
  });

  describe('get', () => {
    test('should retrieve created session', () => {
      const created = sessionManager.create({
        scope: 'project',
        scopeId: '/project1',
      });

      const retrieved = sessionManager.get(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.scope).toBe('project');
    });

    test('should return null for non-existent session', () => {
      const session = sessionManager.get('non_existent_id');
      expect(session).toBeNull();
    });
  });

  describe('findByScope', () => {
    test('should find session by scope', () => {
      sessionManager.create({
        scope: 'target',
        scopeId: 'react',
      });

      const found = sessionManager.findByScope('target', 'react');
      expect(found).toBeDefined();
      expect(found.scope).toBe('target');
      expect(found.scope_id).toBe('react');
    });
  });

  describe('updateMetadata', () => {
    test('should update session metadata', () => {
      const session = sessionManager.create({
        scope: 'project',
        scopeId: '/project2',
        metadata: { version: 1 },
      });

      sessionManager.updateMetadata(session.id, { version: 2, status: 'active' });

      const updated = sessionManager.get(session.id);
      const metadata = JSON.parse(updated.metadata);
      expect(metadata.version).toBe(2);
      expect(metadata.status).toBe('active');
    });
  });

  describe('close', () => {
    test('should close session', () => {
      const session = sessionManager.create({
        scope: 'file',
        scopeId: '/file.js',
      });

      sessionManager.close(session.id);

      const retrieved = sessionManager.get(session.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('expiration', () => {
    test('project sessions should have 7-day expiration', () => {
      const session = sessionManager.create({
        scope: 'project',
        scopeId: '/project3',
      });

      const expiryTime = session.expired_at * 1000;
      const now = Date.now();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

      expect(expiryTime - now).toBeGreaterThan(sevenDaysMs - 1000);
      expect(expiryTime - now).toBeLessThan(sevenDaysMs + 1000);
    });

    test('file sessions should have 1-hour expiration', () => {
      const session = sessionManager.create({
        scope: 'file',
        scopeId: '/file2.js',
      });

      const expiryTime = session.expired_at * 1000;
      const now = Date.now();
      const oneHourMs = 60 * 60 * 1000;

      expect(expiryTime - now).toBeGreaterThan(oneHourMs - 1000);
      expect(expiryTime - now).toBeLessThan(oneHourMs + 1000);
    });
  });

  describe('getActiveCount', () => {
    test('should count active sessions', () => {
      const count1 = sessionManager.getActiveCount();

      sessionManager.create({
        scope: 'project',
        scopeId: '/project4',
      });

      const count2 = sessionManager.getActiveCount();
      expect(count2).toBeGreaterThan(count1);
    });
  });

  describe('getActiveSessions', () => {
    test('should return all active sessions', () => {
      sessionManager.create({
        scope: 'project',
        scopeId: '/project5',
      });

      const sessions = sessionManager.getActiveSessions();
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions.length).toBeGreaterThan(0);
    });

    test('should respect limit parameter', () => {
      const sessions = sessionManager.getActiveSessions(1);
      expect(sessions.length).toBeLessThanOrEqual(1);
    });
  });

  describe('cleanupExpired', () => {
    test('should have cleanup method', () => {
      expect(typeof sessionManager.cleanupExpired).toBe('function');
      // 这个测试主要验证方法存在，实际清理需要时间推进
      sessionManager.cleanupExpired();
    });
  });
});
