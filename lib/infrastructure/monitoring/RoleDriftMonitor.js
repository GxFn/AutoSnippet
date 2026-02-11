/**
 * RoleDriftMonitor - 角色漂移检测系统
 * 
 * 功能：
 * - 监控 AI 角色切换行为
 * - 检测非法角色转移
 * - 记录漂移事件供审计
 * - 提供角色稳定性评分
 */

import Logger from '../logging/Logger.js';

/**
 * 角色转移矩阵
 * 定义每个角色允许转移到哪些角色
 */
const ALLOWED_TRANSITIONS = {
  cursor_agent: ['cursor_agent'],
  asd_ais: ['asd_ais'],
  guard_engine: ['guard_engine'],
  developer_admin: ['developer_admin', 'developer_contributor'],
  developer_contributor: ['developer_contributor'],
};

/**
 * 角色能力边界
 * 每个角色可以执行的 action 前缀
 */
const ROLE_CAPABILITIES = {
  cursor_agent: ['candidate:create', 'candidate:list', 'candidate:search', 'recipe:list', 'recipe:search', 'recipe:get', 'recipe:guard_check', 'search:query'],
  asd_ais: ['candidate:create', 'candidate:list', 'candidate:search', 'recipe:list', 'recipe:search', 'search:query'],
  guard_engine: ['recipe:guard_check', 'recipe:list', 'recipe:get'],
  developer_admin: ['*'],
  developer_contributor: ['candidate:create', 'candidate:list', 'candidate:approve', 'candidate:reject', 'recipe:create', 'recipe:list', 'recipe:search', 'recipe:publish', 'recipe:guard_create', 'search:query'],
};

export class RoleDriftMonitor {
  constructor(db) {
    this.db = typeof db?.getDb === 'function' ? db.getDb() : db;
    this.logger = Logger.getInstance();
    this.sessionRoles = new Map(); // sessionId → { currentRole, history[], driftCount }
    this._ensureTable();
  }

  _ensureTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS role_drift_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        from_role TEXT,
        to_role TEXT,
        action_attempted TEXT,
        drift_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'warning',
        details_json TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_drift_session ON role_drift_events(session_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_drift_actor ON role_drift_events(actor)`);
  }

  /**
   * 检查角色行为是否合法
   * @param {string} actor - 角色 ID
   * @param {string} action - 尝试执行的操作
   * @param {string} sessionId - 会话 ID
   * @returns {{ allowed: boolean, drift?: object }}
   */
  checkAction(actor, action, sessionId) {
    // 获取角色能力
    const capabilities = ROLE_CAPABILITIES[actor];
    if (!capabilities) {
      const drift = this._recordDrift(sessionId, actor, null, null, action, 'unknown_role', 'error');
      return { allowed: false, drift };
    }

    // 通配符 (admin)
    if (capabilities.includes('*')) {
      return { allowed: true };
    }

    // 检查 action 是否在角色能力范围内
    const isAllowed = capabilities.some(cap => {
      if (cap === action) return true;
      // 前缀匹配: 'candidate:*' 匹配 'candidate:create'
      if (cap.endsWith(':*')) {
        return action.startsWith(cap.slice(0, -1));
      }
      return false;
    });

    if (!isAllowed) {
      const drift = this._recordDrift(
        sessionId, actor, actor, actor, action,
        'capability_violation', 'warning'
      );
      return { allowed: false, drift };
    }

    return { allowed: true };
  }

  /**
   * 检查角色转移是否合法
   * @param {string} sessionId - 会话 ID
   * @param {string} currentRole - 当前角色
   * @param {string} nextRole - 目标角色
   * @returns {{ allowed: boolean, drift?: object }}
   */
  checkRoleTransition(sessionId, currentRole, nextRole) {
    if (currentRole === nextRole) return { allowed: true };

    const allowed = ALLOWED_TRANSITIONS[currentRole];
    if (!allowed || !allowed.includes(nextRole)) {
      const drift = this._recordDrift(
        sessionId, currentRole, currentRole, nextRole, null,
        'illegal_transition', 'error'
      );
      return { allowed: false, drift };
    }

    return { allowed: true };
  }

  /**
   * 获取会话的漂移统计
   */
  getSessionDriftStats(sessionId) {
    const events = this.db.prepare(
      `SELECT drift_type, severity, COUNT(*) as count FROM role_drift_events WHERE session_id = ? GROUP BY drift_type, severity`
    ).all(sessionId);

    const total = events.reduce((sum, e) => sum + e.count, 0);
    const errorCount = events.filter(e => e.severity === 'error').reduce((s, e) => s + e.count, 0);

    return {
      sessionId,
      totalDrifts: total,
      errorDrifts: errorCount,
      warningDrifts: total - errorCount,
      stability: total === 0 ? 1.0 : Math.max(0, 1 - total * 0.1),
      byType: events,
    };
  }

  /**
   * 获取全局漂移统计
   */
  getGlobalStats(since = null) {
    const params = [];
    let where = '1=1';
    if (since) {
      where = 'created_at >= ?';
      params.push(since);
    }

    const stats = this.db.prepare(`
      SELECT 
        actor,
        drift_type,
        severity,
        COUNT(*) as count
      FROM role_drift_events 
      WHERE ${where}
      GROUP BY actor, drift_type, severity
      ORDER BY count DESC
    `).all(...params);

    const total = this.db.prepare(
      `SELECT COUNT(*) as total FROM role_drift_events WHERE ${where}`
    ).get(...params);

    return {
      totalDrifts: total.total,
      byActor: stats,
    };
  }

  /**
   * 获取最近的漂移事件
   */
  getRecentDrifts(limit = 20) {
    const rows = this.db.prepare(
      `SELECT * FROM role_drift_events ORDER BY created_at DESC LIMIT ?`
    ).all(limit);

    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      actor: r.actor,
      fromRole: r.from_role,
      toRole: r.to_role,
      actionAttempted: r.action_attempted,
      driftType: r.drift_type,
      severity: r.severity,
      details: JSON.parse(r.details_json || '{}'),
      createdAt: r.created_at,
    }));
  }

  // ========== Private ==========

  _recordDrift(sessionId, actor, fromRole, toRole, action, driftType, severity) {
    const now = Math.floor(Date.now() / 1000);
    const details = { timestamp: now };

    this.db.prepare(`
      INSERT INTO role_drift_events (session_id, actor, from_role, to_role, action_attempted, drift_type, severity, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId || 'unknown', actor, fromRole, toRole, action, driftType, severity, JSON.stringify(details), now);

    this.logger.warn('Role drift detected', {
      sessionId, actor, fromRole, toRole, action, driftType, severity,
    });

    return { driftType, severity, actor, fromRole, toRole, action };
  }
}

/**
 * Gateway 插件：角色漂移检测
 */
export function createRoleDriftPlugin(roleDriftMonitor) {
  return {
    name: 'RoleDriftPlugin',
    async pre(context) {
      // Monitor-only: log drift events but don't block
      // Authorization is handled by PermissionManager
      const result = roleDriftMonitor.checkAction(
        context.actor,
        context.action,
        context.session || 'default'
      );
      if (!result.allowed && result.drift) {
        // 仅记录漂移事件，不阻断请求
        roleDriftMonitor.logger.warn('Role drift detected', {
          actor: context.actor,
          action: context.action,
          driftType: result.drift.driftType,
        });
      }
    },
  };
}

let instance = null;

export function initRoleDriftMonitor(db) {
  instance = new RoleDriftMonitor(db);
  return instance;
}

export function getRoleDriftMonitor() {
  return instance;
}

export default RoleDriftMonitor;
