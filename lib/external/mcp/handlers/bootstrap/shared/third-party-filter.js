/**
 * Bootstrap — 第三方库文件过滤
 *
 * 统一的第三方库文件识别逻辑，合并自：
 *   - extractors-micro.js 的 SKIP_PATH_RE
 *   - extractors-objc-deep.js 的 THIRD_PARTY_PATH_RE + KNOWN_THIRD_PARTY_DIR_RE
 *
 * 所有提取器统一使用此模块，确保过滤行为一致。
 */

// ─── 第三方路径关键词（目录级匹配） ─────────────────────

/** 包管理器和通用三方目录路径 */
const THIRD_PARTY_PATH_RE = /(?:^|\/)(?:Pods|Carthage|\.build\/checkouts|vendor|ThirdParty|External|Submodules|DerivedData|include)\//i;

/** 已知三方库目录名（嵌入源码而非 Pod 管理的情况） */
const KNOWN_THIRD_PARTY_DIR_RE = /(?:^|\/)(?:Masonry|AFNetworking|SDWebImage|MJRefresh|MJExtension|YYKit|YYModel|Lottie|FLEX|IQKeyboardManager|MBProgressHUD|SVProgressHUD|SnapKit|Kingfisher|Alamofire|Moya|ReactiveObjC|ReactiveCocoa|RxSwift|RxCocoa|FMDB|Realm|Mantle|JSONModel|CocoaLumberjack|CocoaAsyncSocket|SocketRocket|GPUImage|pop|FBSDKCore|FBSDKLogin|FlatBuffers|Protobuf|PromiseKit|Charts|Hero|SpringIndicator)\//i;

// ─── 公共接口 ────────────────────────────────────────────

/**
 * 判断文件是否来自第三方库
 *
 * @param {string|object} fileOrPath — 文件路径字符串，或含 relativePath/path 属性的文件对象
 * @returns {boolean}
 */
export function isThirdParty(fileOrPath) {
  const p = typeof fileOrPath === 'string'
    ? fileOrPath
    : (fileOrPath.relativePath || fileOrPath.path || '');
  return THIRD_PARTY_PATH_RE.test(p) || KNOWN_THIRD_PARTY_DIR_RE.test(p);
}

/**
 * 过滤文件列表，移除第三方库文件
 *
 * @param {object[]} files — 文件对象列表 [{ relativePath, ... }]
 * @returns {object[]} 过滤后的文件列表
 */
export function filterThirdParty(files) {
  return files.filter(f => !isThirdParty(f));
}
