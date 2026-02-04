class FeedbackCollector {
  constructor(store, eventBus) {
    this.store = store;
    this.eventBus = eventBus;
  }

  recordInteraction(event) {
    if (!event) return;
    if (this.store && typeof this.store.save === 'function') {
      this.store.save('quality_interactions', event);
    }
    if (this.eventBus && typeof this.eventBus.emit === 'function') {
      this.eventBus.emit('quality.interaction', event);
    }
  }
}

module.exports = FeedbackCollector;
