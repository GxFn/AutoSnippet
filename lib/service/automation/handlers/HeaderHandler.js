/**
 * HeaderHandler — 处理 // as:include / // as:import 指令
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * @param {import('../FileWatcher.js').FileWatcher} watcher
 * @param {string} fullPath
 * @param {string} headerLine
 * @param {string[]} importArray
 * @param {boolean} isSwift
 */
export async function handleHeader(watcher, fullPath, headerLine, importArray, isSwift) {
  try {
    const HeaderResolver = await import('../../../infrastructure/paths/HeaderResolver.js');
    const parsed = HeaderResolver.parseImportLine(headerLine);

    if (!parsed) {
      console.log(`[Header] 无法解析指令: ${headerLine}`);
      return;
    }

    console.log(`\n📦 [Header] ${isSwift ? 'import' : '#import'} ${parsed.moduleName || parsed.headerName || headerLine}`);

    const resolved = await HeaderResolver.resolveHeadersForText(
      watcher.projectRoot,
      basename(fullPath),
      readFileSync(fullPath, 'utf8')
    );

    if (!resolved || !resolved.headers || resolved.headers.length === 0) {
      console.log(`  ℹ️  未找到需要添加的头文件`);
      return;
    }

    const { insertHeaders } = await import('../XcodeIntegration.js');
    const result = await insertHeaders(watcher, fullPath, resolved.headers, {
      isSwift,
      moduleName: resolved.moduleName || null,
    });

    if (result.cancelled) {
      return;
    }
    if (result.inserted.length === 0 && result.skipped.length > 0) {
      console.log(`  ✅ 头文件已全部导入`);
    }
  } catch (err) {
    console.warn(`  ⚠️ Header 处理失败: ${err.message}`);
    if (process.env.ASD_DEBUG === '1') {
      console.error(err.stack);
    }
  }
}
