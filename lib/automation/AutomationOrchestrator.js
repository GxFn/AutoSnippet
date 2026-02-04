/**
 * AutomationOrchestrator - 自动化统一入口
 */

const TriggerResolver = require('./TriggerResolver');
const ContextCollector = require('./ContextCollector');
const ActionPipeline = require('./ActionPipeline');

class AutomationOrchestrator {
  constructor(options = {}) {
    this.triggerResolver = options.triggerResolver || new TriggerResolver();
    this.contextCollector = options.contextCollector || new ContextCollector();
    this.pipeline = options.pipeline || new ActionPipeline();
  }

  async run(trigger, context) {
    const normalizedTrigger = this.triggerResolver.resolve(trigger);
    const collectedContext = this.contextCollector.collect(context);
    return this.pipeline.execute(normalizedTrigger, collectedContext);
  }
}

module.exports = AutomationOrchestrator;
