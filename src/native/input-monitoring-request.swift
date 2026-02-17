import Foundation
import CoreGraphics

// input-monitoring-request
//
// Attempts to create a CGEventTap at the HID level.
// - Success: enables it briefly, then exits 0.
// - Failure: keeps the process alive for 3.5 s so macOS TCC has time to
//   register SuperCmd in System Settings → Privacy → Input Monitoring,
//   then exits 0.
// - Check mode (--check): returns granted=true/false without the wait.
//
// The wait is the critical part: CGEventTapCreate returns nil immediately
// when permission is denied, but macOS only adds the app to the TCC list
// if the requesting process stays alive long enough for TCC to process it.

func emit(_ payload: [String: Any]) {
    guard
        let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
        let text = String(data: data, encoding: .utf8)
    else { return }
    print(text)
    fflush(stdout)
}

let checkOnly = CommandLine.arguments.contains("--check")

let eventMask: CGEventMask =
    (1 << CGEventType.keyDown.rawValue) |
    (1 << CGEventType.keyUp.rawValue)

let tap = CGEvent.tapCreate(
    tap: .cghidEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: eventMask,
    callback: { _, _, event, _ in Unmanaged.passUnretained(event) },
    userInfo: nil
)

if let tap = tap {
    emit(["granted": true])
    if checkOnly {
        exit(0)
    }
    // Permission already granted — enable briefly so the OS sees activity.
    CGEvent.tapEnable(tap: tap, enable: true)
    Thread.sleep(forTimeInterval: 0.5)
    CGEvent.tapEnable(tap: tap, enable: false)
} else {
    emit(["granted": false])
    if checkOnly {
        exit(0)
    }
    // Permission not yet granted.
    // Stay alive so macOS TCC can enqueue the permission request and
    // surface SuperCmd in the Input Monitoring list.
    Thread.sleep(forTimeInterval: 3.5)
}

exit(0)
