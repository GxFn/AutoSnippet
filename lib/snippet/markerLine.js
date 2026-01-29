const path = require('path');

/**
 * 将 #import / import 转为 // as:include 或 // as:import 标记；与 create/installer 一致
 */
function toAsMarkerLine(headerStr, isSwift, relativePath, moduleName) {
  const s = String(headerStr || '').trim();
  if (!s) return '';
  const pathPart = (relativePath && String(relativePath).trim()) ? ` ${String(relativePath).trim()}` : '';
  if (isSwift) {
    const m = s.match(/^import\s+(.+)$/);
    return m ? `// as:import ${m[1].trim()}${pathPart}` : `// as:import ${s}${pathPart}`;
  }
  const angle = s.match(/#import\s+<([^>]+)>/);
  if (angle) return `// as:include <${angle[1]}>${pathPart}`;
  const quote = s.match(/#import\s+"([^"]+)"/);
  if (quote) {
    const fileName = path.basename(quote[1], '.h') + '.h';
    if (moduleName) return `// as:include <${moduleName}/${fileName}>${pathPart}`;
    return `// as:include "${quote[1]}"${pathPart}`;
  }
  if (s.startsWith('<') && s.includes('>')) return `// as:include ${s}${pathPart}`;
  return `// as:include ${s}${pathPart}`;
}

module.exports = { toAsMarkerLine };
