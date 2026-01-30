/**
 * 使用 Vite ESM Node API 执行构建，避免 CJS 弃用警告。
 * 运行前请确保在 dashboard 目录下执行（npm run build 会保证 cwd 正确）。
 * 若仍见 CJS 警告，可设置环境变量 VITE_CJS_IGNORE_WARNING=1。
 */
import { build, loadConfigFromFile } from 'vite';

const env = { command: 'build', mode: 'production' };
const { config } = await loadConfigFromFile(env);
if (!config) {
	throw new Error('未找到 Vite 配置');
}
await build(config);
