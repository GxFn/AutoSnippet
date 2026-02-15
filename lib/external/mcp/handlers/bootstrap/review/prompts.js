/**
 * Bootstrap AI Review — Prompt 模板
 *
 * 三轮审查各自的 prompt 构建函数，独立于审查逻辑方便调优迭代。
 *
 * Round 1 — 资格审查（keep / merge / drop）
 * Round 2 — 内容精炼（summary / agentNotes / insight / trigger / confidence）
 * Round 3 — 去重 + 关系推断
 */

// ─── Round 1 Prompt ──────────────────────────────────────

/**
 * 构建 Round 1 的 prompt（抽出为函数，分批复用）
 */
export function buildRound1Prompt(candidateSummaries, projectContext) {
  return `# Role
You are a senior code reviewer auditing Bootstrap knowledge candidates extracted from a ${projectContext.primaryLang} project (${projectContext.fileCount} files, ${projectContext.targetCount} targets).

# Task — Eligibility Gate (STRICT)
For each candidate below, determine if it represents a GENUINE, VALUABLE coding pattern/convention in this project.

## Criteria for DROP:
- False positive: pattern detected from comments, licenses, strings, or unrelated code (e.g., "Navigator" from "Project Navigator" in Xcode comments)
- Too generic: applies to any project, not specific to THIS project's conventions
- Insufficient evidence: only 1 match in the whole project AND the match is ambiguous
- Code sample is irrelevant to the claimed pattern (e.g., "Builder" from ObjC init methods)

## Criteria for MERGE:
- Two or more candidates describe the SAME concept from different angles
- Merging would create a more complete, useful knowledge entry

## Criteria for KEEP:
- Genuine pattern with ≥2 clear instances in project code
- Provides actionable guidance for a coding agent

# Candidates
${JSON.stringify(candidateSummaries, null, 2)}

# Output
Return a JSON object:
{
  "decisions": [
    { "index": 0, "verdict": "keep" | "merge" | "drop", "reason": "短句说明", "mergeWith": [1, 3] }
  ]
}
Rules:
- "mergeWith" only present when verdict is "merge", contains indices of candidates to merge with
- Every candidate must have exactly one decision
- Be conservative: when in doubt, KEEP (it's better to have slightly more candidates than to lose valuable ones)
- Return raw JSON only, no markdown wrapping`;
}

// ─── Round 2 Prompt ──────────────────────────────────────

/**
 * 构建 Round 2 的批量精炼 prompt
 */
export function buildRound2Prompt(batch, allTitles, projectContext) {
  const candidateBlocks = batch.map((c, i) => `
### Candidate ${i}
- Title: ${c.title}
- SubTopic: ${c.subTopic}
- Language: ${c.language}
- Summary: ${c.summary}
- Sources: ${(c.sources || []).join(', ')}

Content (first 2000 chars):
\`\`\`
${(c.code || '').substring(0, 2000)}
\`\`\`
`).join('\n');

  return `# Role
You are refining Bootstrap knowledge candidates for a ${projectContext.primaryLang} project "${projectContext.projectName || 'unknown'}".

# STRICT Anti-Drift Rules
- You are ONLY improving the description quality of EXISTING candidates
- Do NOT invent new patterns, do NOT add knowledge not present in the code samples
- Do NOT change the fundamental meaning of any candidate
- Every improvement must be grounded in the actual code shown

# Content Structure Guide
Each candidate follows a 「项目特写」 style — a fused narrative interweaving standard usage and project specifics.
Description and code are interwoven naturally, not split into rigid ## sections.
After reading, one should know exactly how to write this pattern in THIS project.

When refining, keep this fusion in mind. agentNotes should reference the concrete pattern, not generic advice.

# Candidates to Refine
${candidateBlocks}

# Sibling Titles (for context only)
${allTitles.map(t => `- ${t}`).join('\n')}

# Tasks for EACH Candidate
1. **summary** (Chinese, ≤80 chars): Precise, project-specific summary. Replace generic templates like "XX模式：N处检测到" with actionable descriptions. Include the project's actual class names or conventions.
2. **agentNotes** (Chinese, 2-4 items): Actionable rules grounded in the code samples. Each note must reference actual project code/classes/patterns. Focus on how the project uses this pattern specifically (not generic textbook advice).
3. **insight** (Chinese, nullable): One architectural observation about why this project uses this pattern this way. Only if genuinely insightful.
4. **trigger** (String, ≤80 chars): Comma-separated keywords that should trigger this knowledge. E.g. "singleton,sharedInstance,dispatch_once,shared"
5. **confidence** (Float 0-1): Rate based on:
   - Evidence strength (how many files, how clear the pattern) — weight 50%
   - Actionability (how useful for a coding agent) — weight 30%
   - Specificity (how project-specific vs generic) — weight 20%
   Low: 0.3 (1 match, generic), Medium: 0.6 (3+ matches, somewhat specific), High: 0.9 (widespread, clearly project convention)

# Output
{
  "refinements": [
    {
      "title": "<original title of the candidate, for matching>",
      "summary": "...",
      "agentNotes": ["...", "..."],
      "insight": "..." or null,
      "trigger": "...",
      "confidence": 0.7
    }
  ]
}
Return one refinement per candidate, in same order. Include the original title for matching. Raw JSON only.`;
}

// ─── Round 3 Prompt ──────────────────────────────────────

/**
 * 构建 Round 3 prompt（使用 stableId）
 */
export function buildRound3Prompt(candidateOverview) {
  return `# Role
You are a knowledge graph architect analyzing ${candidateOverview.length} code knowledge candidates from one project.

# Task 1 — Deduplication
Identify candidate pairs where the content substantially overlaps (>60% semantic overlap).
For each pair, recommend which one to DROP (keep the more specific/valuable one).

# Task 2 — Relation Inference
Infer meaningful relationships between candidates. Only output STRONG, obvious relationships.

## Relation types:
- DEPENDS_ON: A requires B (e.g., error-handling depends on logging)
- EXTENDS: A is a specialization of B (e.g., KVO extends observer-pattern)
- CONFLICTS: A and B suggest contradictory approaches
- ENFORCES: A is a rule that B must follow
- PREREQUISITE: B should be understood before A

# Candidates
${JSON.stringify(candidateOverview, null, 2)}

# Output
{
  "duplicates": [
    { "keepId": "<id of candidate to keep>", "dropId": "<id of candidate to drop>", "reason": "..." }
  ],
  "relations": [
    { "fromId": "<id>", "toId": "<id>", "type": "EXTENDS", "description": "..." }
  ]
}
IMPORTANT: use the "id" field of each candidate (NOT array index) in keepId/dropId/fromId/toId.
Return raw JSON only. Be conservative — only flag clear duplicates and strong relations.`;
}
