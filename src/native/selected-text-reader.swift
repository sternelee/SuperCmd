import Foundation
import ApplicationServices

let axSelectedTextMarkerRangeAttribute = "AXSelectedTextMarkerRange" as CFString
let axSelectedTextMarkerRangesAttribute = "AXSelectedTextMarkerRanges" as CFString
let axStringForTextMarkerRangeParameterizedAttribute = "AXStringForTextMarkerRange" as CFString

func parseTargetPid() -> pid_t? {
    let args = CommandLine.arguments
    guard let idx = args.firstIndex(of: "--pid"), idx + 1 < args.count else { return nil }
    guard let raw = Int32(args[idx + 1]), raw > 0 else { return nil }
    return pid_t(raw)
}

func copyAttribute(_ element: AXUIElement, _ attribute: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(element, attribute, &value)
    guard err == .success else { return nil }
    return value
}

func selectedTextDirect(from element: AXUIElement) -> String? {
    guard let value = copyAttribute(element, kAXSelectedTextAttribute as CFString) else { return nil }
    if let text = value as? String, !text.isEmpty {
        return text
    }
    if let attr = value as? NSAttributedString, !attr.string.isEmpty {
        return attr.string
    }
    return nil
}

func extractRangeAXValue(_ value: Any) -> AXValue? {
    let axValue = unsafeBitCast(value as AnyObject, to: AXValue.self)
    guard AXValueGetType(axValue) == .cfRange else { return nil }
    return axValue
}

func selectedTextForRange(from element: AXUIElement, rangeValue: AXValue) -> String? {
    var value: CFTypeRef?
    let err = AXUIElementCopyParameterizedAttributeValue(
        element,
        kAXStringForRangeParameterizedAttribute as CFString,
        rangeValue,
        &value
    )
    guard err == .success else { return nil }
    if let text = value as? String, !text.isEmpty {
        return text
    }
    if let attr = value as? NSAttributedString, !attr.string.isEmpty {
        return attr.string
    }
    return nil
}

func selectedTextViaRange(from element: AXUIElement) -> String? {
    if let value = copyAttribute(element, kAXSelectedTextRangeAttribute as CFString),
       let axRange = extractRangeAXValue(value),
       let text = selectedTextForRange(from: element, rangeValue: axRange),
       !text.isEmpty {
        return text
    }

    if let value = copyAttribute(element, kAXSelectedTextRangesAttribute as CFString) as? [Any] {
        for item in value {
            guard let axRange = extractRangeAXValue(item),
                  let text = selectedTextForRange(from: element, rangeValue: axRange),
                  !text.isEmpty else { continue }
            return text
        }
    }

    return nil
}

func selectedTextForTextMarkerRange(from element: AXUIElement, markerRange: Any) -> String? {
    var value: CFTypeRef?
    let err = AXUIElementCopyParameterizedAttributeValue(
        element,
        axStringForTextMarkerRangeParameterizedAttribute,
        unsafeBitCast(markerRange as AnyObject, to: CFTypeRef.self),
        &value
    )
    guard err == .success else { return nil }
    if let text = value as? String, !text.isEmpty {
        return text
    }
    if let attr = value as? NSAttributedString, !attr.string.isEmpty {
        return attr.string
    }
    return nil
}

func selectedTextViaTextMarkerRange(from element: AXUIElement) -> String? {
    if let markerRange = copyAttribute(element, axSelectedTextMarkerRangeAttribute),
       let text = selectedTextForTextMarkerRange(from: element, markerRange: markerRange),
       !text.isEmpty {
        return text
    }

    if let markerRanges = copyAttribute(element, axSelectedTextMarkerRangesAttribute) as? [Any] {
        for markerRange in markerRanges {
            guard let text = selectedTextForTextMarkerRange(from: element, markerRange: markerRange),
                  !text.isEmpty else { continue }
            return text
        }
    }

    return nil
}

