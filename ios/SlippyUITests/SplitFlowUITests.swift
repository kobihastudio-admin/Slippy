import XCTest

final class SplitFlowUITests: XCTestCase {
    func testSplitRedesignItemAssignmentAndVAT() {
        for style in ["light", "dark"] {
            let app = launch("split-redesign-items", style: style)
            XCTAssertTrue(app.buttons["split.assignment.0.0"].waitForExistence(timeout: 30))
            for friend in 0..<2 {
                let button = app.buttons["split.assignment.0.\(friend)"]
                guard reveal(button, in: app) else { app.terminate(); return }
                button.tap()
                let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "เลือกแล้ว"), object: button)
                XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 5), .completed)
            }
            for index in 1..<6 {
                let include = app.buttons["split.item.include.\(index)"]
                guard reveal(include, in: app) else { app.terminate(); return }
                include.tap()
                let excluded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "ไม่เลือก"), object: include)
                XCTAssertEqual(XCTWaiter.wait(for: [excluded], timeout: 5), .completed)
            }
            let mode = app.buttons["split.vat.mode"]
            guard reveal(mode, in: app) else { app.terminate(); return }
            mode.tap()
            app.buttons["ราคายังไม่รวม VAT"].tap()
            let rate = app.textFields["split.vat.rate"]
            guard reveal(rate, in: app) else { app.terminate(); return }
            rate.tap()
            rate.typeText("7")
            let dismiss = app.buttons["split.dismissKeyboard"]
            if dismiss.exists { dismiss.tap() }
            let total = app.staticTexts["split.vat.total"]
            XCTAssertTrue(total.waitForExistence(timeout: 10))
            XCTAssertTrue(total.label.contains("107"))
            guard reveal(mode, in: app) else { app.terminate(); return }
            mode.tap()
            app.buttons["ราคารวม VAT แล้ว"].tap()
            XCTAssertTrue(total.label.contains("100"))
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "Split VAT and assignments \(style)"
            screenshot.lifetime = .keepAlways
            add(screenshot)
            app.buttons["split.next"].tap()
            XCTAssertTrue(app.staticTexts["ตรวจสอบก่อนบันทึก"].waitForExistence(timeout: 10))
            XCTAssertTrue(app.staticTexts["1 จาก 6 รายการ"].exists)
            app.terminate()
        }
    }

    func testSplitRedesignShowsEveryLine() {
        let app = launch("split-redesign-details", style: "light")
        defer { app.terminate() }
        XCTAssertTrue(app.textFields["split.title"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts["รายการสุดท้าย"].exists)
        XCTAssertEqual(app.staticTexts.matching(identifier: "เครื่องดื่ม").count, 2)
        XCTAssertFalse(app.staticTexts["Dinner Chinatown"].exists)
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = "Split redesigned details"
        image.lifetime = .keepAlways
        add(image)
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        let scroll = app.scrollViews.firstMatch
        for _ in 0..<12 {
            let frame = element.frame
            let top = scroll.frame.minY + 12
            let bottom = min(scroll.frame.maxY, app.buttons["split.next"].frame.minY) - 12
            if element.isHittable && frame.minY >= top && frame.maxY <= bottom { return true }
            let upper = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
            let lower = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65))
            if frame.minY < top { upper.press(forDuration: 0.05, thenDragTo: lower) }
            else { lower.press(forDuration: 0.05, thenDragTo: upper) }
        }
        XCTFail("Control could not be revealed fully above the fixed action bar")
        return false
    }

    func testConfiguredGoogleMapSwitching() {
        for style in ["light", "dark"] {
            verifyConfiguredGoogleMap(style: style)
        }
    }

    private func verifyConfiguredGoogleMap(style: String) {
        let app = launch("trip-map-test", style: style)
        defer { app.terminate() }
        let selector = app.segmentedControls["trip.map.provider"]
        XCTAssertTrue(selector.waitForExistence(timeout: 30))
        XCTAssertTrue(selector.buttons["Google Maps"].isSelected, "Configured trips must start on Google Maps")
        let google = app.descendants(matching: .any).matching(identifier: "trip.map.google").firstMatch
        XCTAssertTrue(google.waitForExistence(timeout: 30))
        XCTAssertFalse(app.alerts.firstMatch.exists)
        XCTAssertTrue(selector.buttons["Google Maps"].isSelected)
        let rendered = NSPredicate(format: "value CONTAINS %@", "\"ready\":true")
        let ready = XCTNSPredicateExpectation(predicate: rendered, object: google)
        let renderingResult = XCTWaiter.wait(for: [ready], timeout: 45)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Configured Google Maps \(style)"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        XCTAssertEqual(renderingResult, .completed, "Google renderer did not reach a stable snapshot")
        guard let value = google.value as? String, let data = value.data(using: .utf8),
              let snapshot = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let pins = snapshot["pins"] as? [String: [String: Double]],
              let point = pins["preview-stop"], let x = point["x"], let y = point["y"],
              (0...1).contains(x), (0...1).contains(y) else {
            XCTFail("Synthetic pin projection is missing or outside the visible map")
            return
        }
        google.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)).tap()
        XCTAssertTrue(app.staticTexts["Kushida Shrine"].waitForExistence(timeout: 10))
        let cardScreenshot = XCTAttachment(screenshot: app.screenshot())
        cardScreenshot.name = "Google Maps selected stop \(style)"
        cardScreenshot.lifetime = .keepAlways
        add(cardScreenshot)
        selector.buttons["Apple Maps"].tap()
        XCTAssertTrue(selector.buttons["Apple Maps"].isSelected)
        selector.buttons["Google Maps"].tap()
        XCTAssertTrue(google.waitForExistence(timeout: 15))
        XCTAssertFalse(app.alerts.firstMatch.exists)
    }

    func testMissingNativeMapKeyKeepsAppleAvailable() {
        let app = launch("trip-map-test", missingMapKey: true)
        defer { app.terminate() }
        let selector = app.segmentedControls["trip.map.provider"]
        XCTAssertTrue(selector.waitForExistence(timeout: 30))
        selector.buttons["Google Maps"].tap()
        let message = app.alerts.firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 10))
        XCTAssertTrue(message.staticTexts["ยังไม่ได้ตั้งค่า Google Maps สำหรับ iOS ใช้ Apple Maps ต่อได้"].exists)
        message.buttons["ตกลง"].tap()
        XCTAssertTrue(selector.buttons["Apple Maps"].isSelected)
        XCTAssertTrue(selector.isHittable)
    }

    private func launch(_ screen: String, style: String? = nil, missingMapKey: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["SLIPPY_APPEARANCE_PREVIEW"] = screen
        if let style {
            app.launchEnvironment["SLIPPY_MAPS_TEST_STYLE"] = style
            app.launchEnvironment["SLIPPY_SPLIT_TEST_STYLE"] = style
        }
        if missingMapKey { app.launchEnvironment["SLIPPY_MAPS_TEST_MISSING_KEY"] = "1" }
        app.launch()
        return app
    }

    func testLocalFriendPersistsAndCanBeSelected() {
        let name = "UI Guest \(UUID().uuidString.prefix(8))"
        var app = launch("split-friends-test")
        let nameField = app.textFields["split.friend.name"]
        XCTAssertTrue(nameField.waitForExistence(timeout: 20))
        nameField.tap()
        nameField.typeText(name)
        let line = app.textFields["split.friend.line"]
        line.tap()
        line.typeText("guest-line-id")
        app.buttons["split.friend.save"].tap()
        XCTAssertTrue(app.staticTexts["Selected: \(name)"].waitForExistence(timeout: 10))
        app.terminate()

        app = launch("split-friends-test")
        let search = app.textFields["split.friend.search"]
        XCTAssertTrue(search.waitForExistence(timeout: 20))
        search.tap()
        search.typeText(name)
        let keyboard = app.buttons["split.friend.dismissKeyboard"]
        if keyboard.exists { keyboard.tap() }
        let saved = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 10))
        XCTAssertTrue(saved.label.contains("guest-line-id"))
        XCTAssertTrue(saved.isHittable)
        saved.tap()
        XCTAssertTrue(app.staticTexts["Selected: \(name)"].waitForExistence(timeout: 10))
        app.terminate()

        app = launch("split-friends-test")
        let cleanupSearch = app.textFields["split.friend.search"]
        XCTAssertTrue(cleanupSearch.waitForExistence(timeout: 20))
        cleanupSearch.tap()
        cleanupSearch.typeText(name)
        let hideKeyboard = app.buttons["split.friend.dismissKeyboard"]
        if hideKeyboard.exists { hideKeyboard.tap() }
        let cleanupRow = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
        XCTAssertTrue(cleanupRow.waitForExistence(timeout: 10))
        let cell = app.cells.containing(.button, identifier: cleanupRow.label).firstMatch
        XCTAssertTrue(cell.exists)
        cell.swipeLeft()
        app.buttons["ลบ"].tap()
        let removed = NSPredicate(format: "exists == false")
        expectation(for: removed, evaluatedWith: cleanupRow)
        waitForExpectations(timeout: 10)
        app.terminate()
    }

    func testContactsCanBeCancelledAndReopened() {
        let app = launch("split-friends-test")
        let contacts = app.buttons["split.friend.contacts"]
        XCTAssertTrue(contacts.waitForExistence(timeout: 20))
        for _ in 0..<2 {
            contacts.tap()
            let picker = app.otherElements["split.contacts.picker"]
            XCTAssertTrue(picker.waitForExistence(timeout: 10))
            let cancel = picker.buttons.matching(NSPredicate(format: "label IN %@", ["Cancel", "ยกเลิก"])).firstMatch
            XCTAssertTrue(cancel.waitForExistence(timeout: 10))
            cancel.tap()
            XCTAssertTrue(contacts.waitForExistence(timeout: 10))
            XCTAssertTrue(contacts.isHittable)
        }
        app.terminate()
    }

    func testReceiptDraftUsesExistingData() {
        let app = launch("document-split-test")
        let split = app.buttons["document.split"]
        XCTAssertTrue(split.waitForExistence(timeout: 20))
        split.tap()
        let title = app.textFields["split.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 20))
        XCTAssertEqual(title.value as? String, "Kyushu Dinner")
        let total = app.textFields["split.total"]
        XCTAssertTrue(total.exists)
        XCTAssertEqual(total.value as? String, "123.45")
        app.terminate()
    }

    func testContactSelectionWhenAvailable() throws {
        let app = launch("split-friends-test")
        defer { app.terminate() }
        let contacts = app.buttons["split.friend.contacts"]
        XCTAssertTrue(contacts.waitForExistence(timeout: 20))
        contacts.tap()
        let picker = app.otherElements["split.contacts.picker"]
        guard picker.waitForExistence(timeout: 20) else {
            throw XCTSkip("Contacts selection fixture is unavailable; presentation is covered by the cancellation test")
        }
        let contact = picker.tables.cells.firstMatch
        guard contact.waitForExistence(timeout: 10) else {
            throw XCTSkip("No selectable contact exposed by the simulator picker; no address-book data is created")
        }
        contact.tap()
        let name = app.textFields["split.friend.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        let value = name.value as? String ?? ""
        XCTAssertFalse(value.isEmpty)
        XCTAssertNotEqual(value, "ชื่อ")
        let line = app.textFields["split.friend.line"].value as? String ?? ""
        XCTAssertTrue(line.isEmpty || line == "LINE ID (ไม่บังคับ)")
    }
}
