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
}

/// A key down plus the focus/secure state resolved synchronously inside the tap callback, so the
/// later (deferred) processing never re-queries focus and can't attribute keys to the wrong field.
struct KeySnapshot {
    let raw: RawEvent
    let focused: AXUIElement?
    let secure: Bool
    /// Characters produced by the key; always nil when `secure` (dropped inside the callback).
    let chars: String?
}

/// C callback for the listen-only session tap. Runs on the main run loop, so it hops onto the main
/// actor synchronously; the controller snapshots focus/secure state before the callback returns.
private func tapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent,
                         userInfo: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    switch type {
    case .leftMouseDown, .rightMouseDown:
        let raw = RawEvent(kind: .click, location: event.location, keyCode: 0, flags: event.flags)
        MainActor.assumeIsolated { CaptureController.shared?.receive(raw) }
    case .keyDown:
        let raw = RawEvent(kind: .keyDown, location: .zero,
                           keyCode: event.getIntegerValueField(.keyboardEventKeycode), flags: event.flags)
        // The closure runs synchronously on this same (main) thread before the callback returns,
        // so the event is never actually shared across threads.
        nonisolated(unsafe) let keyEvent = event
        MainActor.assumeIsolated {
            CaptureController.shared?.receiveKey(raw) { readChars(keyEvent) }
        }
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        let raw = RawEvent(kind: .tapDisabled, location: .zero, keyCode: 0, flags: [])
        MainActor.assumeIsolated { CaptureController.shared?.receive(raw) }
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

private func readChars(_ event: CGEvent) -> String? {
    var length = 0
    var buffer = [UniChar](repeating: 0, count: 8)
    event.keyboardGetUnicodeString(maxStringLength: 8, actualStringLength: &length, unicodeString: &buffer)
    return length > 0 ? String(utf16CodeUnits: buffer, count: length) : nil
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
        var secure: Bool
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

    /// Pending work in arrival order; drained one item per main-queue hop.
    private enum Pending { case click(CGPoint), key(KeySnapshot) }
    private var pending: [Pending] = []

    func receive(_ raw: RawEvent) {
        switch raw.kind {
        case .tapDisabled:
            if !paused, let tap { CGEvent.tapEnable(tap: tap, enable: true) }
        case .click:
            guard !paused else { return }
            enqueue(.click(raw.location))
        case .keyDown:
            break // keys arrive through receiveKey
        }
    }

    /// Called synchronously inside the tap callback. Resolves the focused element and its secure state
    /// right now; characters are read only when the field is not secure.
    func receiveKey(_ raw: RawEvent, readChars: () -> String?) {
        guard !paused else { return }
        let focused = AXInspector.focusedElement()
        let secure = IsSecureEventInputEnabled() || (focused.map(AXInspector.isSecure) ?? false)
        let cmdOrCtrl = raw.flags.contains(.maskCommand) || raw.flags.contains(.maskControl)
        let chars = (secure || cmdOrCtrl) ? nil : readChars()
        enqueue(.key(KeySnapshot(raw: raw, focused: focused, secure: secure, chars: chars)))
    }

    private func enqueue(_ item: Pending) {
        pending.append(item)
        // Defer the heavier AX work so the callback returns quickly; one hop per item keeps FIFO order.
        DispatchQueue.main.async {
            MainActor.assumeIsolated { self.drainOne() }
        }
    }

    private func drainOne() {
        guard !pending.isEmpty else { return }
        let item = pending.removeFirst()
        guard !paused else { return }
        switch item {
        case .click(let point): handleClick(at: point)
        case .key(let snapshot): handleKeyDown(snapshot)
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

    private func handleKeyDown(_ key: KeySnapshot) {
        let raw = key.raw
        let cmd = raw.flags.contains(.maskCommand)
        let ctrl = raw.flags.contains(.maskControl)
        let alt = raw.flags.contains(.maskAlternate)

        // ⌘/⌃ always make a shortcut (they never produce text). ⌥ alone makes a shortcut only for named
        // non-text keys (arrows, F-keys, return, tab, delete, escape, home/end/page). Any other ⌥ key —
        // including dead keys like ⌥e — is text, so it goes through typing, where a secure field drops it.
        if cmd || ctrl || (alt && KeyNames.isSpecial(raw.keyCode)) {
            emitShortcut(raw)
            return
        }

        if raw.keyCode == Self.keyReturn || raw.keyCode == Self.keyEnter || raw.keyCode == Self.keyTab {
            flushTyping()
            return
        }

        // Use only the focus snapshot taken in the tap callback; never re-query here.
        guard let field = key.focused else { return }
        if let current = typing, !CFEqual(current.element, field) {
            flushTyping()
        }
        if typing == nil {
            let (context, _) = AXInspector.frontmostContext()
            typing = TypingBuffer(
                element: field, secure: key.secure,
                isTerminal: AXInspector.isTerminal(bundleId: context.bundleId, element: field),
                ts: nowMs(), context: context, field: AXInspector.fieldInfo(field))
        }
        if key.secure, typing?.secure == false {
            // The same field turned secure mid-buffer: forget everything typed into it.
            typing?.secure = true
            typing?.text = ""
        }
        typing?.keystrokes += 1
        if typing?.secure == false {
            if raw.keyCode == Self.keyDelete || raw.keyCode == Self.keyForwardDelete {
                if typing?.text.isEmpty == false { typing?.text.removeLast() }
            } else if let chars = key.chars, Self.isPrintable(chars) {
                typing?.text.append(chars)
            }
        }
        // Secure field: characters were never read (chars is nil) and nothing is stored.
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

    /// Named non-text keys; the only keys that make a ⌥-only shortcut.
    static func isSpecial(_ keyCode: Int64) -> Bool { special[keyCode] != nil && keyCode != 49 }

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
