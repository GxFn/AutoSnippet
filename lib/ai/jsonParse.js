/**
 * 从 LLM 文本中提取并解析 JSON，处理 markdown 代码块、尾逗号等常见问题
 * 供各 AI Provider（GoogleGeminiProvider、OpenAiProvider 等）共用
 */

function extractAndParse(text, openChar, closeChar) {
	if (!text || typeof text !== 'string') return null;
	let raw = text.trim();

	// 1. 若有 ```json...``` 且不包含嵌套 ```，则取其内容
	const cb = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n```/);
	if (cb && !cb[1].includes('```')) raw = cb[1].trim();

	const start = raw.indexOf(openChar);
	if (start < 0) return null;

	let depth = 0;
	let inString = false;
	let escape = false;
	let quote = '';
	let end = -1;
	for (let i = start; i < raw.length; i++) {
		const c = raw[i];
		if (escape) {
			escape = false;
			continue;
		}
		if (inString) {
			if (c === '\\') escape = true;
			else if (c === quote) inString = false;
			continue;
		}
		if (c === '"' || c === "'") {
			inString = true;
			quote = c;
			continue;
		}
		if (c === openChar) depth++;
		else if (c === closeChar) {
			depth--;
			if (depth === 0) {
				end = i + 1;
				break;
			}
		}
	}
	if (end < 0) return null;
	let jsonStr = raw.slice(start, end);

	// 移除尾逗号（LLM 常见错误）
	jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');

	try {
		return JSON.parse(jsonStr);
	} catch (e) {
		return null;
	}
}

/**
 * 解析 JSON 数组
 * @param {string} text LLM 返回的文本
 * @returns {Array|null} 解析成功返回数组，失败返回 null
 */
function parseJsonArray(text) {
	return extractAndParse(text, '[', ']');
}

/**
 * 解析 JSON 对象
 * @param {string} text LLM 返回的文本
 * @returns {Object|null} 解析成功返回对象，失败返回 null
 */
function parseJsonObject(text) {
	return extractAndParse(text, '{', '}');
}

module.exports = { parseJsonArray, parseJsonObject };
