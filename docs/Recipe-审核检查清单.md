# Recipe 审核检查清单

用于人工审核候选/Recipe 的统一标准（不修改知识库文件）。

## 1. 结构完整性
- [ ] Frontmatter 完整
- [ ] 有 `## Snippet / Code Reference`
- [ ] 有 `## AI Context / Usage Guide`

## 2. 必填字段（必须齐全）
- [ ] `title`
- [ ] `trigger`
- [ ] `category`
- [ ] `language`
- [ ] `summary_cn`
- [ ] `summary_en`
- [ ] `headers`

## 3. 字段规范
- [ ] `trigger` 以 `@` 开头，小写、无空格
- [ ] `category` 为 8 类之一（View/Service/Tool/Model/Network/Storage/UI/Utility）
- [ ] `language` 为 `swift` 或 `objectivec`
- [ ] `headers` 为完整 import/#import 语句数组
- [ ] `summary_cn` ≤ 100 字，`summary_en` ≤ 100 words

## 4. 代码与用法
- [ ] 代码为“使用示例”，非内部实现
- [ ] 代码可复制运行（必要时含占位符）
- [ ] 用法说明包含：何时用 / 依赖与约束 / 常见误用或注意事项

## 5. 可选但高价值字段
- [ ] `keywords` / `tags`（语义与辅助标签）
- [ ] `version` / `author` / `deprecated`
- [ ] `moduleName` / `deps` / `difficulty` / `authority`

## 6. 重复与冲突
- [ ] 已检查相似 Recipe（避免重复或冲突）
- [ ] 若相似度高，考虑合并或作为变体

## 7. 结论
- [ ] 通过（可入库）
- [ ] 退回修改（记录原因）
- [ ] 合并/替代已有 Recipe
