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

## 存储适配器切换

如需在 `json` 与 `lance` 之间切换，按以下步骤操作。

### json → lance

1. 安装 LanceDB：执行 `asd install:full --lancedb` 或 `npm install @lancedb/lancedb`（在项目根或 AutoSnippet 包目录）。
2. 修改 `AutoSnippetRoot.boxspec.json`，在 `context.storage` 中设置 `"adapter": "lance"`。
3. 重启 `asd ui`（若在运行）。
4. 执行 `asd embed` 重建索引（新索引写入 `Knowledge/.autosnippet/context/index/lancedb/`）。

### lance → json

1. 修改 boxspec，将 `context.storage.adapter` 设为 `"json"`。
2. 重启 `asd ui`（若在运行）。
3. 执行 `asd embed` 重建索引（新索引写入 `vector_index.json`）。
4. （可选）删除旧 LanceDB 目录 `Knowledge/.autosnippet/context/index/lancedb/` 以释放空间。

### 注意事项

- 切换后**必须**执行 `asd embed`，索引不会自动迁移；两种适配器使用不同存储格式，需重新构建。
- JSON 数据存于 `Knowledge/.autosnippet/context/index/vector_index.json`，LanceDB 存于同目录下 `lancedb/` 子目录，二者互不覆盖。

---

## 测试覆盖

- **JsonAdapter**：`npm run test:unit` 覆盖。
- **LanceDB 适配器**：提供本地测试，不纳入 CI。先安装 `asd install:full --lancedb`，再执行 `npm run test:unit:lance`。覆盖 upsert、getById、searchByFilter、searchVector、remove、getStats。未安装时自动跳过。

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
