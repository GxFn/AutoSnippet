import AppKit
import Foundation
import Darwin

/**
 * AutoSnippet Native UI Helper (macOS)
 * 提供高级原生列表和预览窗口，支持代码高亮。
 */

// MARK: - 语法高亮

struct SyntaxHighlighter {
    static let keywords = ["func", "var", "let", "if", "else", "guard", "return", "import", "class", "struct", "enum", "protocol", "extension", "private", "public", "internal", "fileprivate", "static", "override", "init", "deinit", "self", "super", "nil", "true", "false", "for", "while", "repeat", "switch", "case", "default", "break", "continue", "fallthrough", "where", "in", "throws", "throw", "try", "catch", "async", "await", "typealias", "associatedtype", "weak", "unowned", "lazy", "final", "required", "convenience", "mutating", "nonmutating", "open", "inout", "some", "any",
        // Objective-C
        "@interface", "@implementation", "@end", "@property", "@synthesize", "@dynamic", "@class", "@protocol", "@optional", "@required", "@public", "@private", "@protected", "@package", "@selector", "@encode", "@synchronized", "@autoreleasepool", "@try", "@catch", "@finally", "@throw", "YES", "NO", "NULL", "nil", "self", "super", "id", "Class", "SEL", "IMP", "BOOL", "instancetype", "void", "char", "short", "int", "long", "float", "double", "signed", "unsigned", "const", "static", "extern", "auto", "register", "volatile", "inline", "restrict", "typedef", "sizeof", "typeof", "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "goto", "struct", "union", "enum",
        // TypeScript/JavaScript
        "function", "const", "async", "await", "new", "this", "typeof", "instanceof", "export", "import", "from", "as", "default", "extends", "implements", "interface", "type", "namespace", "module", "declare", "abstract", "readonly", "keyof", "infer", "never", "unknown", "any", "void", "null", "undefined", "number", "string", "boolean", "symbol", "bigint", "object"
    ]
    
    static let typeKeywords = ["String", "Int", "Double", "Float", "Bool", "Array", "Dictionary", "Set", "Optional", "Any", "AnyObject", "Void", "Never", "Error", "Result", "URL", "Data", "Date", "UUID", "NSObject", "NSString", "NSNumber", "NSArray", "NSDictionary", "NSSet", "NSData", "NSDate", "NSURL", "CGFloat", "CGPoint", "CGSize", "CGRect", "UIView", "UIViewController", "UIButton", "UILabel", "UIImage", "UIColor", "NSView", "NSViewController", "NSButton", "NSTextField", "NSImage", "NSColor", "Promise", "Observable", "Subject"]
    
    static func highlight(_ code: String) -> NSAttributedString {
        let attributed = NSMutableAttributedString(string: code)
        let fullRange = NSRange(location: 0, length: code.utf16.count)
        
        // 基础样式 - SF Mono 字体 (Xcode 默认)
        let baseFont = NSFont(name: "SFMono-Regular", size: 13) ?? NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        // 普通文本 - Xcode 默认浅灰白色
        let baseColor = NSColor(calibratedRed: 0.83, green: 0.84, blue: 0.85, alpha: 1.0) // #D4D4D6
        attributed.addAttribute(.font, value: baseFont, range: fullRange)
        attributed.addAttribute(.foregroundColor, value: baseColor, range: fullRange)
        
        // 高亮注释 - Xcode 默认绿色 (系统 Green)
        let commentColor = NSColor(calibratedRed: 0.42, green: 0.75, blue: 0.31, alpha: 1.0) // #6BBF4F
        highlightPattern(attributed, pattern: "//.*$", color: commentColor, options: .anchorsMatchLines)
        highlightPattern(attributed, pattern: "/\\*[\\s\\S]*?\\*/", color: commentColor)
        
        // 高亮字符串 - Xcode 默认橙红色 (系统 Red/Orange 混合)
        let stringColor = NSColor(calibratedRed: 0.98, green: 0.42, blue: 0.33, alpha: 1.0) // #FA6B54
        highlightPattern(attributed, pattern: "\"(?:[^\"\\\\]|\\\\.)*\"", color: stringColor)
        highlightPattern(attributed, pattern: "'(?:[^'\\\\]|\\\\.)*'", color: stringColor)
        highlightPattern(attributed, pattern: "@\"(?:[^\"\\\\]|\\\\.)*\"", color: stringColor) // ObjC string
        
        // 高亮数字 - Xcode 默认紫色 (Light Purple)
        let numberColor = NSColor(calibratedRed: 0.69, green: 0.54, blue: 0.89, alpha: 1.0) // #B08AE3
        highlightPattern(attributed, pattern: "\\b\\d+\\.?\\d*\\b", color: numberColor)
        
        // 高亮类型关键字 - Xcode 默认青绿色 (Teal/Cyan)
        let typeColor = NSColor(calibratedRed: 0.40, green: 0.84, blue: 0.89, alpha: 1.0) // #66D7E3
        for keyword in typeKeywords {
            highlightWord(attributed, word: keyword, color: typeColor)
        }
        
        // 高亮关键字 - Xcode 默认粉紫色 (Magenta/Pink)
        let keywordColor = NSColor(calibratedRed: 0.98, green: 0.42, blue: 0.69, alpha: 1.0) // #FA6BB0
        // Objective-C @ 前缀关键字 - 使用浅棕色
        let atKeywordColor = NSColor(calibratedRed: 0.83, green: 0.60, blue: 0.45, alpha: 1.0) // #D49973
        for keyword in keywords {
            if keyword.hasPrefix("@") {
                highlightPattern(attributed, pattern: "\(keyword)\\b", color: atKeywordColor)
            } else {
                highlightWord(attributed, word: keyword, color: keywordColor)
            }
        }
        
        return attributed
    }
    
