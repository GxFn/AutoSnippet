/**
 * ActionPipeline - 执行管线
 */
class ActionPipeline {
  async execute(trigger, context) {
    if (trigger && typeof trigger.handler === 'function') {
      return trigger.handler(context);
    }
    return null;
  }
}

module.exports = ActionPipeline;
