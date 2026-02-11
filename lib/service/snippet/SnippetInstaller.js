/**
 * SnippetInstaller — Xcode .codesnippet 安装器
 * 将生成的 snippet 文件写入 Xcode CodeSnippets 目录
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const XCODE_SNIPPETS_DIR = join(
  homedir(),
  'Library/Developer/Xcode/UserData/CodeSnippets'
);

export class SnippetInstaller {
  #snippetsDir;
  #snippetFactory;

  constructor(options = {}) {
    this.#snippetsDir = options.snippetsDir || XCODE_SNIPPETS_DIR;
    this.#snippetFactory = options.snippetFactory || null;
  }

  setSnippetFactory(factory) { this.#snippetFactory = factory; }

  /**
   * 安装单个 snippet
   * @param {object} spec — { identifier, title, completion, summary, code, language }
   * @returns {{ success: boolean, path: string, message: string }}
   */
  install(spec) {
    if (!this.#snippetFactory) throw new Error('SnippetFactory not set');

    try {
      this.#ensureDir();
      const xml = this.#snippetFactory.generate(spec);
      const filename = `${spec.identifier}.codesnippet`;
      const filePath = join(this.#snippetsDir, filename);

      writeFileSync(filePath, xml);
      return { success: true, path: filePath, message: `Installed: ${filename}` };
    } catch (error) {
      return { success: false, path: '', message: error.message };
    }
  }

  /**
   * 从 Recipe 批量安装
   * @param {Array} recipes — [{ id, title, trigger, code, description, language }]
   * @returns {{ success: boolean, count: number, successCount: number, errorCount: number, details: Array }}
   */
  installFromRecipes(recipes) {
    if (!this.#snippetFactory) throw new Error('SnippetFactory not set');

    this.#ensureDir();
    const details = [];
    let successCount = 0;
    let errorCount = 0;

    for (const recipe of recipes) {
      try {
        const spec = this.#snippetFactory.fromRecipe(recipe);
        const result = this.install(spec);
        details.push(result);
        if (result.success) successCount++;
        else errorCount++;
      } catch (error) {
        details.push({ success: false, path: '', message: error.message });
        errorCount++;
      }
    }

    return {
      success: errorCount === 0,
      count: recipes.length,
      successCount,
      errorCount,
      details,
    };
  }

  /**
   * 列出已安装的 AutoSnippet 管理的 snippet
   * @returns {Array<{ filename: string, path: string }>}
   */
  listInstalled() {
    if (!existsSync(this.#snippetsDir)) return [];

    return readdirSync(this.#snippetsDir)
      .filter(f => f.startsWith('com.autosnippet.') && f.endsWith('.codesnippet'))
      .map(f => ({ filename: f, path: join(this.#snippetsDir, f) }));
  }

  /**
   * 卸载指定 snippet
   * @param {string} identifier
   * @returns {{ success: boolean, message: string }}
   */
  uninstall(identifier) {
    const filename = identifier.endsWith('.codesnippet') ? identifier : `${identifier}.codesnippet`;
    const filePath = join(this.#snippetsDir, filename);

    if (!existsSync(filePath)) {
      return { success: false, message: `Not found: ${filename}` };
    }

    unlinkSync(filePath);
    return { success: true, message: `Uninstalled: ${filename}` };
  }

  /**
   * 清除所有 AutoSnippet 管理的 snippet
   * @returns {{ success: boolean, removed: number }}
   */
  cleanAll() {
    const installed = this.listInstalled();
    let removed = 0;

    for (const { path } of installed) {
      try { unlinkSync(path); removed++; } catch { /* ignore */ }
    }

    return { success: true, removed };
  }

  get snippetsDir() { return this.#snippetsDir; }

  #ensureDir() {
    if (!existsSync(this.#snippetsDir)) {
      mkdirSync(this.#snippetsDir, { recursive: true });
    }
  }
}