func selectedText(from element: AXUIElement) -> String? {
    if let text = selectedTextDirect(from: element), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return text
    }
    if let text = selectedTextViaTextMarkerRange(from: element), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return text
    }
    if let text = selectedTextViaRange(from: element), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return text
    }
    return nil
}

func focusedElement() -> AXUIElement? {
    let system = AXUIElementCreateSystemWide()
    if let focused = copyAttribute(system, kAXFocusedUIElementAttribute as CFString) {
        return unsafeBitCast(focused, to: AXUIElement.self)
    }
    if let focusedApp = copyAttribute(system, kAXFocusedApplicationAttribute as CFString) {
        let appElement = unsafeBitCast(focusedApp, to: AXUIElement.self)
        if let focused = copyAttribute(appElement, kAXFocusedUIElementAttribute as CFString) {
            return unsafeBitCast(focused, to: AXUIElement.self)
        }
    }
    return nil
}

func focusedApplicationElement() -> AXUIElement? {
    let system = AXUIElementCreateSystemWide()
    guard let focusedApp = copyAttribute(system, kAXFocusedApplicationAttribute as CFString) else { return nil }
    return unsafeBitCast(focusedApp, to: AXUIElement.self)
}

func childElements(of element: AXUIElement) -> [AXUIElement] {
    let childAttributes: [CFString] = [
        kAXChildrenAttribute as CFString,
        kAXVisibleChildrenAttribute as CFString
    ]

    for attribute in childAttributes {
        guard let value = copyAttribute(element, attribute) as? [Any], !value.isEmpty else { continue }
        let children = value.compactMap { item -> AXUIElement? in
            unsafeBitCast(item as AnyObject, to: AXUIElement.self)
        }
        if !children.isEmpty { return children }
    }

    return []
}

func selectedTextInSubtree(root: AXUIElement, maxDepth: Int = 5, maxNodes: Int = 250) -> String? {
    var queue: [(AXUIElement, Int)] = [(root, 0)]
    var processed = 0

    while !queue.isEmpty && processed < maxNodes {
        let (element, depth) = queue.removeFirst()
        processed += 1

        if let text = selectedText(from: element) {
            return text
        }

        if depth >= maxDepth { continue }
        for child in childElements(of: element) {
            queue.append((child, depth + 1))
        }
    }

    return nil
}

func selectedTextFromElementHierarchy(_ start: AXUIElement) -> String {
    var current: AXUIElement? = start
    var depth = 0
    while let element = current, depth < 12 {
        if let text = selectedText(from: element) {
            return text
        }
        guard let parentValue = copyAttribute(element, kAXParentAttribute as CFString) else { break }
        current = unsafeBitCast(parentValue, to: AXUIElement.self)
        depth += 1
    }
    if let text = selectedTextInSubtree(root: start) {
        return text
    }
    if let appRoot = focusedApplicationElement(),
       let text = selectedTextInSubtree(root: appRoot, maxDepth: 6, maxNodes: 400) {
        return text
    }
    return ""
}

func selectedTextFromFocusedHierarchy() -> String {
    guard let start = focusedElement() else { return "" }
    return selectedTextFromElementHierarchy(start)
}

func selectedTextFromApplication(pid: pid_t) -> String {
    let appElement = AXUIElementCreateApplication(pid)
    if let focused = copyAttribute(appElement, kAXFocusedUIElementAttribute as CFString) {
        let focusedElement = unsafeBitCast(focused, to: AXUIElement.self)
        let fromFocused = selectedTextFromElementHierarchy(focusedElement)
        if !fromFocused.isEmpty { return fromFocused }
    }
    if let text = selectedTextInSubtree(root: appElement, maxDepth: 7, maxNodes: 600) {
        return text
    }
    return ""
}

let text: String = {
    if let pid = parseTargetPid() {
        return selectedTextFromApplication(pid: pid)
    }
    return selectedTextFromFocusedHierarchy()
}()
if !text.isEmpty {
    FileHandle.standardOutput.write(text.data(using: .utf8) ?? Data())
}
