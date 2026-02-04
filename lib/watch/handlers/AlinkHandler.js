/**
 * AlinkHandler - 处理 @alink 触发
 */

const path = require('path');
const open = require('open');
const cache = require('../../infrastructure/cache/CacheStore');
const triggerSymbol = require('../../infrastructure/config/TriggerSymbol');
const AutomationOrchestrator = require('../../automation/AutomationOrchestrator');

const automationOrchestrator = new AutomationOrchestrator();

class AlinkHandler {
  async handle(specFile, alinkLine) {
    return automationOrchestrator.run(
      {
        type: 'alink',
        handler: (context) => this._handleAlink(context)
      },
      { specFile, alinkLine }
    );
  }

  async _handleAlink(context) {
    const { specFile, alinkLine } = context;
    const sym = triggerSymbol.TRIGGER_SYMBOL;
    let completionKey = null;
    const alinkMark = 'alink';

    if (alinkLine.includes(sym)) {
      const parts = alinkLine.split(sym).map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2 && parts[parts.length - 1] === alinkMark) {
        completionKey = parts[parts.length - 2];
      }
    }

    if (completionKey != null) {
      const linkCache = await cache.getLinkCache(specFile);
      if (linkCache && linkCache[completionKey]) {
        let link = decodeURI(linkCache[completionKey]);

        if (!link.startsWith('http')) {
          const specFilePath = path.dirname(specFile);
          link = path.join(specFilePath, link);
        }

        if (link) {
          open(link, { app: { name: 'google chrome' } });
        }
      }
    }
  }
}

module.exports = new AlinkHandler();
