/**
 * TriggerResolver - 触发解析
 */
class TriggerResolver {
  resolve(trigger) {
    if (!trigger || !trigger.type) {
      return { type: 'unknown', ...trigger };
    }
    return trigger;
  }
}

module.exports = TriggerResolver;
