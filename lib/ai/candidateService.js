const fs = require('fs');
const path = require('path');
const Paths = require('../infrastructure/config/Paths');

class CandidateService {
  /**
   * 获取知识库目录的父目录
   * @param {string} projectRoot
   * @returns {string}
   */
  getConfiguredBaseDir(projectRoot) {
  return Paths.getProjectKnowledgePath(projectRoot);
  }

  /**
   * 获取候选内容存储路径
   * @param {string} projectRoot 
   */
  getCandidatesPath(projectRoot) {
  const baseDir = this.getConfiguredBaseDir(projectRoot);
  return path.join(baseDir, '.autosnippet', 'candidates.json');
  }

  /**
   * 确保目录存在
   */
  ensureDir(projectRoot) {
  const baseDir = this.getConfiguredBaseDir(projectRoot);
  const dir = path.join(baseDir, '.autosnippet');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  }

  /**
   * 保存候选内容
   * @param {string} projectRoot 
   * @param {string} targetName 
   * @param {Array} results 
   */
  async saveCandidates(projectRoot, targetName, results) {
  this.ensureDir(projectRoot);
  const filePath = this.getCandidatesPath(projectRoot);
  
  let candidates = {};
  if (fs.existsSync(filePath)) {
    try {
    candidates = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
    candidates = {};
    }
  }

  // 每个 Target 覆盖旧的候选
  candidates[targetName] = {
    targetName,
    scanTime: Date.now(),
    items: results.map(r => ({
    ...r,
    id: `cand_${Math.random().toString(36).substr(2, 9)}`,
    status: 'pending'
    }))
  };

  fs.writeFileSync(filePath, JSON.stringify(candidates, null, 2), 'utf8');
  }

  /**
   * 追加候选（用于 watch-create、draft 等静默场景）
   * @param {string} projectRoot
   * @param {string} targetName 虚拟 target，如 _watch、_draft、_pending
   * @param {Array} results
   * @param {string} [source] 来源标记：watch-create, draft-file, cli-clipboard, spm-scan, new-recipe
   * @param {number} [expiresInHours] 保留时长（小时），到期后自动清理
   */
  async appendCandidates(projectRoot, targetName, results, source = '', expiresInHours) {
  this.ensureDir(projectRoot);
  const filePath = this.getCandidatesPath(projectRoot);

  let candidates = {};
  if (fs.existsSync(filePath)) {
    try {
    candidates = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
    candidates = {};
    }
  }

  const expiresAt = expiresInHours != null ? Date.now() + expiresInHours * 3600000 : undefined;
  const newItems = results.map(r => ({
    ...r,
    id: `cand_${Math.random().toString(36).substr(2, 9)}`,
    status: 'pending',
    source: source || undefined,
    expiresAt: expiresAt || undefined
  }));

  if (!candidates[targetName]) {
    candidates[targetName] = { targetName, scanTime: Date.now(), items: [] };
  }
  candidates[targetName].items.push(...newItems);
  candidates[targetName].scanTime = Date.now();

  fs.writeFileSync(filePath, JSON.stringify(candidates, null, 2), 'utf8');
  }

  /** 过滤过期项并持久化，返回过滤后的 candidates */
  listCandidatesWithPrune(projectRoot) {
  const candidates = this.listCandidates(projectRoot);
  const now = Date.now();
  let changed = false;

  const filtered = {};
  for (const [targetName, group] of Object.entries(candidates)) {
    if (!group || !Array.isArray(group.items)) continue;
    const kept = group.items.filter(item => {
    const exp = item.expiresAt;
    if (exp != null && exp < now) {
      changed = true;
      return false;
    }
    return true;
    });
    if (kept.length > 0) {
    filtered[targetName] = { ...group, items: kept };
    } else if (group.items.length > 0) {
    changed = true;
    }
  }

  if (changed) {
    this.ensureDir(projectRoot);
    fs.writeFileSync(this.getCandidatesPath(projectRoot), JSON.stringify(filtered, null, 2), 'utf8');
  }
  return filtered;
  }

  /**
   * 获取所有候选
   */
  listCandidates(projectRoot) {
  const filePath = this.getCandidatesPath(projectRoot);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return {};
  }
  }

  /**
   * 移除已处理的候选
   */
  async removeCandidate(projectRoot, targetName, candidateId) {
  const filePath = this.getCandidatesPath(projectRoot);
  if (!fs.existsSync(filePath)) return;
  try {
    const candidates = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (candidates[targetName]) {
    candidates[targetName].items = candidates[targetName].items.filter(item => item.id !== candidateId);
    if (candidates[targetName].items.length === 0) {
      delete candidates[targetName];
    }
    fs.writeFileSync(filePath, JSON.stringify(candidates, null, 2), 'utf8');
    }
  } catch (e) {}
  }

  /**
   * 按 target 全部移除
   */
  async removeAllInTarget(projectRoot, targetName) {
  const filePath = this.getCandidatesPath(projectRoot);
  if (!fs.existsSync(filePath)) return;
  try {
    const candidates = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (candidates[targetName]) {
    delete candidates[targetName];
    fs.writeFileSync(filePath, JSON.stringify(candidates, null, 2), 'utf8');
    }
  } catch (e) {}
  }
}

module.exports = new CandidateService();