    private static func highlightPattern(_ attributed: NSMutableAttributedString, pattern: String, color: NSColor, options: NSRegularExpression.Options = []) {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return }
        let string = attributed.string
        let range = NSRange(location: 0, length: string.utf16.count)
        
        for match in regex.matches(in: string, options: [], range: range) {
            attributed.addAttribute(.foregroundColor, value: color, range: match.range)
        }
    }
    
    private static func highlightWord(_ attributed: NSMutableAttributedString, word: String, color: NSColor) {
        let pattern = "\\b\(NSRegularExpression.escapedPattern(for: word))\\b"
        highlightPattern(attributed, pattern: pattern, color: color)
    }
}

// MARK: - List Selection Window

class ListSelectionWindowController: NSObject, NSTableViewDataSource, NSTableViewDelegate {
    var items: [String] = []
    var selectedIndex: Int = -1
    private var tableView: NSTableView!
    private var panel: NSPanel!
    
    var filteredItems: [String] = []
    var searchField: NSSearchField!
    
    func show(items: [String], title: String, prompt: String) -> Int {
        self.items = items
        self.filteredItems = items
        self.selectedIndex = 0
        
        // 创建面板
        let panelWidth: CGFloat = 650
        let panelHeight: CGFloat = min(CGFloat(items.count * 32 + 200), 600)
        
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight),
            styleMask: [.titled, .closable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.title = title
        panel.level = .floating
        panel.center()
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        
        // 模糊背景
        let visualEffect = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight))
        visualEffect.material = .hudWindow
        visualEffect.blendingMode = .behindWindow
        visualEffect.state = .active
        visualEffect.autoresizingMask = [.width, .height]
        panel.contentView = visualEffect
        
        let contentView = NSView(frame: NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight))
        contentView.autoresizingMask = [.width, .height]
        visualEffect.addSubview(contentView)
        
        // 提示文本 - 改为标题样式
        let promptLabel = NSTextField(labelWithString: prompt)
        promptLabel.font = NSFont.systemFont(ofSize: 13, weight: .medium)
        promptLabel.textColor = .secondaryLabelColor
        promptLabel.frame = NSRect(x: 20, y: panelHeight - 55, width: panelWidth - 40, height: 20)
        promptLabel.autoresizingMask = [.width, .minYMargin]
        contentView.addSubview(promptLabel)
        
        // 搜索框
        searchField = NSSearchField(frame: NSRect(x: 20, y: panelHeight - 95, width: panelWidth - 40, height: 28))
        searchField.placeholderString = "搜索..."
        searchField.autoresizingMask = [.width, .minYMargin]
        searchField.target = self
        searchField.action = #selector(searchFieldDidChange)
        searchField.font = NSFont.systemFont(ofSize: 13)
        contentView.addSubview(searchField)
        
        // 创建表格
        let scrollView = NSScrollView(frame: NSRect(x: 20, y: 60, width: panelWidth - 40, height: panelHeight - 175))
        scrollView.hasVerticalScroller = true
        scrollView.borderType = .noBorder
        scrollView.autoresizingMask = [.width, .height]
        scrollView.wantsLayer = true
        scrollView.layer?.cornerRadius = 8
        scrollView.layer?.masksToBounds = true
        
        tableView = NSTableView()
        tableView.headerView = nil
        tableView.rowHeight = 36
        tableView.intercellSpacing = NSSize(width: 0, height: 1)
        tableView.backgroundColor = NSColor(calibratedWhite: 0.12, alpha: 0.5)
        tableView.usesAlternatingRowBackgroundColors = false
        tableView.selectionHighlightStyle = .regular
        tableView.doubleAction = #selector(doubleClicked)
        tableView.target = self
        
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("item"))
        column.width = panelWidth - 60
        tableView.addTableColumn(column)
        
        tableView.dataSource = self
        tableView.delegate = self
        
        scrollView.documentView = tableView
        contentView.addSubview(scrollView)
        
        // 按钮
        let cancelButton = NSButton(title: "取消", target: self, action: #selector(cancelClicked))
        cancelButton.bezelStyle = .rounded
        cancelButton.frame = NSRect(x: panelWidth - 200, y: 15, width: 90, height: 32)
        cancelButton.keyEquivalent = "\u{1b}" // Escape
        cancelButton.wantsLayer = true
        cancelButton.layer?.cornerRadius = 6
        cancelButton.autoresizingMask = [.minXMargin, .maxYMargin]
        contentView.addSubview(cancelButton)
        
        let okButton = NSButton(title: "确定", target: self, action: #selector(okClicked))
        okButton.bezelStyle = .rounded
        okButton.frame = NSRect(x: panelWidth - 100, y: 15, width: 90, height: 32)
        okButton.keyEquivalent = "\r" // Enter
        okButton.wantsLayer = true
        okButton.layer?.cornerRadius = 6
        okButton.layer?.backgroundColor = NSColor.controlAccentColor.cgColor
        okButton.contentTintColor = .white
        okButton.autoresizingMask = [.minXMargin, .maxYMargin]
        contentView.addSubview(okButton)
        
        // 显示并运行
        tableView.reloadData()
        if !filteredItems.isEmpty {
            tableView.selectRowIndexes(IndexSet(integer: 0), byExtendingSelection: false)
        }
        
        // 淡入动画
        panel.alphaValue = 0
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(searchField)
        
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.2
            panel.animator().alphaValue = 1.0
        })
        
        NSApp.runModal(for: panel)
        
        return selectedIndex
    }
    
    // MARK: - 搜索功能
    
    @objc func searchFieldDidChange() {
        let searchText = searchField.stringValue.lowercased()
        if searchText.isEmpty {
            filteredItems = items
        } else {
            filteredItems = items.filter { $0.lowercased().contains(searchText) }
        }
        tableView.reloadData()
        if !filteredItems.isEmpty {
            tableView.selectRowIndexes(IndexSet(integer: 0), byExtendingSelection: false)
            selectedIndex = 0
        }
    }
    
    // MARK: - NSTableViewDataSource
    
    func numberOfRows(in tableView: NSTableView) -> Int {
        return filteredItems.count
    }
    
    // MARK: - NSTableViewDelegate
    
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let cellIdentifier = NSUserInterfaceItemIdentifier("ItemCell")
        
        var cellView = tableView.makeView(withIdentifier: cellIdentifier, owner: nil) as? NSTableCellView
        if cellView == nil {
            cellView = NSTableCellView()
            cellView?.identifier = cellIdentifier
            
            // 图标
            let iconView = NSImageView()
            if #available(macOS 11.0, *) {
                iconView.image = NSImage(systemSymbolName: "doc.text", accessibilityDescription: nil)
            }
            iconView.translatesAutoresizingMaskIntoConstraints = false
            cellView?.addSubview(iconView)
            cellView?.imageView = iconView
            
            let textField = NSTextField(labelWithString: "")
            textField.font = NSFont.systemFont(ofSize: 13)
            textField.lineBreakMode = .byTruncatingMiddle
            textField.translatesAutoresizingMaskIntoConstraints = false
            cellView?.addSubview(textField)
            cellView?.textField = textField
            
            NSLayoutConstraint.activate([
                iconView.leadingAnchor.constraint(equalTo: cellView!.leadingAnchor, constant: 12),
                iconView.centerYAnchor.constraint(equalTo: cellView!.centerYAnchor),
                iconView.widthAnchor.constraint(equalToConstant: 16),
                iconView.heightAnchor.constraint(equalToConstant: 16),
                textField.leadingAnchor.constraint(equalTo: iconView.trailingAnchor, constant: 10),
                textField.trailingAnchor.constraint(equalTo: cellView!.trailingAnchor, constant: -12),
                textField.centerYAnchor.constraint(equalTo: cellView!.centerYAnchor)
            ])
        }
        
        cellView?.textField?.stringValue = filteredItems[row]
        return cellView
    }
    
    func tableViewSelectionDidChange(_ notification: Notification) {
        selectedIndex = tableView.selectedRow
    }
    
    @objc func doubleClicked() {
        if tableView.clickedRow >= 0 {
            selectedIndex = tableView.clickedRow
            panel.close()
            NSApp.stopModal()
        }
    }
    
    @objc func okClicked() {
        selectedIndex = tableView.selectedRow
        panel.close()
        NSApp.stopModal()
    }
    
    @objc func cancelClicked() {
        selectedIndex = -1
        panel.close()
        NSApp.stopModal()
    }
}

