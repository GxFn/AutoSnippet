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
        
        // 基础样式 - 增加字号到 14
        let baseFont = NSFont.monospacedSystemFont(ofSize: 14, weight: .regular)
        let baseColor = NSColor.textColor
        attributed.addAttribute(.font, value: baseFont, range: fullRange)
        attributed.addAttribute(.foregroundColor, value: baseColor, range: fullRange)
        
        // 高亮注释 (// 和 /* */)
        highlightPattern(attributed, pattern: "//.*$", color: NSColor.systemGreen, options: .anchorsMatchLines)
        highlightPattern(attributed, pattern: "/\\*[\\s\\S]*?\\*/", color: NSColor.systemGreen)
        
        // 高亮字符串 ("..." 和 '...') - 使用柔和的橙红色
        let stringColor = NSColor(calibratedRed: 0.95, green: 0.55, blue: 0.45, alpha: 1.0)
        highlightPattern(attributed, pattern: "\"(?:[^\"\\\\]|\\\\.)*\"", color: stringColor)
        highlightPattern(attributed, pattern: "'(?:[^'\\\\]|\\\\.)*'", color: stringColor)
        highlightPattern(attributed, pattern: "@\"(?:[^\"\\\\]|\\\\.)*\"", color: stringColor) // ObjC string
        
        // 高亮数字
        highlightPattern(attributed, pattern: "\\b\\d+\\.?\\d*\\b", color: NSColor.systemBlue)
        
        // 高亮类型关键字
        for keyword in typeKeywords {
            highlightWord(attributed, word: keyword, color: NSColor.systemPurple)
        }
        
        // 高亮关键字 - 使用柔和的颜色
        let keywordColor = NSColor(calibratedRed: 0.85, green: 0.50, blue: 0.70, alpha: 1.0) // 柔和的粉色
        let atKeywordColor = NSColor(calibratedRed: 0.95, green: 0.65, blue: 0.40, alpha: 1.0) // 柔和的橙色
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
    
    func show(items: [String], title: String, prompt: String) -> Int {
        self.items = items
        self.selectedIndex = 0
        
        // 创建面板
        let panelWidth: CGFloat = 650
        let panelHeight: CGFloat = min(CGFloat(items.count * 32 + 140), 550)
        
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        panel.title = title
        panel.level = .floating
        panel.center()
        
        // 主容器
        let contentView = NSView(frame: NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight))
        panel.contentView = contentView
        
        // 提示文本
        let promptLabel = NSTextField(labelWithString: prompt)
        promptLabel.font = NSFont.systemFont(ofSize: 13)
        promptLabel.textColor = .secondaryLabelColor
        promptLabel.frame = NSRect(x: 20, y: panelHeight - 40, width: panelWidth - 40, height: 20)
        contentView.addSubview(promptLabel)
        
        // 创建表格
        let scrollView = NSScrollView(frame: NSRect(x: 20, y: 60, width: panelWidth - 40, height: panelHeight - 120))
        scrollView.hasVerticalScroller = true
        scrollView.borderType = .bezelBorder
        scrollView.autoresizingMask = [.width, .height]
        
        tableView = NSTableView()
        tableView.headerView = nil
        tableView.rowHeight = 32
        tableView.intercellSpacing = NSSize(width: 0, height: 2)
        tableView.backgroundColor = .controlBackgroundColor
        tableView.usesAlternatingRowBackgroundColors = true
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
        cancelButton.frame = NSRect(x: panelWidth - 180, y: 15, width: 75, height: 32)
        cancelButton.keyEquivalent = "\u{1b}" // Escape
        contentView.addSubview(cancelButton)
        
        let okButton = NSButton(title: "确定", target: self, action: #selector(okClicked))
        okButton.bezelStyle = .rounded
        okButton.frame = NSRect(x: panelWidth - 95, y: 15, width: 75, height: 32)
        okButton.keyEquivalent = "\r" // Enter
        contentView.addSubview(okButton)
        
        // 显示并运行
        tableView.reloadData()
        tableView.selectRowIndexes(IndexSet(integer: 0), byExtendingSelection: false)
        
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(tableView)
        
        NSApp.runModal(for: panel)
        
        return selectedIndex
    }
    
    // MARK: - NSTableViewDataSource
    
    func numberOfRows(in tableView: NSTableView) -> Int {
        return items.count
    }
    
    // MARK: - NSTableViewDelegate
    
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let cellIdentifier = NSUserInterfaceItemIdentifier("ItemCell")
        
        var cellView = tableView.makeView(withIdentifier: cellIdentifier, owner: nil) as? NSTableCellView
        if cellView == nil {
            cellView = NSTableCellView()
            cellView?.identifier = cellIdentifier
            
            let textField = NSTextField(labelWithString: "")
            textField.font = NSFont.systemFont(ofSize: 13)
            textField.lineBreakMode = .byTruncatingTail
            textField.translatesAutoresizingMaskIntoConstraints = false
            cellView?.addSubview(textField)
            cellView?.textField = textField
            
            NSLayoutConstraint.activate([
                textField.leadingAnchor.constraint(equalTo: cellView!.leadingAnchor, constant: 8),
                textField.trailingAnchor.constraint(equalTo: cellView!.trailingAnchor, constant: -8),
                textField.centerYAnchor.constraint(equalTo: cellView!.centerYAnchor)
            ])
        }
        
        cellView?.textField?.stringValue = items[row]
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
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        panel.title = "代码预览"
        panel.level = .floating
        panel.center()
        panel.minSize = NSSize(width: 400, height: 300)
        
        let contentView = NSView(frame: NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight))
        panel.contentView = contentView
        
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
        titleLabel.font = NSFont.boldSystemFont(ofSize: 14)
        titleLabel.frame = NSRect(x: 20, y: panelHeight - 40, width: panelWidth - 40, height: 20)
        titleLabel.autoresizingMask = [.width, .minYMargin]
        titleLabel.lineBreakMode = .byTruncatingMiddle // 中间截断而不是尾部
        contentView.addSubview(titleLabel)
        
        // 代码区域（带语法高亮）
        let scrollView = NSScrollView(frame: NSRect(x: 20, y: 60, width: panelWidth - 40, height: panelHeight - 120))
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true
        scrollView.borderType = .bezelBorder
        scrollView.autoresizingMask = [.width, .height]
        
        let textView = NSTextView(frame: scrollView.bounds)
        textView.isEditable = false
        textView.isSelectable = true
        textView.backgroundColor = NSColor(calibratedWhite: 0.12, alpha: 1.0) // 深色背景
        textView.textContainerInset = NSSize(width: 10, height: 10) // 基础边距
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
        cancelButton.frame = NSRect(x: panelWidth - 200, y: 15, width: 85, height: 32)
        cancelButton.keyEquivalent = "\u{1b}"
        cancelButton.autoresizingMask = [.minXMargin, .maxYMargin]
        contentView.addSubview(cancelButton)
        
        let okButton = NSButton(title: "立即插入", target: nil, action: nil)
        okButton.bezelStyle = .rounded
        okButton.frame = NSRect(x: panelWidth - 105, y: 15, width: 85, height: 32)
        okButton.keyEquivalent = "\r"
        okButton.autoresizingMask = [.minXMargin, .maxYMargin]
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
        
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        
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
