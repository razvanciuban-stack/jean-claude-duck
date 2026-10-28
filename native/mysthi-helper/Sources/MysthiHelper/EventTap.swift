import AppKit
import ApplicationServices
import Carbon.HIToolbox
import CoreGraphics

/// Plain values copied out of a CGEvent inside the tap callback.
struct RawEvent: Sendable {
    enum Kind: Sendable { case click, keyDown, tapDisabled }
    let kind: Kind
    let location: CGPoint
    let keyCode: Int64
    let flags: CGEventFlags
    /// Characters produced by the key (only collected for non-cmd/ctrl key downs).
    let chars: String?
}

/// C callback for the listen-only session tap. Runs on the main run loop, so it hops onto
/// the main actor synchronously and defers the AX work until after it returns.
private func tapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent,
                         userInfo: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    let raw: RawEvent?
    switch type {
    case .leftMouseDown, .rightMouseDown:
        raw = RawEvent(kind: .click, location: event.location, keyCode: 0, flags: event.flags, chars: nil)
    case .keyDown:
        let flags = event.flags
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        var chars: String?
        if !flags.contains(.maskCommand), !flags.contains(.maskControl) {
            var length = 0
            var buffer = [UniChar](repeating: 0, count: 8)
            event.keyboardGetUnicodeString(maxStringLength: 8, actualStringLength: &length, unicodeString: &buffer)
            chars = length > 0 ? String(utf16CodeUnits: buffer, count: length) : nil
        }
        raw = RawEvent(kind: .keyDown, location: .zero, keyCode: keyCode, flags: flags, chars: chars)
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        raw = RawEvent(kind: .tapDisabled, location: .zero, keyCode: 0, flags: [], chars: nil)
    default:
        raw = nil
    }
    if let raw {
        MainActor.assumeIsolated { CaptureController.shared?.receive(raw) }
    }
    return Unmanaged.passUnretained(event)
}

/// Global mouse/keyboard tap, typing aggregation, and frontmost app/window tracking.
@MainActor
final class CaptureController {
    static var shared: CaptureController?

    private static let typingPause: TimeInterval = 2.0
    private static let keyReturn: Int64 = 36, keyEnter: Int64 = 76, keyTab: Int64 = 48
    private static let keyDelete: Int64 = 51, keyForwardDelete: Int64 = 117

    private(set) var paused = false
    private var tap: CFMachPort?
    private var lastContext: AppContext?
    private var lastPermissions: Permissions.Status?
    private var typing: TypingBuffer?
    private var typingTimer: Timer?

    /// Keystrokes aggregated for one focused field. For a secure field `text` stays empty forever.
    private struct TypingBuffer {
        let element: AXUIElement
        let secure: Bool
        let isTerminal: Bool
        let ts: Int64
        let context: AppContext
        let field: [String: Any]
        var text: String = ""
        var keystrokes = 0
    }

