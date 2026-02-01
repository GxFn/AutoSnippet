export const isShellTarget = (name: string) => {
	const shellKeywords = ['Example', 'Demo', 'Sample', 'Tests', 'Spec', 'Mock', 'Runner'];
	return shellKeywords.some(key => name.endsWith(key) || name.includes(key));
};

/** 静默提交的虚拟 target（_watch、_draft、_cli） */
export const isSilentTarget = (name: string) => name.startsWith('_');
/** 未保存暂存池（SPM/New Recipe 分析结果），排到底端，24h 过期 */
export const isPendingTarget = (name: string) => name === '_pending';

/** 将 spec 中存储的 XML 转义还原为原始代码，供前端编辑显示，避免保存时重复转义 */
export function unescapeSnippetLine(str: string) {
	if (typeof str !== 'string') return str;
	return str
		.replace(/&gt;/g, '>')
		.replace(/&lt;/g, '<')
		.replace(/&amp;/g, '&');
}
