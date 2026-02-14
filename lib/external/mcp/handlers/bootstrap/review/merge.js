/**
 * Bootstrap AI Review — 合并工具
 *
 * 将 Round 1 标记的 merge groups 执行实际合并操作。
 */

/**
 * 合并 Round 1 标记的 merge groups
 * 取第一个候选为主体，合并其他候选的 sources/codeBlocks/bodyLines
 */
export function mergeCandidateGroups(mergeGroups) {
  const results = [];

  for (const group of mergeGroups) {
    if (group.length === 0) continue;
    if (group.length === 1) {
      results.push(group[0]);
      continue;
    }

    // 以第一个为主体
    const primary = { ...group[0] };
    const allSources = new Set(primary.sources || []);
    const additionalNotes = [];

    for (let i = 1; i < group.length; i++) {
      const other = group[i];
      // 合并 sources
      for (const s of (other.sources || [])) allSources.add(s);

      // 记录被合并的条目
      additionalNotes.push(`已合并：${other.title} — ${other.summary || ''}`);
    }

    primary.sources = [...allSources];
    primary.summary = `${primary.summary}（合并自 ${group.length} 条检测结果）`;
    primary._mergedFrom = group.map(g => g.title);

    results.push(primary);
  }

  return results;
}
