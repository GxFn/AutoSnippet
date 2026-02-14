/**
 * Bootstrap — ObjC/Swift 共享工具集
 *
 * 从 extractors-macro.js 和 extractors-objc-deep.js 中提取的公共工具函数和常量。
 * 消除两个提取器之间 ~400 行的重复代码。
 *
 * 包含：
 *   - Foundation / UIKit 类型集合
 *   - 基类分类函数
 *   - 正则转义
 *   - 多行宏收集
 *   - 宏类别推断
 *   - 常量文件识别
 */

// ─── Foundation / UIKit 类型集 ───────────────────────────

export const FOUNDATION_TYPES = new Set([
  'NSObject', 'NSString', 'NSMutableString', 'NSArray', 'NSMutableArray',
  'NSDictionary', 'NSMutableDictionary', 'NSData', 'NSMutableData',
  'NSDate', 'NSURL', 'NSNumber', 'NSAttributedString', 'NSMutableAttributedString',
  'NSError', 'NSBundle', 'NSNotification', 'NSUserDefaults', 'NSFileManager',
  'NSCache', 'NSTimer', 'NSThread', 'NSLock', 'NSCondition',
  'NSPredicate', 'NSRegularExpression', 'NSValue', 'NSIndexPath', 'NSSet',
  'NSMutableSet', 'NSOrderedSet', 'NSURLSession', 'NSURLRequest',
  'String', 'Array', 'Dictionary', 'Set', 'Data', 'Date', 'URL',
  'Int', 'Double', 'Float', 'Bool', 'Optional', 'Result',
  // macro 独有条目（合并到此处统一维护）
  'Sequence', 'Collection', 'Comparable', 'Hashable', 'Codable',
  'Encodable', 'Decodable', 'Error', 'CaseIterable',
]);

export const UIKIT_TYPES = new Set([
  'UIView', 'UILabel', 'UIButton', 'UIImageView', 'UITextField', 'UITextView',
  'UITableView', 'UITableViewCell', 'UICollectionView', 'UICollectionViewCell',
  'UIViewController', 'UINavigationController', 'UITabBarController',
  'UIScrollView', 'UIStackView', 'UIColor', 'UIImage', 'UIFont',
  'UIApplication', 'UIWindow', 'UIScreen', 'UIDevice', 'UIGestureRecognizer',
  'UIAlertController', 'UIBarButtonItem', 'UINavigationBar', 'UITabBar',
  'UIControl', 'UIResponder', 'UIBezierPath', 'CALayer',
  'NSView', 'NSViewController', 'NSColor', 'NSImage', 'NSFont',
  // macro 独有条目（合并到此处统一维护）
  'UIEdgeInsets',
  // SwiftUI 类型
  'View', 'Text', 'Image', 'Color', 'Shape', 'Path',
]);

// ─── 分类工具函数 ────────────────────────────────────────

/**
 * 分类基类来源
 * @param {string} baseClass — 基类名称
 * @returns {'foundation'|'uikit'|'custom'} 分类
 */
export function classifyBase(baseClass) {
  if (FOUNDATION_TYPES.has(baseClass)) return 'foundation';
  if (UIKIT_TYPES.has(baseClass)) return 'uikit';
  return 'custom';
}

/**
 * 正则特殊字符转义
 * @param {string} s — 原始字符串
 * @returns {string} 转义后的字符串
 */
export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── 宏定义工具 ──────────────────────────────────────────

/**
 * 多行 #define 拼接 — 收集以 \ 续行的宏定义
 * @param {string[]} fileLines — 文件行数组
 * @param {number} startIdx — #define 起始行索引
 * @returns {string} 拼接后的完整宏定义
 */
export function collectMultilineMacro(fileLines, startIdx) {
  let body = fileLines[startIdx];
  let i = startIdx;
  while (body.endsWith('\\') && i + 1 < fileLines.length) {
    i++;
    body = body.slice(0, -1) + ' ' + fileLines[i].trim();
  }
  return body;
}

/** 宏类别推断规则（按优先级排列） */
const MACRO_CATEGORY_RULES = [
  { cat: '颜色', re: /color|colour|rgb|rgba|hex/i },
  { cat: '字体', re: /font|text.*size|fontSize/i },
  { cat: '屏幕/尺寸', re: /screen|width|height|size|margin|padding|spacing|inset|offset|scale|ratio/i },
  { cat: 'URL/API', re: /url|api|host|base.*url|endpoint|domain|server|scheme|port/i },
  { cat: '通知名', re: /notification|notif|kNotif/i },
  { cat: 'UserDefaults Key', re: /key|userdefault|kUD|kSave|kStore/i },
  { cat: '时间/动画', re: /duration|delay|interval|timeout|animation|animate/i },
  { cat: '业务常量', re: /max|min|limit|count|page|default|threshold|retry|capacity/i },
  { cat: 'weakify/strongify', re: /weakify|strongify|weak_self|strong_self|WEAK|STRONG/i },
];

/**
 * 推断宏类别
 * @param {string} name — 宏名称
 * @param {string} [value] — 宏值
 * @returns {string} 类别名称
 */
export function inferMacroCategory(name, value) {
  for (const rule of MACRO_CATEGORY_RULES) {
    if (rule.re.test(name) || rule.re.test(value || '')) return rule.cat;
  }
  if (/^k[A-Z]/.test(name)) return '业务常量';
  return '其他';
}

// ─── 文件识别 ────────────────────────────────────────────

/** 常量定义文件名关键词正则 */
const CONST_FILE_RE = /(?:const|constant|macro|define|config|theme|color|colour|font|size|dimension|style|key|notification|url|api|endpoint|global|common|util|helper)/i;

/**
 * 判断是否为"常量定义文件"
 * @param {object} f — 文件对象 { name, relativePath }
 * @returns {boolean}
 */
export function isConstFile(f) {
  return CONST_FILE_RE.test(f.name || '') || CONST_FILE_RE.test(f.relativePath || '');
}
