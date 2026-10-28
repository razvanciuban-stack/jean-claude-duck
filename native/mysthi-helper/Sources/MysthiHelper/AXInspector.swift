import AppKit
import ApplicationServices

/// Frontmost-app context attached to every captured action.
struct AppContext: Equatable {
    var bundleId: String?
    var appName: String?
    var window: String?
    var url: String?

    /// Fields merged into click / shortcut / typed / app lines.
    var fields: [String: Any] {
        ["bundleId": jsonValue(bundleId), "appName": jsonValue(appName),
         "window": jsonValue(window), "url": jsonValue(url)]
    }
}

func jsonValue(_ s: String?) -> Any { s.map { $0 as Any } ?? NSNull() }

/// Accessibility queries: element under an action, focused field, browser URL, terminal line.
/// Never reads `AXValue` except for the terminal last-line case, and never for secure fields.
@MainActor
enum AXInspector {
    static let browserBundles: Set<String> = [
        "com.apple.Safari", "com.google.Chrome", "company.thebrowser.Browser",
        "org.mozilla.firefox", "com.microsoft.edgemac", "com.brave.Browser",
    ]
    static let chromiumBundles: Set<String> = [
        "com.google.Chrome", "company.thebrowser.Browser", "com.microsoft.edgemac", "com.brave.Browser",
    ]
    static let terminalBundles: Set<String> = [
        "com.apple.Terminal", "com.googlecode.iterm2", "dev.warp.Warp-Stable",
    ]
    /// Code editors with integrated terminals (VS Code, Insiders, Cursor, VSCodium, Zed). Electron editors
    /// only expose a useful AX tree once AXManualAccessibility is set, like Chromium browsers.
    static let editorBundles: Set<String> = [
        "com.microsoft.VSCode", "com.microsoft.VSCodeInsiders", "com.todesktop.230313mzl4w4u92",
        "com.vscodium", "dev.zed.Zed",
    ]
    static let menuRoles: Set<String> = ["AXMenuItem", "AXMenu", "AXMenuBarItem"]

    private static let systemWide: AXUIElement = {
        let el = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(el, 0.25)
        return el
    }()

    private static var manualAXEnabledPids: Set<pid_t> = []
    /// Cache of the located AXWebArea. Only reused for the same window element and the same non-nil
    /// title (a tab switch changes the title); anything else re-resolves.
    private static var webAreaCache: (pid: pid_t, window: AXUIElement, title: String, element: AXUIElement)?

    // MARK: - Primitive accessors

    static func attribute(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
        return value
    }

    static func string(_ el: AXUIElement, _ name: String) -> String? {
        guard let s = attribute(el, name) as? String, !s.isEmpty else { return nil }
        return s
    }

    static func element(_ el: AXUIElement, _ name: String) -> AXUIElement? {
        guard let v = attribute(el, name), CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
        return (v as! AXUIElement)
    }

    static func children(_ el: AXUIElement) -> [AXUIElement] {
        guard let arr = attribute(el, kAXChildrenAttribute as String) as? [AnyObject] else { return [] }
        return arr.compactMap { obj in
            CFGetTypeID(obj) == AXUIElementGetTypeID() ? (obj as! AXUIElement) : nil
        }
    }

    static func pid(of el: AXUIElement) -> pid_t? {
        var pid: pid_t = 0
        return AXUIElementGetPid(el, &pid) == .success ? pid : nil
    }

    // MARK: - Focus / hit testing

    static func focusedElement() -> AXUIElement? {
        element(systemWide, kAXFocusedUIElementAttribute as String)
    }

    static func element(at point: CGPoint) -> AXUIElement? {
        var el: AXUIElement?
        guard AXUIElementCopyElementAtPosition(systemWide, Float(point.x), Float(point.y), &el) == .success else {
            return nil
        }
        return el
    }

    /// Fails closed: only a definite answer counts as not secure. A successful read of a different
    /// subrole, or `.noValue` / `.attributeUnsupported`, means not secure; any other AX error
    /// (timeout, cannot complete, invalid element, API disabled, ...) is treated as secure.
    static func isSecure(_ el: AXUIElement) -> Bool {
        var value: CFTypeRef?
        switch AXUIElementCopyAttributeValue(el, kAXSubroleAttribute as CFString, &value) {
        case .success:
            return (value as? String) == "AXSecureTextField"
        case .noValue, .attributeUnsupported:
            return false
        default:
            return true
        }
    }

    // MARK: - Click target

    static func clickTarget(_ el: AXUIElement?) -> [String: Any] {
        guard let el else {
            return ["role": NSNull(), "subrole": NSNull(), "title": NSNull(), "description": NSNull(), "menuPath": NSNull()]
        }
        let path = menuPath(el)
        return [
            "role": jsonValue(string(el, kAXRoleAttribute as String)),
            "subrole": jsonValue(string(el, kAXSubroleAttribute as String)),
            "title": jsonValue(string(el, kAXTitleAttribute as String)),
            "description": jsonValue(string(el, kAXDescriptionAttribute as String)),
            "menuPath": path.map { $0 as Any } ?? NSNull(),
        ]
    }

