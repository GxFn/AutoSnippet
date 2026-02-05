/** 将 spec 中存储的 XML 转义还原为原始代码，供前端编辑显示，避免保存时重复转义 */
function unescapeSnippetLine(str) {
  if (typeof str !== 'string') return str;
  return str
  .replace(/&gt;/g, '>')
  .replace(/&lt;/g, '<')
  .replace(/&amp;/g, '&');
}

module.exports = {
  unescapeSnippetLine,
};
