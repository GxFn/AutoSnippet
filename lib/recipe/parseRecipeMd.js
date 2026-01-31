/**
 * 检测并解析完整的 Recipe Markdown 格式
 * 当粘贴内容已是完整 Recipe（含 frontmatter、Snippet、Usage Guide）时，直接解析，无需 AI 重写
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const SNIPPET_HEADING_RE = /##\s+Snippet\s*\/\s*Code\s+Reference/i;
const USAGE_HEADING_RE = /##\s+AI\s+Context\s*\/\s*Usage\s+Guide/i;
const FENCED_CODE_RE = /```(\w*)\r?\n([\s\S]*?)```/;

/** 解析 YAML frontmatter 为简单键值（不依赖 yaml 库） */
function parseFrontmatter(str) {
	const out = {};
	if (!str || typeof str !== 'string') return out;
	const lines = str.split(/\r?\n/);
	let key = null;
	let valueLines = [];
	for (const line of lines) {
		const m = line.match(/^(\w+):\s*(.*)$/);
		if (m) {
			if (key) {
				const v = valueLines.join('\n').replace(/^["']|["']$/g, '').trim();
				if (v) out[key] = v;
			}
			key = m[1];
			const rest = m[2].trim();
			if (rest.startsWith('[')) {
				try {
					out[key] = JSON.parse(rest);
				} catch (_) {
					out[key] = rest;
				}
				key = null;
				valueLines = [];
			} else {
				valueLines = [rest];
			}
		} else if (key && line.match(/^\s/)) {
			valueLines.push(line);
		} else {
			if (key) {
				const v = valueLines.join('\n').replace(/^["']|["']$/g, '').trim();
				if (v) out[key] = v;
			}
			key = null;
			valueLines = [];
		}
	}
	if (key) {
		const v = valueLines.join('\n').replace(/^["']|["']$/g, '').trim();
		if (v) out[key] = v;
	}
	return out;
}

/**
 * 检测文本是否为完整的 Recipe MD 格式
 * 需同时具备：frontmatter、Snippet / Code Reference、代码块、AI Context / Usage Guide
 */
function isCompleteRecipeMd(text) {
	if (!text || typeof text !== 'string' || text.length < 50) return false;
	const trimmed = text.trim();
	if (!FRONTMATTER_RE.test(trimmed)) return false;
	if (!SNIPPET_HEADING_RE.test(trimmed)) return false;
	if (!FENCED_CODE_RE.test(trimmed)) return false;
	if (!USAGE_HEADING_RE.test(trimmed)) return false;
	const fm = trimmed.match(FRONTMATTER_RE);
	if (!fm || !fm[1]) return false;
	const meta = parseFrontmatter(fm[1]);
	if (!meta.title || !meta.trigger) return false;
	return true;
}

/**
 * 解析完整 Recipe MD，返回 ExtractedRecipe 兼容结构
 * @param {string} text
 * @returns {{ title, summary, summary_cn, trigger, category, language, code, usageGuide, usageGuide_cn, headers } | null}
 */
function parseRecipeMd(text) {
	if (!isCompleteRecipeMd(text)) return null;
	const trimmed = text.trim();
	const fmMatch = trimmed.match(FRONTMATTER_RE);
	const meta = parseFrontmatter(fmMatch[1]);
	const body = trimmed.slice(fmMatch[0].length);

	const codeMatch = body.match(FENCED_CODE_RE);
	const code = codeMatch ? codeMatch[2].trim() : '';
	const codeLang = (codeMatch && codeMatch[1]) ? codeMatch[1].toLowerCase() : 'objectivec';
	const lang = /swift/i.test(codeLang) ? 'swift' : 'objectivec';

	let usageGuide = '';
	const usageIdx = body.search(USAGE_HEADING_RE);
	if (usageIdx >= 0) {
		usageGuide = body.slice(usageIdx).replace(USAGE_HEADING_RE, '').trim();
	}

	const headers = Array.isArray(meta.headers) ? meta.headers : (meta.headers ? [String(meta.headers)] : []);

	return {
		title: meta.title || 'Untitled',
		summary: meta.summary || '',
		summary_cn: meta.summary || '',
		summary_en: meta.summary || '',
		trigger: (meta.trigger || '').startsWith('@') ? meta.trigger : `@${meta.trigger || 'recipe'}`,
		category: meta.category || 'Utility',
		language: meta.language ? String(meta.language).toLowerCase() : lang,
		code,
		usageGuide,
		usageGuide_cn: usageGuide,
		usageGuide_en: usageGuide,
		headers,
		includeHeaders: Array.isArray(headers) && headers.length > 0
	};
}

module.exports = { isCompleteRecipeMd, parseRecipeMd };