// MARK: - Code Preview Window

class CodePreviewWindowController {
    func show(title: String, code: String) -> Bool {
        let panelWidth: CGFloat = 900
        let panelHeight: CGFloat = 520
        
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight),
            styleMask: [.titled, .closable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.title = "代码预览"
        panel.level = .floating
        panel.center()
        panel.minSize = NSSize(width: 400, height: 300)
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        
        // 模糊背景
        let visualEffect = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight))
        visualEffect.material = .hudWindow
        visualEffect.blendingMode = .behindWindow
        visualEffect.state = .active
        visualEffect.autoresizingMask = [.width, .height]
        panel.contentView = visualEffect
        
        let contentView = NSView(frame: NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight))
        contentView.autoresizingMask = [.width, .height]
        visualEffect.addSubview(contentView)
        
        // 标题 - 相似度百分比前置
        let titleText: String
        // 使用正则提取相似度百分比，例如 "xxx.md (47%)" -> "(47%) xxx.md"
        if let regex = try? NSRegularExpression(pattern: "^(.+?)\\s*\\((\\d+%)\\)$", options: []),
           let match = regex.firstMatch(in: title, options: [], range: NSRange(title.startIndex..., in: title)),
           let nameRange = Range(match.range(at: 1), in: title),
           let percentRange = Range(match.range(at: 2), in: title) {
            let name = String(title[nameRange])
            let percent = String(title[percentRange])
            titleText = "即将插入: (\(percent)) \(name)"
        } else {
            titleText = "即将插入: \(title)"
        }
        
        let titleLabel = NSTextField(labelWithString: titleText)
        titleLabel.font = NSFont.systemFont(ofSize: 14, weight: .semibold)
        titleLabel.textColor = .labelColor
        titleLabel.frame = NSRect(x: 20, y: panelHeight - 55, width: panelWidth - 40, height: 20)
        titleLabel.autoresizingMask = [.width, .minYMargin]
        titleLabel.lineBreakMode = .byTruncatingMiddle
        contentView.addSubview(titleLabel)
        
        // 代码区域（带语法高亮）
        let scrollView = NSScrollView(frame: NSRect(x: 20, y: 60, width: panelWidth - 40, height: panelHeight - 135))
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true
        scrollView.borderType = .noBorder
        scrollView.autoresizingMask = [.width, .height]
        scrollView.wantsLayer = true
        scrollView.layer?.cornerRadius = 8
        scrollView.layer?.masksToBounds = true
        
        let textView = NSTextView(frame: scrollView.bounds)
        textView.isEditable = false
        textView.isSelectable = true
        textView.backgroundColor = NSColor(calibratedWhite: 0.08, alpha: 0.9)
        textView.textContainerInset = NSSize(width: 16, height: 16)
        textView.isHorizontallyResizable = true
        textView.isVerticallyResizable = true
        textView.textContainer?.widthTracksTextView = false
        textView.textContainer?.heightTracksTextView = false
        textView.textContainer?.containerSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.autoresizingMask = []
        
        // 增加右侧边距，避免滚动条遮挡代码
        textView.textContainer?.lineFragmentPadding = 10 // 左右各 10px
        if let textContainer = textView.textContainer {
            // 设置右侧额外边距
            textContainer.size = NSSize(width: scrollView.bounds.width - 40, height: CGFloat.greatestFiniteMagnitude)
        }
        
        // 应用语法高亮
        let processedCode = code.replacingOccurrences(of: "\\n", with: "\n")
        let highlightedCode = SyntaxHighlighter.highlight(processedCode)
        textView.textStorage?.setAttributedString(highlightedCode)
        
        scrollView.documentView = textView
        contentView.addSubview(scrollView)
        
        // 按钮
        let cancelButton = NSButton(title: "取消", target: nil, action: nil)
        cancelButton.bezelStyle = .rounded
        cancelButton.frame = NSRect(x: panelWidth - 210, y: 15, width: 90, height: 32)
        cancelButton.keyEquivalent = "\u{1b}"
        cancelButton.autoresizingMask = [.minXMargin, .maxYMargin]
        cancelButton.wantsLayer = true
        cancelButton.layer?.cornerRadius = 6
        contentView.addSubview(cancelButton)
        
        let okButton = NSButton(title: "立即插入", target: nil, action: nil)
        okButton.bezelStyle = .rounded
        okButton.frame = NSRect(x: panelWidth - 110, y: 15, width: 90, height: 32)
        okButton.keyEquivalent = "\r"
        okButton.autoresizingMask = [.minXMargin, .maxYMargin]
        okButton.wantsLayer = true
        okButton.layer?.cornerRadius = 6
        contentView.addSubview(okButton)
        
        class ButtonHandler {
            var result = false
            var panel: NSPanel
            
            init(panel: NSPanel) {
                self.panel = panel
            }
            
            @objc func okClicked() {
                result = true
                panel.close()
                NSApp.stopModal()
            }
            
            @objc func cancelClicked() {
                result = false
                panel.close()
                NSApp.stopModal()
            }
        }
        
        let handler = ButtonHandler(panel: panel)
        cancelButton.target = handler
        cancelButton.action = #selector(ButtonHandler.cancelClicked)
        okButton.target = handler
        okButton.action = #selector(ButtonHandler.okClicked)
        
        // 淡入动画
        panel.alphaValue = 0
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.2
            panel.animator().alphaValue = 1.0
        })
        
        NSApp.runModal(for: panel)
        
        return handler.result
    }
}

