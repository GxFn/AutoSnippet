// Agent 实体 - 代表一个 AI Agent（代理）

class Agent {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.type = data.type;
    this.description = data.description || '';
    this.config = data.config || {};
    this.memory = data.memory || {
      episodic: [],
      semantic: [],
      procedural: []
    };
    this.status = 'idle';
    this.createdAt = data.createdAt || Date.now();
    this.updatedAt = data.updatedAt || Date.now();
  }

  isValid() {
    return !!(this.id && this.name && this.type);
  }

  validate() {
    if (!this.id) return 'Agent ID is required';
    if (!this.name) return 'Agent name is required';
    if (!this.type) return 'Agent type is required';

    const validTypes = ['lint', 'generate', 'search', 'learn'];
    if (!validTypes.includes(this.type)) {
      return `Agent type must be one of: ${validTypes.join(', ')}`;
    }

    return null;
  }

  update(updates) {
    Object.assign(this, updates);
    this.updatedAt = Date.now();
    return this;
  }

  setStatus(status) {
    this.status = status;
    this.updatedAt = Date.now();
    return this;
  }

  addEpisodicMemory(event) {
    this.memory.episodic.push({
      ...event,
      timestamp: Date.now()
    });
    return this;
  }

  addSemanticMemory(semantic) {
    this.memory.semantic.push(semantic);
    return this;
  }

  addProceduralMemory(procedure) {
    this.memory.procedural.push(procedure);
    return this;
  }

  clearMemory() {
    this.memory = {
      episodic: [],
      semantic: [],
      procedural: []
    };
    return this;
  }

  getRecentEvents(limit = 10) {
    return this.memory.episodic.slice(-limit);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      description: this.description,
      config: this.config,
      memory: this.memory,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static fromJSON(json) {
    return new Agent(json);
  }

  clone() {
    return new Agent(this.toJSON());
  }
}

module.exports = Agent;
