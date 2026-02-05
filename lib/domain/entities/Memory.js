// Memory 实体 - 代表 Agent 的记忆系统

class Memory {
  constructor(data = {}) {
  this.episodic = data.episodic || [];
  this.semantic = data.semantic || [];
  this.procedural = data.procedural || [];
  }

  addEvent(event) {
  this.episodic.push({
    ...event,
    timestamp: Date.now(),
    id: this._generateId()
  });
  return this;
  }

  addKnowledge(knowledge) {
  this.semantic.push({
    ...knowledge,
    addedAt: Date.now(),
    id: this._generateId()
  });
  return this;
  }

  getKnowledge(key) {
  return this.semantic.find(k => k.key === key) || null;
  }

  getKnowledgeByCategory(category) {
  return this.semantic.filter(k => k.category === category);
  }

  addSkill(skill) {
  this.procedural.push({
    ...skill,
    learnedAt: Date.now(),
    id: this._generateId()
  });
  return this;
  }

  getSkill(name) {
  return this.procedural.find(s => s.name === name) || null;
  }

  getRecentEvents(limit = 10) {
  return this.episodic.slice(-limit);
  }

  getEventsByType(type) {
  return this.episodic.filter(e => e.type === type);
  }

  getSkillNames() {
  return this.procedural.map(s => s.name);
  }

  clear() {
  this.episodic = [];
  this.semantic = [];
  this.procedural = [];
  return this;
  }

  clearEpisodic() {
  this.episodic = [];
  return this;
  }

  clearSemantic() {
  this.semantic = [];
  return this;
  }

  clearProcedural() {
  this.procedural = [];
  return this;
  }

  getStats() {
  return {
    episodic: this.episodic.length,
    semantic: this.semantic.length,
    procedural: this.procedural.length,
    total: this.episodic.length + this.semantic.length + this.procedural.length
  };
  }

  toJSON() {
  return {
    episodic: this.episodic,
    semantic: this.semantic,
    procedural: this.procedural.map(p => ({
    ...p,
    execute: p.execute?.toString() || ''
    }))
  };
  }

  static fromJSON(json) {
  return new Memory(json);
  }

  _generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = Memory;
