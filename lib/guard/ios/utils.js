/**
 * iOS Guard 通用工具
 */

/**
 * 将 code 中的字符下标转换为行号（从 1 开始）
 * @param {string} code
 * @param {number} index
 * @returns {number}
 */
function indexToLine(code, index) {
	const before = (code || '').slice(0, Math.max(0, index));
	const n = (before.match(/\r?\n/g) || []).length;
	return n + 1;
}

module.exports = {
	indexToLine
};