    /// Walks AXParent while the role is a menu role; returns titles root-first, or nil if not a menu element.
    static func menuPath(_ el: AXUIElement) -> [String]? {
        var titles: [String] = []
        var current: AXUIElement? = el
        var depth = 0
        var sawMenu = false
        while let node = current, depth < 25,
              let role = string(node, kAXRoleAttribute as String), menuRoles.contains(role) {
            sawMenu = true
            if role != "AXMenu", let title = string(node, kAXTitleAttribute as String) {
                titles.append(title)
            }
            current = element(node, kAXParentAttribute as String)
            depth += 1
        }
        return sawMenu ? titles.reversed() : nil
    }

    // MARK: - Focused field

    static func fieldInfo(_ el: AXUIElement) -> [String: Any] {
        [
            "role": jsonValue(string(el, kAXRoleAttribute as String)),
            "title": jsonValue(string(el, kAXTitleAttribute as String)),
            "placeholder": jsonValue(string(el, kAXPlaceholderValueAttribute as String)),
            "description": jsonValue(string(el, kAXDescriptionAttribute as String)),
        ]
    }

    static func isTerminal(bundleId: String?, element el: AXUIElement) -> Bool {
        if let bundleId, terminalBundles.contains(bundleId) { return true }
        for name in [kAXDescriptionAttribute as String, kAXTitleAttribute as String] {
            if let label = string(el, name), label.range(of: "terminal", options: .caseInsensitive) != nil {
                return true
            }
        }
        return false
    }

    /// Last non-empty line of the focused text area's AXValue. Callers must never pass a secure field.
    static func terminalLastLine(_ el: AXUIElement) -> String? {
        guard !isSecure(el), let value = attribute(el, kAXValueAttribute as String) as? String else { return nil }
        for line in value.split(omittingEmptySubsequences: true, whereSeparator: \.isNewline).reversed() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if !trimmed.isEmpty { return trimmed }
        }
        return nil
    }

    // MARK: - App context

    static func frontmostContext() -> (context: AppContext, pid: pid_t?) {
        guard let app = NSWorkspace.shared.frontmostApplication else { return (AppContext(), nil) }
        return (context(for: app), app.processIdentifier)
    }

    static func context(forPid pid: pid_t) -> AppContext {
        guard let app = NSRunningApplication(processIdentifier: pid) else { return frontmostContext().context }
        return context(for: app)
    }

    static func context(for app: NSRunningApplication) -> AppContext {
        let pid = app.processIdentifier
        let appEl = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(appEl, 0.25)
        if let bundleId = app.bundleIdentifier, editorBundles.contains(bundleId) {
            enableManualAccessibility(appEl, pid: pid)
        }
        let window = element(appEl, kAXFocusedWindowAttribute as String)
        let title = window.flatMap { string($0, kAXTitleAttribute as String) }
        var url: String?
        if let bundleId = app.bundleIdentifier, browserBundles.contains(bundleId), let window {
            url = browserURL(bundleId: bundleId, pid: pid, appElement: appEl, window: window, title: title)
        }
        return AppContext(bundleId: app.bundleIdentifier, appName: app.localizedName, window: title, url: url)
    }

    // MARK: - Browser URL

    static func browserURL(bundleId: String, pid: pid_t, appElement: AXUIElement,
                           window: AXUIElement, title: String?) -> String? {
        if bundleId == "com.apple.Safari", let doc = string(window, kAXDocumentAttribute as String) {
            return doc
        }
        if chromiumBundles.contains(bundleId) {
            enableManualAccessibility(appElement, pid: pid)
        }
        if let cache = webAreaCache, let title, cache.pid == pid, cache.title == title,
           CFEqual(cache.window, window), let url = urlAttribute(cache.element) {
            return url
        }
        webAreaCache = nil
        guard let webArea = findWebArea(in: window) else { return nil }
        // Confirm the window/title didn't change while we searched; if unsure, report no URL.
        let titleNow = string(window, kAXTitleAttribute as String)
        guard let title, titleNow == title,
              let focusedNow = element(appElement, kAXFocusedWindowAttribute as String),
              CFEqual(focusedNow, window) else { return nil }
        webAreaCache = (pid, window, title, webArea)
        return urlAttribute(webArea)
    }

    /// Chromium / Electron only expose their AX tree to clients that ask for it; set once per process.
    private static func enableManualAccessibility(_ appElement: AXUIElement, pid: pid_t) {
        guard !manualAXEnabledPids.contains(pid) else { return }
        AXUIElementSetAttributeValue(appElement, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        manualAXEnabledPids.insert(pid)
    }

    private static func urlAttribute(_ el: AXUIElement) -> String? {
        guard let v = attribute(el, kAXURLAttribute as String) else { return nil }
        if let url = v as? URL { return url.absoluteString }
        return v as? String
    }

    /// Breadth-first search for the first AXWebArea, bounded so a huge tree can't stall the main thread.
    private static func findWebArea(in root: AXUIElement) -> AXUIElement? {
        var queue: [AXUIElement] = [root]
        var index = 0
        while index < queue.count, index < 600 {
            let node = queue[index]
            index += 1
            if string(node, kAXRoleAttribute as String) == "AXWebArea" { return node }
            queue.append(contentsOf: children(node))
        }
        return nil
    }
}