// MARK: - Main

func printUsage() {
    print("Usage:")
    print("  native-ui list \"Title 1\" \"Title 2\" ...")
    print("  native-ui preview \"Title\" \"Code Content\"")
    fflush(stdout)
}

func handleList(_ items: [String]) {
    if items.isEmpty {
        fputs("native-ui list: 至少需要一个选项\n", stderr)
        fflush(stderr)
        exit(1)
    }
    
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    
    let controller = ListSelectionWindowController()
    let selectedIndex = controller.show(
        items: items,
        title: "AutoSnippet 搜索结果",
        prompt: "找到以下匹配项，请选择一个进行插入:"
    )
    
    if selectedIndex >= 0 {
        print(selectedIndex)
        exit(0)
    } else {
        exit(1)
    }
}

func handlePreview(_ args: [String]) {
    guard args.count >= 2 else {
        fputs("native-ui preview: 需要 title 和 code 两个参数\n", stderr)
        fflush(stderr)
        exit(1)
    }
    
    let title = args[0]
    let code = args[1]
    
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    
    let controller = CodePreviewWindowController()
    let confirmed = controller.show(title: title, code: code)
    
    if confirmed {
        exit(0)
    } else {
        exit(1)
    }
}

// Main logic
let args = CommandLine.arguments
guard args.count > 1 else {
    printUsage()
    exit(1)
}

let command = args[1]
if command == "--help" || command == "-h" {
    printUsage()
    exit(0)
}

switch command {
case "list":
    handleList(Array(args.dropFirst(2)))
case "preview":
    handlePreview(Array(args.dropFirst(2)))
default:
    fputs("未知子命令: \(command)\n", stderr)
    printUsage()
    exit(1)
}
