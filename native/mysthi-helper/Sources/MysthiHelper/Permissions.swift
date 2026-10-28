import ApplicationServices
import CoreGraphics

/// Preflight and request for the three macOS permissions the helper needs.
/// `status()` never prompts; only `request()` may show system prompts.
enum Permissions {
    struct Status: Equatable {
        let screen: Bool
        let accessibility: Bool
        let input: Bool

        var json: [String: Any] {
            ["type": "permissions", "screen": screen, "accessibility": accessibility, "input": input]
        }
    }

    /// Preflight only: CGPreflightScreenCaptureAccess, AXIsProcessTrusted (no prompt option),
    /// CGPreflightListenEventAccess. None of these trigger a permission prompt.
    static func status() -> Status {
        Status(
            screen: CGPreflightScreenCaptureAccess(),
            accessibility: AXIsProcessTrusted(),
            input: CGPreflightListenEventAccess()
        )
    }

    /// Asks macOS for any permission not yet granted. This is the only code path that may prompt.
    static func request() {
        if !AXIsProcessTrusted() {
            // "AXTrustedCheckOptionPrompt" is the value of kAXTrustedCheckOptionPrompt.
            let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
        }
        if !CGPreflightListenEventAccess() {
            _ = CGRequestListenEventAccess()
        }
        if !CGPreflightScreenCaptureAccess() {
            _ = CGRequestScreenCaptureAccess()
        }
    }
}
