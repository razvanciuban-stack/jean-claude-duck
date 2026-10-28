import AppKit
import CoreGraphics
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

/// Command id echoed back on the screenshot line (string or number as sent by the client).
enum CommandID: Sendable {
    case string(String)
    case number(Double)
    case null

    init(_ value: Any?) {
        if let s = value as? String { self = .string(s) }
        else if let n = value as? NSNumber { self = .number(n.doubleValue) }
        else { self = .null }
    }

    var json: Any {
        switch self {
        case .string(let s): return s
        case .number(let n): return n == n.rounded() && abs(n) < 1e15 ? Int64(n) as Any : n as Any
        case .null: return NSNull()
        }
    }
}

/// ScreenCaptureKit capture of the display holding the frontmost window, downscaled and JPEG-encoded
/// in memory. Nothing is ever written to disk.
@MainActor
enum Screenshot {
    nonisolated static let maxWidth = 1024.0
    nonisolated static let jpegQuality = 0.6
    /// The pet's own windows are excluded from captures (packaged id, and the dev Electron id).
    nonisolated static let excludedBundles: Set<String> = ["com.jeanclaude.duck", "com.github.Electron"]

    static func capture(id: CommandID) {
        // Preflight first: SCShareableContent would otherwise trigger a permission prompt.
        guard CGPreflightScreenCaptureAccess() else {
            emitFailure(id: id)
            return
        }
        let displayID = displayOfFrontmostWindow()
        Task { @MainActor in
            do {
                guard let shot = try await captureJPEG(displayID: displayID) else {
                    emitFailure(id: id)
                    return
                }
                Output.emit([
                    "type": "screenshot", "ts": nowMs(), "id": id.json,
                    "jpegBase64": shot.jpeg.base64EncodedString(),
                    "width": shot.width, "height": shot.height,
                ])
            } catch {
                Output.error("screenshot capture failed")
                emitFailure(id: id)
            }
        }
    }

    struct Shot: Sendable {
        let jpeg: Data
        let width: Int
        let height: Int
    }

    /// Runs off the main actor; only the Sendable JPEG bytes come back.
    nonisolated private static func captureJPEG(displayID: CGDirectDisplayID) async throws -> Shot? {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == displayID })
                ?? content.displays.first else { return nil }
        let own = content.applications.filter { excludedBundles.contains($0.bundleIdentifier) }
        let filter = SCContentFilter(display: display, excludingApplications: own, exceptingWindows: [])
        let scale = Double(filter.pointPixelScale)
        let sourceWidth = Double(display.width) * scale
        let sourceHeight = Double(display.height) * scale
        let factor = min(1.0, maxWidth / sourceWidth)
        let config = SCStreamConfiguration()
        config.width = max(1, Int((sourceWidth * factor).rounded()))
        config.height = max(1, Int((sourceHeight * factor).rounded()))
        config.showsCursor = false
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        guard let jpeg = encodeJPEG(image) else { return nil }
        return Shot(jpeg: jpeg, width: image.width, height: image.height)
    }

    /// Always answer a request so the client never waits on an id forever.
    static func emitFailure(id: CommandID) {
        Output.emit(["type": "screenshot", "ts": nowMs(), "id": id.json,
                     "jpegBase64": NSNull(), "width": 0, "height": 0])
    }

    private static func displayOfFrontmostWindow() -> CGDirectDisplayID {
        guard let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier,
              let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                                    kCGNullWindowID) as? [[String: Any]] else {
            return CGMainDisplayID()
        }
        for info in list {
            guard (info[kCGWindowOwnerPID as String] as? Int).map({ pid_t($0) }) == pid,
                  (info[kCGWindowLayer as String] as? Int) == 0,
                  let boundsDict = info[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: boundsDict) else { continue }
            var displayID: CGDirectDisplayID = 0
            var count: UInt32 = 0
            if CGGetDisplaysWithPoint(CGPoint(x: bounds.midX, y: bounds.midY), 1, &displayID, &count) == .success,
               count > 0 {
                return displayID
            }
        }
        return CGMainDisplayID()
    }

    nonisolated private static func encodeJPEG(_ image: CGImage) -> Data? {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
            return nil
        }
        let props = [kCGImageDestinationLossyCompressionQuality: jpegQuality] as CFDictionary
        CGImageDestinationAddImage(dest, image, props)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return data as Data
    }
}
