/**
 * AlinkHandler — 处理 alink 指令
 */

/**
 * @param {string} alinkLine
 */
export async function handleAlink(alinkLine) {
  const { TRIGGER_SYMBOL } = await import('../../../infrastructure/config/TriggerSymbol.js');
  let completionKey = null;
  const alinkMark = 'alink';

  if (alinkLine.includes(TRIGGER_SYMBOL)) {
    const parts = alinkLine.split(TRIGGER_SYMBOL).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && parts[parts.length - 1] === alinkMark) {
      completionKey = parts[parts.length - 2];
    }
  }

  if (completionKey != null) {
    try {
      const open = (await import('open')).default;
      // TODO: 从 V2 缓存系统获取 link
      console.log(`[alink] completionKey=${completionKey} — V2 链接缓存待实现`);
    } catch {
      // 静默
    }
  }
}
