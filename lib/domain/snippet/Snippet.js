import { v4 as uuidv4 } from 'uuid';

/**
 * Snippet - 代码片段实体
 *
 * 与 Recipe 的区别:
 * - Recipe: 抽象的知识模式 / 最佳实践
 * - Snippet: 具体的、可安装的代码片段（如 Xcode Snippet）
 */
export class Snippet {
  constructor(props) {
    this.id = props.id || uuidv4();
    this.identifier = props.identifier;   // 唯一标识符（如 swift_guard_let）
    this.title = props.title;
    this.language = props.language || 'swift';
    this.category = props.category;
    this.completion = props.completion;     // 自动补全触发词
    this.summary = props.summary || '';
    this.code = Array.isArray(props.code) ? props.code.join('\n') : (props.code || '');

    // Xcode integration
    this.installed = !!props.installed;
    this.installedPath = props.installedPath || null;

    // Source tracking
    this.sourceRecipeId = props.sourceRecipeId || null;
    this.sourceCandidateId = props.sourceCandidateId || null;

    // Metadata
    this.metadata = props.metadata || null;
    this.createdBy = props.createdBy || null;
    this.createdAt = props.createdAt || Math.floor(Date.now() / 1000);
    this.updatedAt = props.updatedAt || Math.floor(Date.now() / 1000);
  }

  /**
   * 验证 Snippet 完整性
   */
  isValid() {
    return (
      this.identifier &&
      this.identifier.trim().length > 0 &&
      this.title &&
      this.title.trim().length > 0 &&
      this.code &&
      this.code.trim().length > 0
    );
  }

  /**
   * 转换为 JSON（前端 / API 返回格式）
   */
  toJSON() {
    return {
      id: this.id,
      identifier: this.identifier,
      title: this.title,
      language: this.language,
      category: this.category,
      completion: this.completion,
      summary: this.summary,
      code: this.code,
      installed: this.installed,
      installedPath: this.installedPath,
      sourceRecipeId: this.sourceRecipeId,
      sourceCandidateId: this.sourceCandidateId,
      metadata: this.metadata,
      createdBy: this.createdBy,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * 从 JSON 创建 Snippet
   */
  static fromJSON(data) {
    return new Snippet(data);
  }
}

export default Snippet;
