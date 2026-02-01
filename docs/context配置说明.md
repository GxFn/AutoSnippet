# context 配置说明

语义索引的存储、数据源与分块（chunking）配置说明。配置来源于项目根 `AutoSnippetRoot.boxspec.json` 中的 `context` 字段，未配置时使用下述默认值。

---

## 前置条件

- 项目根存在 `AutoSnippetRoot.boxspec.json`。
- 执行 `asd embed` 前需先完成 `asd ui` 或至少保证语义索引所需目录与依赖可用。
- 使用 LanceDB 适配器时需执行 `asd install:full --lancedb` 并安装 `@lancedb/lancedb`。

---

## storage（存储适配器）

| 配置项 | 说明 | 默认 |
|--------|------|------|
| `adapter` | 存储类型 | `"json"` |
| 可选值 | `"json"`、`"lance"` | — |

- **json**：索引与向量存储在 `Knowledge/.autosnippet/context/index/` 下，无需额外依赖。
- **lance**：使用 LanceDB，适合较大规模索引；需先执行 `asd install:full --lancedb`，并在 boxspec 的 `context.storage.adapter` 中设为 `"lance"`。

示例（boxspec 内）：

```json
"context": {
  "storage": { "adapter": "json" }
}
```

---

## index.sources（数据源）

语义索引的数据来源，未配置时默认仅索引 Recipe。

| 字段 | 说明 |
|------|------|
| `path` | 相对项目根的路径，如 `Knowledge/recipes` |
| `type` | 源类型：`recipe`、`doc`、`target-readme` 等 |

默认等价于：

```json
"context": {
  "index": {
    "sources": [{ "path": "Knowledge/recipes", "type": "recipe" }]
  }
}
```

---

## chunking（分块策略）

控制长文档如何切分为语义检索的片段。

| 策略 | 说明 |
|------|------|
| `whole` | 整篇作为一块（默认） |
| `section` | 按标题/段落切分 |
| `fixed` | 按固定 token 数切分 |
| `auto` | 自动选择 |

可在 boxspec 的 `context.index.chunking` 中配置 `strategy`、`maxChunkTokens`、`overlapTokens` 等，具体以 `lib/context` 与 `lib/infra/defaults.js` 为准。

---

## 相关文档

- [使用文档](./使用文档.md)：安装、`asd embed`、Dashboard 与编辑器内指令。
- 实现与默认值：`lib/context/ContextService.js`、`lib/infra/defaults.js`。
