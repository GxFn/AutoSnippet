import AppKit
import Foundation
import Darwin

/**
 * AutoSnippet Native UI Helper (macOS)
 * 提供高级原生列表和预览窗口，支持代码高亮。
 * 注意：SyntaxHighlighter 和 SearchItem 定义在 combined-window.swift 中，避免重复定义
 */

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
        // 使用 overlay 滚动条
        scrollView.scrollerStyle = .overlay
        scrollView.autohidesScrollers = true
        scrollView.scrollerKnobStyle = .light
        
        tableView = NSTableView()
        tableView.headerView = nil
        tableView.rowHeight = 52  // 增加行高以容纳两行标题
        tableView.intercellSpacing = NSSize(width: 0, height: 1)
        // Xcode 深色背景：#1F1F24
        tableView.backgroundColor = NSColor(calibratedRed: 0.12, green: 0.12, blue: 0.14, alpha: 1.0)
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
            
            let textField = NSTextField(labelWithString: "")
            textField.font = NSFont.systemFont(ofSize: 13)
            textField.lineBreakMode = .byWordWrapping  // 改为自动换行
            textField.maximumNumberOfLines = 2  // 最多显示两行
            textField.translatesAutoresizingMaskIntoConstraints = false
            cellView?.addSubview(textField)
            cellView?.textField = textField
            
            NSLayoutConstraint.activate([
                textField.leadingAnchor.constraint(equalTo: cellView!.leadingAnchor, constant: 12),
                textField.trailingAnchor.constraint(equalTo: cellView!.trailingAnchor, constant: -12),
                textField.topAnchor.constraint(equalTo: cellView!.topAnchor, constant: 8),
                textField.bottomAnchor.constraint(lessThanOrEqualTo: cellView!.bottomAnchor, constant: -8)
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
    enum PreviewResult {
        case confirmed      // 用户点击了“立即插入”
        case cancelled      // 用户点击了“取消”
        case returnToList   // 用户点击了“返回”
    }
    
    func show(title: String, code: String) -> PreviewResult {
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
        titleLabel.frame = NSRect(x: 20, y: panelHeight - 65, width: panelWidth - 40, height: 40)  // 增加高度到40，调整y位置
        titleLabel.autoresizingMask = [.width, .minYMargin]
        titleLabel.lineBreakMode = .byWordWrapping  // 改为自动换行
        titleLabel.maximumNumberOfLines = 2  // 最多显示两行
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
        // 设置 scrollView 背景色为 Xcode 深色
        scrollView.backgroundColor = NSColor(calibratedRed: 0.12, green: 0.12, blue: 0.14, alpha: 1.0)
        // 使用 overlay 滚动条
        scrollView.scrollerStyle = .overlay
        scrollView.autohidesScrollers = true
        scrollView.scrollerKnobStyle = .light
        scrollView.horizontalScrollElasticity = .automatic
        scrollView.verticalScrollElasticity = .automatic
        
        let textView = NSTextView(frame: scrollView.bounds)
        textView.isEditable = false
        textView.isSelectable = true
        // Xcode 深色背景：#1F1F24
        textView.backgroundColor = NSColor(calibratedRed: 0.12, green: 0.12, blue: 0.14, alpha: 1.0)
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
        let backButton = NSButton(title: "← 返回", target: nil, action: nil)
        backButton.bezelStyle = .rounded
        backButton.frame = NSRect(x: 20, y: 15, width: 90, height: 32)
        backButton.autoresizingMask = [.maxXMargin, .maxYMargin]
        backButton.wantsLayer = true
        backButton.layer?.cornerRadius = 6
        contentView.addSubview(backButton)
        
        let cancelButton = NSButton(title: "取消", target: nil, action: nil)
        cancelButton.bezelStyle = .rounded
        cancelButton.frame = NSRect(x: panelWidth - 310, y: 15, width: 90, height: 32)
        cancelButton.keyEquivalent = "\u{1b}"
        cancelButton.autoresizingMask = [.minXMargin, .maxYMargin]
        cancelButton.wantsLayer = true
        cancelButton.layer?.cornerRadius = 6
        contentView.addSubview(cancelButton)
        
        let copyButton = NSButton(title: "复制代码", target: nil, action: nil)
        copyButton.bezelStyle = .rounded
        copyButton.frame = NSRect(x: panelWidth - 210, y: 15, width: 90, height: 32)
        copyButton.autoresizingMask = [.minXMargin, .maxYMargin]
        copyButton.wantsLayer = true
        copyButton.layer?.cornerRadius = 6
        contentView.addSubview(copyButton)
        
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
            var shouldReturnToList = false  // 新增：标记是否需要返回列表
            var panel: NSPanel
            var codeText: String
            
            init(panel: NSPanel, codeText: String) {
                self.panel = panel
                self.codeText = codeText
            }
            
            @objc func okClicked() {
                // 插入时也只使用纯代码
                let pureCode = extractPureCode(codeText)
                let pasteboard = NSPasteboard.general
                pasteboard.clearContents()
                pasteboard.setString(pureCode, forType: .string)
                result = true
                panel.close()
                NSApp.stopModal()
            }
            
            @objc func cancelClicked() {
                result = false
                panel.close()
                NSApp.stopModal()
            }
            
            @objc func backClicked() {
                // 返回功能：设置标志并关闭窗口
                result = false
                shouldReturnToList = true
                panel.close()
                NSApp.stopModal()
            }
            
            @objc func copyClicked() {
                let pasteboard = NSPasteboard.general
                pasteboard.clearContents()
                // 只复制纯代码，去掉 markdown 代码块标记
                let pureCode = extractPureCode(codeText)
                pasteboard.setString(pureCode, forType: .string)
                print("✅ 代码已复制到剪贴板")
                // 复制后关闭窗口
                panel.close()
                NSApp.stopModal()
            }
            
            private func extractPureCode(_ code: String) -> String {
                var lines = code.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
                
                // 移除首尾的代码块标记（```swift、```等）
                while !lines.isEmpty && (lines.first?.trimmingCharacters(in: .whitespaces).starts(with: "```") ?? false) {
                    lines.removeFirst()
                }
                while !lines.isEmpty && (lines.last?.trimmingCharacters(in: .whitespaces).starts(with: "```") ?? false) {
                    lines.removeLast()
                }
                
                return lines.joined(separator: "\n")
            }
        }
        
        let handler = ButtonHandler(panel: panel, codeText: processedCode)
        backButton.target = handler
        backButton.action = #selector(ButtonHandler.backClicked)
        cancelButton.target = handler
        cancelButton.action = #selector(ButtonHandler.cancelClicked)
        copyButton.target = handler
        copyButton.action = #selector(ButtonHandler.copyClicked)
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
        
        // 根据状态返回不同的结果
        if handler.shouldReturnToList {
            return .returnToList
        } else if handler.result {
            return .confirmed
        } else {
            return .cancelled
        }
    }
}

