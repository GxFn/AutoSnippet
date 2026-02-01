# asd 原生入口（完整性校验）

作为 `asd` 命令的可选入口：在启动 Node 前校验关键文件 SHA-256，与 `checksums.json` 比对，不通过则退出。

- **行为**：有 checksums.json 则校验关键文件，通过则 spawn Node；无则跳过。失败时 `bin/asd` 回退到 `node bin/asnip.js`。
- **入口链**：`asd` → `bin/asd`（脚本）→ 若存在 `bin/asd-verify` 则执行，否则 `node bin/asnip.js`。
- **构建**：仅 macOS，`node scripts/build-asd-entry.js`，产物 `bin/asd-verify`。
