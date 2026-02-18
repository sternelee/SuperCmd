#!/usr/bin/env swift
/**
 * gen-icons.swift
 *
 * Generates a macOS HIG-compliant .icns from supercmd.png.
 *
 * macOS HIG: artwork should fill ~80% of the icon canvas with ~10% transparent
 * padding on each side so the icon sits at the same visual weight as system apps.
 *
 * Usage:
 *   swift scripts/gen-icons.swift
 */

import AppKit

// ── Config ────────────────────────────────────────────────────────────────

let projectRoot = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let sourcePng   = projectRoot.appendingPathComponent("supercmd.png")
let iconsetDir  = projectRoot.appendingPathComponent("supercmd.iconset")
let icnsOut     = projectRoot.appendingPathComponent("supercmd.icns")

// Artwork fills 80% of canvas; 10% transparent padding on each side.
let artworkFill = 0.80

// All sizes required for a complete macOS .icns
// (canvas px, filename stem)
let sizes: [(Int, String)] = [
    (16,   "icon_16x16"),
    (32,   "icon_16x16@2x"),
    (32,   "icon_32x32"),
    (64,   "icon_32x32@2x"),
    (128,  "icon_128x128"),
    (256,  "icon_128x128@2x"),
    (256,  "icon_256x256"),
    (512,  "icon_256x256@2x"),
    (512,  "icon_512x512"),
    (1024, "icon_512x512@2x"),
]

// ── Load source ───────────────────────────────────────────────────────────

guard let source = NSImage(contentsOf: sourcePng) else {
    fputs("Error: could not load \(sourcePng.path)\n", stderr); exit(1)
}

// ── Render each size ──────────────────────────────────────────────────────

func renderIcon(size: Int) -> Data {
    let artPx = Int((Double(size) * artworkFill).rounded())
    let pad   = (size - artPx) / 2

    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0
    ) else { fputs("Error: failed to create bitmap rep at \(size)px\n", stderr); exit(1) }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    // Transparent background
    NSColor.clear.set()
    NSRect(x: 0, y: 0, width: size, height: size).fill()

    // Draw artwork centered with padding
    source.draw(
        in: NSRect(x: pad, y: pad, width: artPx, height: artPx),
        from: NSRect(origin: .zero, size: source.size),
        operation: .sourceOver,
        fraction: 1.0
    )

    NSGraphicsContext.restoreGraphicsState()

    guard let png = rep.representation(using: .png, properties: [:]) else {
        fputs("Error: failed to encode PNG at \(size)px\n", stderr); exit(1)
    }
    return png
}

// ── Write iconset ─────────────────────────────────────────────────────────

let fm = FileManager.default
try? fm.removeItem(at: iconsetDir)
try! fm.createDirectory(at: iconsetDir, withIntermediateDirectories: true)

for (size, name) in sizes {
    let dest = iconsetDir.appendingPathComponent("\(name).png")
    let png  = renderIcon(size: size)
    try! png.write(to: dest)
    print("  \(name).png  (\(size)×\(size))")
}

// ── Convert iconset → icns ────────────────────────────────────────────────

let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconsetDir.path, "-o", icnsOut.path]
try! task.run()
task.waitUntilExit()

if task.terminationStatus == 0 {
    print("\nWrote \(icnsOut.path)")
    // Clean up temp iconset
    try? fm.removeItem(at: iconsetDir)
} else {
    fputs("iconutil failed (exit \(task.terminationStatus))\n", stderr); exit(1)
}