// MARK: - Main

func printUsage() {
    print("Usage:")
    print("  native-ui list \"Title 1\" \"Title 2\" ...")
    print("  native-ui preview \"Title\" \"Code Content\"")
    print("  native-ui combined <keyword> <json_data>  # 新：组合窗口")
    fflush(stdout)
}

// MARK: - Combined Handler
// 注意：SearchItem 结构体定义在 combined-window.swift 中

func handleCombined(_ args: [String]) {
    guard args.count >= 2 else {
        fputs("native-ui combined: 需要 keyword 和 json_data 两个参数\n", stderr)
        fflush(stderr)
        exit(1)
    }
    
    let keyword = args[0]
    let jsonData = args[1]
    
    // 解析 JSON 数据
    guard let data = jsonData.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
        fputs("native-ui combined: JSON 解析失败\n", stderr)
        fflush(stderr)
        exit(1)
    }
    
    var items: [SearchItem] = []
    for item in json {
        if let title = item["title"] as? String, let code = item["code"] as? String {
            let explanation = item["explanation"] as? String ?? ""
            let groupSize = (item["groupSize"] as? NSNumber)?.intValue ?? 0
            items.append(SearchItem(title: title, code: code, explanation: explanation, groupSize: groupSize))
        }
    }
    
    if items.isEmpty {
        fputs("native-ui combined: 无有效数据\n", stderr)
        fflush(stderr)
        exit(1)
    }
    
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    
    let controller = CombinedSearchWindowController()
    let result = controller.show(items: items, keyword: keyword)
    
    switch result {
    case .confirmed(let index):
        print(index)
        exit(0)
    case .cancelled:
        exit(1)
    }
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
    let result = controller.show(title: title, code: code)
    
    switch result {
    case .confirmed:
        exit(0)  // 用户确认插入
    case .returnToList:
        exit(2)  // 用户要求返回列表
    case .cancelled:
        exit(1)  // 用户取消
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
case "combined":
    handleCombined(Array(args.dropFirst(2)))
default:
    fputs("未知子命令: \(command)\n", stderr)
    printUsage()
    exit(1)
}