    func start(initialPermissions: Permissions.Status) {
        lastPermissions = initialPermissions
        ensureTap()
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            MainActor.assumeIsolated { CaptureController.shared?.pollContext() }
        }
        Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
            MainActor.assumeIsolated { CaptureController.shared?.pollPermissions() }
        }
    }

    // MARK: - Tap lifecycle

    /// Creates the tap only once Input Monitoring is already granted, so creating it never prompts.
    func ensureTap() {
        guard tap == nil, CGPreflightListenEventAccess() else { return }
        let mask: CGEventMask = (1 << CGEventType.leftMouseDown.rawValue)
            | (1 << CGEventType.rightMouseDown.rawValue)
            | (1 << CGEventType.keyDown.rawValue)
        guard let port = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                                           options: .listenOnly, eventsOfInterest: mask,
                                           callback: tapCallback, userInfo: nil) else {
            Output.error("event tap could not be created")
            return
        }
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        tap = port
        CGEvent.tapEnable(tap: port, enable: !paused)
    }

    func pause() {
        paused = true
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        discardTyping()
    }

    func resume() {
        paused = false
        lastContext = nil // re-announce the current app on the next poll
        ensureTap()
        if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
    }

    // MARK: - Event intake

    func receive(_ raw: RawEvent) {
        if raw.kind == .tapDisabled {
            if !paused, let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return
        }
        guard !paused else { return }
        // Defer AX queries so the tap callback returns immediately; the main queue keeps FIFO order.
        DispatchQueue.main.async {
            MainActor.assumeIsolated { self.process(raw) }
        }
    }

    private func process(_ raw: RawEvent) {
        guard !paused else { return }
        switch raw.kind {
        case .click: handleClick(at: raw.location)
        case .keyDown: handleKeyDown(raw)
        case .tapDisabled: break
        }
    }

    private func handleClick(at point: CGPoint) {
        flushTyping()
        let el = AXInspector.element(at: point)
        let context = el.flatMap { AXInspector.pid(of: $0) }.map { AXInspector.context(forPid: $0) }
            ?? AXInspector.frontmostContext().context
        var line: [String: Any] = ["type": "click", "ts": nowMs(), "target": AXInspector.clickTarget(el)]
        line.merge(context.fields) { _, new in new }
        Output.emit(line)
    }

    private func handleKeyDown(_ raw: RawEvent) {
        let cmd = raw.flags.contains(.maskCommand)
        let ctrl = raw.flags.contains(.maskControl)
        let alt = raw.flags.contains(.maskAlternate)
        let printable = raw.chars.map(Self.isPrintable) ?? false

        // ⌘/⌃ always make a shortcut. ⌥ alone makes a shortcut only when it produces no printable
        // character: ⌥+letter types text (diacritics, symbols) and must go through the typing path so a
        // secure field discards it instead of leaking it as "alt+<key>".
        if cmd || ctrl || (alt && !printable) {
            emitShortcut(raw)
            return
        }

        if raw.keyCode == Self.keyReturn || raw.keyCode == Self.keyEnter || raw.keyCode == Self.keyTab {
            flushTyping()
            return
        }

        guard let field = AXInspector.focusedElement() else { return }
        if let current = typing, !CFEqual(current.element, field) {
            flushTyping()
        }
        if typing == nil {
            let secure = AXInspector.isSecure(field) || IsSecureEventInputEnabled()
            let (context, _) = AXInspector.frontmostContext()
            typing = TypingBuffer(
                element: field, secure: secure,
                isTerminal: AXInspector.isTerminal(bundleId: context.bundleId, element: field),
                ts: nowMs(), context: context, field: AXInspector.fieldInfo(field))
        }
        typing?.keystrokes += 1
        if typing?.secure == false {
            if raw.keyCode == Self.keyDelete || raw.keyCode == Self.keyForwardDelete {
                if typing?.text.isEmpty == false { typing?.text.removeLast() }
            } else if printable, let chars = raw.chars {
                typing?.text.append(chars)
            }
        }
        // Secure field: the keystroke's characters are dropped here and never stored.
        restartTypingTimer()
    }

    private func emitShortcut(_ raw: RawEvent) {
        var parts: [String] = []
        if raw.flags.contains(.maskCommand) { parts.append("cmd") }
        if raw.flags.contains(.maskControl) { parts.append("ctrl") }
        if raw.flags.contains(.maskAlternate) { parts.append("alt") }
        if raw.flags.contains(.maskShift) { parts.append("shift") }
        parts.append(KeyNames.name(for: raw.keyCode))
        var line: [String: Any] = ["type": "shortcut", "ts": nowMs(), "keys": parts.joined(separator: "+")]
        line.merge(AXInspector.frontmostContext().context.fields) { _, new in new }
        Output.emit(line)
    }

    private static func isPrintable(_ s: String) -> Bool {
        !s.isEmpty && !s.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
            && !s.unicodeScalars.contains { (0xF700...0xF8FF).contains($0.value) } // AppKit function-key range
    }

    // MARK: - Typing flush

    private func restartTypingTimer() {
        typingTimer?.invalidate()
        typingTimer = Timer.scheduledTimer(withTimeInterval: Self.typingPause, repeats: false) { _ in
            MainActor.assumeIsolated { CaptureController.shared?.flushTyping() }
        }
    }

    func flushTyping() {
        typingTimer?.invalidate()
        typingTimer = nil
        guard let buffer = typing else { return }
        typing = nil
        guard buffer.secure || !buffer.text.isEmpty else { return }
        let visibleLine: String? = (buffer.isTerminal && !buffer.secure)
            ? AXInspector.terminalLastLine(buffer.element) : nil
        var line: [String: Any] = [
            "type": "typed", "ts": buffer.ts,
            "text": buffer.secure ? NSNull() : buffer.text as Any,
            "secure": buffer.secure,
            "field": buffer.field,
            "isTerminal": buffer.isTerminal,
            "visibleLine": jsonValue(visibleLine),
        ]
        line.merge(buffer.context.fields) { _, new in new }
        Output.emit(line)
    }

    private func discardTyping() {
        typingTimer?.invalidate()
        typingTimer = nil
        typing = nil
    }

    // MARK: - Polling

    private func pollContext() {
        guard !paused else { return }
        let (context, _) = AXInspector.frontmostContext()
        guard context != lastContext else { return }
        if let last = lastContext, last.bundleId != context.bundleId || last.window != context.window {
            flushTyping()
        }
        lastContext = context
        var line: [String: Any] = ["type": "app"]
        line.merge(context.fields) { _, new in new }
        Output.emit(line)
    }

    /// Re-announces permissions when they change (e.g. granted in System Settings) and creates the tap
    /// as soon as Input Monitoring becomes available. Preflight only, never prompts.
    private func pollPermissions() {
        let status = Permissions.status()
        if status != lastPermissions {
            lastPermissions = status
            Output.emit(status.json)
        }
        ensureTap()
    }
}

/// Layout-aware key names for shortcuts ("e", "return", "f5").
@MainActor
enum KeyNames {
    private static let special: [Int64: String] = [
        36: "return", 76: "enter", 48: "tab", 49: "space", 51: "delete", 117: "forwarddelete", 53: "escape",
        123: "left", 124: "right", 125: "down", 126: "up", 115: "home", 119: "end", 116: "pageup", 121: "pagedown",
        122: "f1", 120: "f2", 99: "f3", 118: "f4", 96: "f5", 97: "f6", 98: "f7", 100: "f8",
        101: "f9", 109: "f10", 103: "f11", 111: "f12",
    ]

    static func name(for keyCode: Int64) -> String {
        if let s = special[keyCode] { return s }
        guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
              let ptr = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else {
            return "key\(keyCode)"
        }
        let layoutData = Unmanaged<CFData>.fromOpaque(ptr).takeUnretainedValue() as Data
        var deadKeyState: UInt32 = 0
        var length = 0
        var chars = [UniChar](repeating: 0, count: 4)
        let status = layoutData.withUnsafeBytes { raw -> OSStatus in
            guard let layout = raw.bindMemory(to: UCKeyboardLayout.self).baseAddress else { return -1 }
            return UCKeyTranslate(layout, UInt16(keyCode), UInt16(kUCKeyActionDisplay), 0,
                                  UInt32(LMGetKbdType()), OptionBits(1 << kUCKeyTranslateNoDeadKeysBit),
                                  &deadKeyState, 4, &length, &chars)
        }
        guard status == noErr, length > 0 else { return "key\(keyCode)" }
        return String(utf16CodeUnits: chars, count: length).lowercased()
    }
}
