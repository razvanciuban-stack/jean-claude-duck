import Foundation

// mysthi-helper: streams one JSON object per line on stdout, reads one JSON command per line on stdin.
// stderr carries only fixed error strings (StaticString), never captured content.

signal(SIGPIPE, SIG_IGN)

func nowMs() -> Int64 { Int64((Date().timeIntervalSince1970 * 1000).rounded()) }

enum Output {
    /// Serialises one object as a single JSON line and writes it straight to fd 1 (unbuffered).
    static func emit(_ object: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(object),
              var data = try? JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes])
        else {
            error("failed to encode output line")
            return
        }
        data.append(0x0A)
        data.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return }
            var offset = 0
            while offset < raw.count {
                let n = write(STDOUT_FILENO, base + offset, raw.count - offset)
                if n < 0 {
                    if errno == EINTR { continue }
                    exit(0) // parent went away
                }
                offset += n
            }
        }
    }

    /// Only compile-time constant messages can reach stderr, so captured content never can.
    static func error(_ message: StaticString) {
        let text = "mysthi-helper: \(message)\n"
        FileHandle.standardError.write(Data(text.utf8))
    }
}

@MainActor
func handleCommand(_ line: String, controller: CaptureController) {
    guard let data = line.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let cmd = object["cmd"] as? String else {
        Output.error("ignored malformed command")
        return
    }
    switch cmd {
    case "pause":
        controller.pause()
    case "resume":
        controller.resume()
    case "request-permissions":
        Permissions.request()
        Output.emit(Permissions.status().json)
        controller.ensureTap()
    case "screenshot":
        let id = CommandID(object["id"])
        if controller.paused {
            Screenshot.emitFailure(id: id)
        } else {
            Screenshot.capture(id: id)
        }
    default:
        Output.error("ignored unknown command")
    }
}

if CommandLine.arguments.contains("--selftest") {
    Output.emit(Permissions.status().json)
    exit(0)
}

let controller = CaptureController()
CaptureController.shared = controller
let initialPermissions = Permissions.status()
Output.emit(initialPermissions.json)
controller.start(initialPermissions: initialPermissions)

let stdinReader = Thread {
    while let line = readLine(strippingNewline: true) {
        if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                if let controller = CaptureController.shared { handleCommand(line, controller: controller) }
            }
        }
    }
    // stdin closed: the parent process is gone, so stop capturing.
    DispatchQueue.main.async { exit(0) }
}
stdinReader.start()

CFRunLoopRun()
