import SwiftUI
import PhotosUI

struct TripDetailView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = TripsViewModel()
    @StateObject private var callVM = TripCallViewModel()
    /// Lifted here (was previously a `@StateObject` inside TripMapView)
    /// so live-location sharing and its "currently sharing" banner survive
    /// switching between TripDetailView's own tabs — TripMapView is only on
    /// screen for the Map tab (and the Itinerary tab's embedded map), so
    /// owning this instance there meant leaving either tab silently killed
    /// the ping loop and hid the banner mid-share. See TripMapView's
    /// `locationVM` doc comment for the full reasoning; mirrors how `callVM`
    /// just above is already scoped to this view for the same reason.
    @StateObject private var locationVM = TripLocationViewModel()
    @State private var trip: Trip
    @State private var showAddExpense = false
    @State private var showAddParticipant = false
    @State private var tab: Tab = .expenses
    @State private var expandedExpenseId: String?
    @State private var payTarget: PayTarget?
    /// nil = the whole trip, which the map offers explicitly.
    @State private var activeDay: Int?
    @State private var showImport = false
    @State private var exportingPDF = false
    @State private var exportingKML = false
    @State private var kmlURL: URL?
    @State private var pdfURL: URL?
    @State private var toolError: String?
    @State private var showDocuments = false
    @State private var showGallery = false
    @State private var showNotes = false
    @State private var photos: [TripPhoto] = []
    @State private var checkingInItem: TripItineraryItem?
    @State private var checkInPhotoItem: PhotosPickerItem?
    @State private var checkingIn = false

    enum Tab { case plan, map, expenses, settlement }

    struct PayTarget: Identifiable {
        var id: String { from.id + to.id }
        let from: TripParticipant
        let to: TripParticipant
        let amount: Double
    }

    init(trip: Trip) {
        _trip = State(initialValue: trip)
    }

    private var participants: [TripParticipant] { trip.participants ?? [] }
    private var expenses: [TripExpense] { trip.expenses ?? [] }
    private var pMap: [String: TripParticipant] { Dictionary(uniqueKeysWithValues: participants.map { ($0.id, $0) }) }
    private var isSettled: Bool { vm.settlement.isEmpty && trip.computedTotal > 0 }

    var body: some View {
        ZStack {
            Color.background.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 16) {
                    headerCard
                    summaryCard
                    tabPicker

                    switch tab {
                    case .plan:
                        planSection
                    case .map:
                        mapSection
                    case .expenses:
                        expensesSection
                        participantsSection
                    case .settlement:
                        settlementSection
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }

            // Both banners live here, at the TripDetailView level — outside
            // the `switch tab` above — so they stay visible no matter which
            // of this view's own tabs is active. callVM already lived here;
            // locationVM was moved up alongside it for the same reason (see
            // its own doc comment).
            if callVM.connected || locationVM.mySession != nil {
                VStack(spacing: 8) {
                    Spacer()
                    if callVM.connected {
                        HStack(spacing: 8) {
                            Image(systemName: "phone.fill").foregroundColor(.white)
                            Text("กำลังคุยสาย").font(.system(size: 12, weight: .semibold)).foregroundColor(.white)
                            Spacer()
                            Button { Task { await callVM.leave() } } label: {
                                Image(systemName: "phone.down.fill").foregroundColor(.white)
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(Color.red.opacity(0.9), in: Capsule())
                    }
                    if locationVM.mySession != nil {
                        HStack(spacing: 8) {
                            Image(systemName: "location.fill.viewfinder").foregroundColor(.white)
                            Text("กำลังแชร์ตำแหน่ง").font(.system(size: 12, weight: .semibold)).foregroundColor(.white)
                            Spacer()
                            Button {
                                hapticLight()
                                locationVM.stopSharing()
                            } label: {
                                Image(systemName: "location.slash.fill").foregroundColor(.white)
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(Color.brand500.opacity(0.9), in: Capsule())
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 16)
            }
        }
        .onAppear { locationVM.startPolling(journeyId: trip.id) }
        .onDisappear { locationVM.stopPolling() }
        .navigationTitle(trip.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        hapticLight()
                        showImport = true
                    } label: { Label("นำเข้าเอกสาร", systemImage: "doc.text.viewfinder") }

                    Button {
                        hapticLight()
                        showDocuments = true
                    } label: { Label("เอกสารของทริป", systemImage: "folder") }

                    Button {
                        hapticLight()
                        showGallery = true
                    } label: { Label("แกลเลอรี", systemImage: "photo.on.rectangle") }

                    Button {
                        hapticLight()
                        showNotes = true
                    } label: { Label("โน้ตของทริป", systemImage: "note.text") }

                    Button {
                        hapticLight()
                        Task { await exportPDF() }
                    } label: { Label("ส่งออก PDF", systemImage: "square.and.arrow.up") }
                        .disabled(exportingPDF)

                    Button {
                        hapticLight()
                        Task { await exportKML() }
                    } label: { Label("ส่งไป Google Maps (.kml)", systemImage: "map") }
                        .disabled(exportingKML)

                    Button {
                        hapticLight()
                        Task {
                            if callVM.connected { await callVM.leave() } else { await callVM.join(tripId: trip.id) }
                        }
                    } label: {
                        Label(callVM.connected ? "วางสาย" : "โทรคุยกับทริปนี้",
                              systemImage: callVM.connected ? "phone.down.fill" : "phone.fill")
                    }
                } label: {
                    if exportingPDF || exportingKML {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
        .sheet(isPresented: $showImport) {
            TripImportDocumentSheet(tripId: trip.id) { await reload() }
        }
        .sheet(isPresented: $showDocuments) {
            TripDocumentsView(trip: trip)
        }
        .sheet(isPresented: $showGallery) {
            TripGalleryView(trip: trip, days: days)
        }
        .sheet(isPresented: $showNotes) {
            TripNotesView(trip: trip)
        }
        .onChange(of: checkInPhotoItem) { _, item in
            guard let item, let target = checkingInItem else { return }
            Task {
                defer { checkInPhotoItem = nil; checkingInItem = nil }
                guard let data = try? await item.loadTransferable(type: Data.self) else { return }
                await addCheckInPhoto(data, to: target)
            }
        }
        // item:, not isPresented: — the share sheet must not be built before the
        // file exists, or it presents with nothing to share.
        .sheet(item: $pdfURL) { url in
            ShareSheet(items: [url])
        }
        .sheet(item: $kmlURL) { url in
            ShareSheet(items: [url])
        }
        .alert("ไม่สำเร็จ", isPresented: .constant(toolError != nil)) {
            Button("ตกลง") { toolError = nil }
        } message: { Text(toolError ?? "") }
        .alert("โทรไม่สำเร็จ", isPresented: .constant(callVM.errorText != nil)) {
            Button("ตกลง") { callVM.errorText = nil }
        } message: { Text(callVM.errorText ?? "") }
        .sheet(isPresented: $showAddExpense) {
            AddExpenseSheet(
                journeyId: trip.id, userId: authVM.session?.user.id.uuidString ?? "",
                participants: participants
            ) {
                Task { await reload() }
            }
        }
        .sheet(isPresented: $showAddParticipant) {
            TripAddParticipantSheet(journeyId: trip.id, totalExpenses: trip.computedTotal, participantCount: participants.count) { _ in
                Task { await reload() }
            }
        }
        .sheet(item: $payTarget) { target in
            PaySheet(target: target) { note in
                Task {
                    try? await vm.recordPayment(journeyId: trip.id, from: target.from.id, to: target.to.id, amount: target.amount, note: note)
                    payTarget = nil
                    await reload()
                }
            }
        }
        .task { await reload() }
    }

    // MARK: – Header (unchanged)

    private var headerCard: some View {
        VStack(spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(trip.tripTypeEmoji + " " + trip.title)
                        .font(.system(size: 20, weight: .bold))
                        .foregroundColor(Color.textPrimary)

                    statusBadge(trip.status)
                }

                Spacer()
            }

            if trip.eventDate != nil || trip.venue != nil {
                Divider()

                HStack(spacing: 20) {
                    if let date = trip.eventDate {
                        detailRow(icon: "calendar", text: formatEventDate(date))
                    }
                    if let venue = trip.venue, !venue.isEmpty {
                        detailRow(icon: "mappin.circle.fill", text: venue)
                    }
                }
            }

            if let notes = trip.notes, !notes.isEmpty {
                Divider()
                HStack {
                    Text(notes)
                        .font(.system(size: 13))
                        .foregroundColor(Color.textSecondary)
                    Spacer()
                }
            }
        }
        .padding(16)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: Color.black.opacity(0.06), radius: 8, x: 0, y: 2)
    }

    // MARK: – Summary

    private var summaryCard: some View {
        HStack(spacing: 0) {
            summaryItem(label: "รวมค่าใช้จ่าย", amount: trip.computedTotal, color: Color.textPrimary)
            Divider().frame(height: 40)
            summaryItem(label: "จ่ายแล้ว", amount: trip.totalPaid, color: .green)
            Divider().frame(height: 40)
            summaryItem(label: "ค้างชำระ", amount: trip.totalRemaining, color: trip.totalRemaining > 0 ? .orange : .green)
        }
        .padding(.vertical, 14)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: Color.black.opacity(0.06), radius: 8, x: 0, y: 2)
    }

    private func summaryItem(label: String, amount: Double, color: Color) -> some View {
        VStack(spacing: 4) {
            Text(fmtTHB(amount))
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(color)
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(Color.textSecondary)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: – Tab picker

    private var tabPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                tabButton("แผนเดินทาง (\(itineraryItemCount))", tab: .plan)
                tabButton("แผนที่", tab: .map)
                tabButton("รายจ่าย (\(expenses.count))", tab: .expenses)
                tabButton("สรุปยอด \(isSettled ? "✅" : "(\(vm.settlement.count))")", tab: .settlement)
            }
            .padding(4)
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func tabButton(_ label: String, tab t: Tab) -> some View {
        Button { tab = t } label: {
            Text(label)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(tab == t ? Color.textPrimary : Color.textSecondary)
                .fixedSize()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(tab == t ? Color.background : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 9))
        }
    }

    // MARK: – Itinerary

    private var days: [TripItineraryDay] { vm.itineraryDays }
    private var itineraryItemCount: Int { days.reduce(0) { $0 + ($1.items?.count ?? 0) } }
    private var tripCurrency: String { trip.baseCurrency ?? "THB" }

    /// The day the plan tab is showing. Falls back to the first, because the map
    /// can leave `activeDay` on nil ("whole trip") and a timeline is always
    /// about one day.
    private var planDay: TripItineraryDay? {
        days.first { $0.dayNumber == activeDay } ?? days.first
    }

    @ViewBuilder
    private var planSection: some View {
        if days.isEmpty {
            emptyCard("ยังไม่มีแผนการเดินทาง",
                      "นำเข้าตั๋วหรือใบจอง หรือเพิ่มจุดแวะจากแท็บแผนที่")
        } else {
            VStack(spacing: 12) {
                dayStrip
                if let day = planDay {
                    // The map belongs on the itinerary page, not only behind its
                    // own tab — seeing the day's shape while reading its timeline
                    // is most of the point. Same interactive map as the map tab,
                    // just shorter; it is not a picture.
                    TripMapView(
                        trip: trip,
                        days: days,
                        activeDay: Binding(get: { day.dayNumber },
                                           set: { activeDay = $0 }),
                        canEdit: true,
                        onChanged: { await vm.loadItinerary(journeyId: trip.id) },
                        locationVM: locationVM,
                        showDayStrip: false
                    )
                    // Must exceed mapArea's own 320pt minHeight plus bottomBar's
                    // height (~50pt) with real margin — this view has no day
                    // strip (showDayStrip: false) to absorb the difference, and
                    // too little here is exactly what silently clipped the
                    // selection/pending card before it became a `.overlay`.
                    .frame(height: 410)
                    .clipShape(RoundedRectangle(cornerRadius: 14))

                    VStack(alignment: .leading, spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(day.title ?? "วันที่ \(day.dayNumber)")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundColor(Color.textPrimary)
                            Text([day.city, "\(day.items?.count ?? 0) รายการ"]
                                    .compactMap { $0 }.joined(separator: " · "))
                                .font(.system(size: 12))
                                .foregroundColor(Color.textSecondary)
                            if let summary = day.summary {
                                Text(summary)
                                    .font(.system(size: 12))
                                    .foregroundColor(Color.textSecondary)
                                    .padding(.top, 2)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        if (day.items ?? []).isEmpty {
                            Text("ยังไม่มีรายการในวันนี้")
                                .font(.system(size: 12))
                                .foregroundColor(Color.textSecondary)
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.vertical, 18)
                        } else {
                            ForEach(day.items ?? []) { item in
                                itineraryRow(item)
                            }
                        }
                    }
                    .padding(14)
                    .background(Color.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                }
            }
        }
    }

    private var dayStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(days) { day in
                    Button {
                        hapticLight()
                        activeDay = day.dayNumber
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("DAY \(day.dayNumber)")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundColor(Color.textSecondary)
                            Text(shortDate(day.date))
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(Color.textPrimary)
                            Text(day.city ?? "—")
                                .font(.system(size: 10))
                                .foregroundColor(Color.textSecondary)
                                .lineLimit(1)
                        }
                        .frame(width: 92, alignment: .leading)
                        .padding(10)
                        .background(planDay?.id == day.id ? Color.brand500.opacity(0.14) : Color.surface)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(planDay?.id == day.id ? Color.brand500 : Color.border, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 2)
        }
    }

    @ViewBuilder
    private func itineraryRow(_ item: TripItineraryItem) -> some View {
        let spec = JourneyStyle.spec(item.type)
        HStack(alignment: .top, spacing: 10) {
            Text(item.timeFrom.map { String($0.prefix(5)) } ?? "—")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(Color.textSecondary)
                .frame(width: 40, alignment: .trailing)

            Image(systemName: spec.symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(spec.color)
                .frame(width: 28, height: 28)
                .background(spec.color.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(item.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(Color.textPrimary)
                    if item.status == "optional" {
                        Text("ถ้ามีเวลา")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(Color.statusReviewing)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Color.statusReviewing.opacity(0.14), in: Capsule())
                    }
                }
                if let subtitle = item.subtitle {
                    Text(subtitle).font(.system(size: 11)).foregroundColor(Color.textSecondary)
                }
                if item.location != nil || item.endLocation != nil {
                    Text([item.location, item.endLocation].compactMap { $0 }.joined(separator: " → "))
                        .font(.system(size: 11))
                        .foregroundColor(Color.textSecondary)
                        .lineLimit(2)
                }
                if let code = item.confirmationCode {
                    Text("รหัสจอง \(code)")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(Color.textSecondary)
                }
            }

            Spacer(minLength: 0)

            if item.baseAmount > 0 {
                VStack(alignment: .trailing, spacing: 1) {
                    // baseAmount — `amount` may be yen. See TripItineraryItem.
                    Text(fmtTHB(item.baseAmount))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(Color.textPrimary)
                    if let original = item.originalAmount(tripCurrency: tripCurrency) {
                        Text(original)
                            .font(.system(size: 9))
                            .foregroundColor(Color.textSecondary)
                    }
                }
            }

            if let c = item.coordinate {
                Button {
                    hapticLight()
                    GoogleMapsLinks.open(GoogleMapsLinks.streetViewURL((c.lat, c.lng)))
                } label: {
                    Image(systemName: "figure.walk")
                        .font(.system(size: 13))
                        .foregroundColor(Color.textSecondary)
                }
                .buttonStyle(.borderless)

                Button {
                    hapticLight()
                    openInGoogleMaps(item)
                } label: {
                    Image(systemName: "arrow.up.right.square")
                        .font(.system(size: 13))
                        .foregroundColor(Color.textSecondary)
                }
                .buttonStyle(.borderless)
            }
        }
        .padding(.vertical, 7)

        checkInRow(item)
    }

    /// Check-in state + photos for one stop — a trip remembered, not just planned.
    @ViewBuilder
    private func checkInRow(_ item: TripItineraryItem) -> some View {
        let itemPhotos = photos.filter { $0.itemId == item.id }
        HStack(spacing: 8) {
            Spacer().frame(width: 40 + 28 + 10 + 10) // align under the row's content column

            if item.checkedInAt != nil {
                Label("เช็คอินแล้ว", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(.green)
            } else {
                Button {
                    hapticLight()
                    Task { await checkIn(item) }
                } label: {
                    if checkingIn && checkingInItem?.id == item.id {
                        ProgressView().controlSize(.mini)
                    } else {
                        Label("เช็คอิน", systemImage: "checkmark.circle")
                            .font(.system(size: 10, weight: .semibold))
                    }
                }
                .buttonStyle(.plain)
                .foregroundColor(Color.textSecondary)
            }

            PhotosPicker(selection: $checkInPhotoItem, matching: .images) {
                Image(systemName: "camera").font(.system(size: 10)).foregroundColor(Color.textSecondary)
            }
            .simultaneousGesture(TapGesture().onEnded { checkingInItem = item })

            ForEach(itemPhotos.prefix(4)) { photo in
                AsyncImage(url: TripPhotoAPI.publicURL(photo)) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() }
                    else { Rectangle().fill(Color.surface) }
                }
                .frame(width: 22, height: 22)
                .clipShape(RoundedRectangle(cornerRadius: 5))
            }
            Spacer()
        }
        .padding(.bottom, 7)
    }

    /// Directions when the type has a road/rail equivalent Google can route;
    /// a plain pin otherwise. Mirrors TripMapView's version of this — one rule,
    /// used everywhere a stop can be opened in Google Maps.
    private func openInGoogleMaps(_ item: TripItineraryItem) {
        guard let start = item.coordinate else { return }
        let origin = (start.lat, start.lng)
        if item.isLeg, let mode = GoogleMapsLinks.travelMode(for: item.type),
           let endLat = item.endLat, let endLng = item.endLng {
            GoogleMapsLinks.open(GoogleMapsLinks.directionsURL(
                origin: origin, destination: (endLat, endLng), mode: mode))
        } else {
            GoogleMapsLinks.open(GoogleMapsLinks.pinURL(origin, label: item.title))
        }
    }

    // MARK: – Map

    @ViewBuilder
    private var mapSection: some View {
        if days.isEmpty {
            emptyCard("ยังไม่มีแผนการเดินทาง", "สร้างวันเดินทางก่อนจึงจะปักหมุดได้")
        } else {
            // TripMapView owns its own day strip (and defaults to Day 1 rather
            // than an ambiguous "whole trip") — nothing else needed here.
            TripMapView(
                trip: trip,
                days: days,
                activeDay: $activeDay,
                canEdit: true,
                onChanged: { await vm.loadItinerary(journeyId: trip.id) },
                locationVM: locationVM
            )
            .frame(height: 560)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    private func emptyCard(_ title: String, _ detail: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: "map")
                .font(.system(size: 26))
                .foregroundColor(Color.textSecondary)
            Text(title).font(.system(size: 14, weight: .semibold)).foregroundColor(Color.textPrimary)
            Text(detail)
                .font(.system(size: 12))
                .foregroundColor(Color.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    /// "22 พ.ย." from a plain YYYY-MM-DD, with no timezone conversion —
    /// `date` is a calendar date, not an instant.
    private func shortDate(_ iso: String?) -> String {
        guard let iso, iso.count >= 10 else { return "—" }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: String(iso.prefix(10))) else { return "—" }
        let out = DateFormatter()
        out.locale = Locale(identifier: "th_TH")
        out.setLocalizedDateFormatFromTemplate("dMMM")
        return out.string(from: d)
    }

    // MARK: – Expenses Section

    private var expensesSection: some View {
        VStack(spacing: 0) {
            HStack {
                Text("รายจ่าย")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                Spacer()
                Button {
                    hapticLight()
                    showAddExpense = true
                } label: {
                    Label("เพิ่มรายจ่าย", systemImage: "plus")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(Color.brand500)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)

            if expenses.isEmpty {
                Text("ยังไม่มีรายจ่าย")
                    .font(.system(size: 13))
                    .foregroundColor(Color.textSecondary)
                    .padding(.bottom, 14)
            } else {
                ForEach(Array(expenses.enumerated()), id: \.element.id) { idx, expense in
                    if idx > 0 {
                        Divider().padding(.horizontal, 16)
                    }
                    expenseRow(expense)
                }
            }
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: Color.black.opacity(0.06), radius: 8, x: 0, y: 2)
    }

    private func expenseRow(_ expense: TripExpense) -> some View {
        VStack(spacing: 0) {
            Button {
                hapticLight()
                expandedExpenseId = expandedExpenseId == expense.id ? nil : expense.id
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(expense.title)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(Color.textPrimary)
                        Text("\(pMap[expense.paidById ?? ""]?.displayName ?? "—") จ่าย · \(formatCreatedAt(expense.createdAt))")
                            .font(.system(size: 11))
                            .foregroundColor(Color.textSecondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 1) {
                        // baseAmount, not amount — see TripExpense. A ¥35,600
                        // ticket was rendering as "฿35,600".
                        Text(fmtTHB(expense.baseAmount))
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(Color.textPrimary)
                        if let original = expense.originalAmount(tripCurrency: trip.baseCurrency ?? "THB") {
                            Text(original)
                                .font(.system(size: 10))
                                .foregroundColor(Color.textSecondary)
                        }
                    }
                    Image(systemName: expandedExpenseId == expense.id ? "chevron.up" : "chevron.down")
                        .font(.system(size: 11))
                        .foregroundColor(Color.textSecondary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            .buttonStyle(.plain)

            if expandedExpenseId == expense.id {
                VStack(alignment: .leading, spacing: 4) {
                    Text("แบ่งกัน \(expense.splitModeLabel)")
                        .font(.system(size: 11))
                        .foregroundColor(Color.textSecondary)
                    ForEach(expense.expenseSplits ?? []) { s in
                        HStack {
                            Text(pMap[s.participantId]?.displayName ?? "—")
                                .font(.system(size: 12))
                                .foregroundColor(s.isPaid ? Color.textSecondary : Color.textPrimary)
                                .strikethrough(s.isPaid)
                            Spacer()
                            Text(fmtTHB(s.amount))
                                .font(.system(size: 12, weight: .semibold))
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 10)
            }
        }
    }

    // MARK: – Settlement Section

    private var settlementSection: some View {
        VStack(spacing: 10) {
            if isSettled {
                VStack(spacing: 6) {
                    Text("🎉").font(.system(size: 40))
                    Text("เคลียร์แล้วทุกคน!").font(.system(size: 16, weight: .bold)).foregroundColor(.green)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
                .background(Color.surface)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            } else if vm.settlement.isEmpty && trip.computedTotal == 0 {
                Text("ยังไม่มีข้อมูล")
                    .font(.system(size: 13))
                    .foregroundColor(Color.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 30)
                    .background(Color.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            } else {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 13))
                        .foregroundColor(.orange)
                    Text("ด้านล่างคือยอดโอนที่น้อยที่สุดเพื่อเคลียร์หนี้ทั้งหมด — ไม่ต้องโอนไปโอนมาหลายรอบ")
                        .font(.system(size: 12))
                        .foregroundColor(.orange)
                }
                .padding(12)
                .background(Color.orange.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 10))

                ForEach(vm.settlement) { s in
                    settlementRow(s)
                }
            }

            if !vm.payments.isEmpty {
                paymentsHistorySection
            }
        }
    }

    private var paymentsHistorySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ประวัติการโอน")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color.textSecondary)
                .padding(.top, 6)
            ForEach(vm.payments) { p in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(pMap[p.fromParticipant]?.displayName ?? "—") → \(pMap[p.toParticipant]?.displayName ?? "—")")
                            .font(.system(size: 13, weight: .medium))
                        Text(p.status == "confirmed" ? "ยืนยันแล้ว" : "รอยืนยัน")
                            .font(.system(size: 11))
                            .foregroundColor(p.status == "confirmed" ? .green : .orange)
                    }
                    Spacer()
                    Text(fmtTHB(p.amount)).font(.system(size: 13, weight: .bold))
                    if p.status == "pending" {
                        Button("ยืนยันรับ") {
                            Task {
                                try? await vm.confirmPayment(paymentId: p.id, fromParticipantId: p.fromParticipant, amount: p.amount, journeyId: trip.id)
                                await reload()
                            }
                        }
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(Color.brand500)
                    }
                }
                .padding(12)
                .background(Color.surface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private func settlementRow(_ s: TripSettlement) -> some View {
        let from = pMap[s.fromId]
        let to = pMap[s.toId]
        let canPay = from != nil && authVM.session != nil // host/any device can record on behalf for now
        return Button {
            guard let from, let to else { return }
            hapticLight()
            payTarget = PayTarget(from: from, to: to, amount: s.amount)
        } label: {
            HStack {
                Text("\(s.fromName) → \(s.toName)")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Color.textPrimary)
                Spacer()
                Text(fmtTHB(s.amount))
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Color.brand500)
            }
            .padding(14)
            .background(Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(!canPay)
    }

    // MARK: – Participants Section

    private var participantsSection: some View {
        VStack(spacing: 0) {
            HStack {
                Text("ผู้เข้าร่วม")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                Spacer()
                Button {
                    hapticLight()
                    showAddParticipant = true
                } label: {
                    Label("เพิ่มคน", systemImage: "person.badge.plus")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(Color.brand500)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)

            if participants.isEmpty {
                Text("ยังไม่มีผู้เข้าร่วม")
                    .font(.system(size: 13))
                    .foregroundColor(Color.textSecondary)
                    .padding(.bottom, 14)
            } else {
                ForEach(Array(participants.enumerated()), id: \.element.id) { idx, p in
                    if idx > 0 {
                        Divider().padding(.horizontal, 16)
                    }
                    participantRow(p)
                }
            }
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: Color.black.opacity(0.06), radius: 8, x: 0, y: 2)
        .padding(.bottom, 20)
    }

    private func participantRow(_ p: TripParticipant) -> some View {
        VStack(spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(p.displayName)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(Color.textPrimary)
                        if p.isHost {
                            Text("โฮสต์")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundColor(Color.brand500)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.brand500.opacity(0.1))
                                .clipShape(Capsule())
                        }
                    }
                    Text("ค้างชำระ \(fmtTHB(p.remaining))")
                        .font(.system(size: 12))
                        .foregroundColor(p.isPaid ? .green : .orange)
                }
                Spacer()

                if p.isPaid {
                    Label("จ่ายแล้ว", systemImage: "checkmark.circle.fill")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.green)
                }
            }

            if p.amountOwed > 0 {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.border)
                            .frame(height: 6)
                        RoundedRectangle(cornerRadius: 4)
                            .fill(p.isPaid ? Color.green : Color.brand500)
                            .frame(width: geo.size.width * min(1, p.amountPaid / p.amountOwed), height: 6)
                    }
                }
                .frame(height: 6)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    // MARK: – Helpers

    /// Import at mymaps.google.com — works from a phone browser — and it
    /// becomes a saved map viewable afterward in Google Maps itself, under
    /// Saved → Maps. No waypoint limit, unlike a directions deep link.
    private func exportKML() async {
        exportingKML = true
        defer { exportingKML = false }
        do {
            kmlURL = try await TripDocumentAPI.exportKML(tripId: trip.id, tripTitle: trip.title)
            hapticSuccess()
        } catch {
            toolError = error.localizedDescription
        }
    }

    private func exportPDF() async {
        exportingPDF = true
        defer { exportingPDF = false }
        do {
            pdfURL = try await TripDocumentAPI.exportPDF(tripId: trip.id, tripTitle: trip.title)
            hapticSuccess()
        } catch {
            toolError = error.localizedDescription
        }
    }

    private func reload() async {
        guard let orgId = authVM.org?.id else { return }
        await vm.load(orgId: orgId)
        if let updated = vm.trips.first(where: { $0.id == trip.id }) {
            trip = updated
        }
        await vm.loadSettlement(journeyId: trip.id)
        await vm.loadPayments(journeyId: trip.id)
        await vm.loadItinerary(journeyId: trip.id)
        photos = (try? await TripPhotoAPI.list(journeyId: trip.id)) ?? []
    }

    private func checkIn(_ item: TripItineraryItem) async {
        checkingIn = true
        defer { checkingIn = false }
        do {
            _ = try await TripItineraryAPI.checkIn(itemId: item.id)
            hapticSuccess()
            await vm.loadItinerary(journeyId: trip.id)
        } catch {
            toolError = error.localizedDescription
        }
    }

    private func addCheckInPhoto(_ data: Data, to item: TripItineraryItem) async {
        do {
            let photo = try await TripPhotoAPI.upload(journeyId: trip.id, itemId: item.id, data: data)
            photos.insert(photo, at: 0)
            if item.checkedInAt == nil { await checkIn(item) }
            hapticSuccess()
        } catch {
            toolError = error.localizedDescription
        }
    }

    @ViewBuilder
    private func statusBadge(_ status: String) -> some View {
        let (label, color) = statusInfo(status)
        Text(label)
            .font(.system(size: 11, weight: .semibold))
            .foregroundColor(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }

    private func statusInfo(_ status: String) -> (String, Color) {
        switch status {
        case "settled":   return ("เสร็จสิ้น", .purple)
        case "cancelled": return ("ยกเลิก", .red)
        default:          return ("กำลังดำเนินการ", .green)
        }
    }

    private func detailRow(icon: String, text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 12))
                .foregroundColor(Color.brand500)
            Text(text)
                .font(.system(size: 13))
                .foregroundColor(Color.textSecondary)
        }
    }

    private func formatEventDate(_ dateStr: String) -> String {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        guard let date = fmt.date(from: dateStr) else { return dateStr }
        fmt.dateFormat = "d MMM yyyy"
        fmt.locale = Locale(identifier: "th_TH")
        return fmt.string(from: date)
    }

    private func formatCreatedAt(_ dateStr: String) -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = fmt.date(from: dateStr) else { return dateStr }
        let out = DateFormatter()
        out.dateFormat = "d MMM"
        out.locale = Locale(identifier: "th_TH")
        return out.string(from: date)
    }
}

// MARK: – Add Expense Sheet (multi-payer + per-expense split method)

struct AddExpenseSheet: View {
    let journeyId: String
    let userId: String
    let participants: [TripParticipant]
    let onSave: () -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm = TripsViewModel()
    @State private var title = ""
    @State private var amountStr = ""
    @State private var category = "food"
    @State private var paidById: String = ""
    @State private var splitMode: TripSplitMode = .equal
    @State private var included: Set<String> = []
    @State private var values: [String: String] = [:]
    @State private var isSaving = false
    @State private var errorMsg: String?

    // Description, breakdown, and the scanned receipt behind it.
    @State private var note = ""
    @State private var lines: [DraftLine] = []
    @State private var currency = "THB"
    @State private var documentId: String?
    @State private var scanIssues: [String] = []
    @State private var photoItem: PhotosPickerItem?
    @State private var scanning = false

    /// A line as the form holds it — strings, because a half-typed number is a
    /// string and coercing on every keystroke fights the keyboard.
    struct DraftLine: Identifiable {
        let id = UUID()
        var description = ""
        var quantity = ""
        var unitPrice = ""
        var amount = ""
    }

    private var linesTotal: Double {
        lines.reduce(0) { $0 + (Double($1.amount) ?? 0) }
    }
    private var hasLines: Bool {
        lines.contains { !$0.description.trimmingCharacters(in: .whitespaces).isEmpty || Double($0.amount) != nil }
    }
    /// Reported, never enforced — a service charge or discount legitimately sits
    /// outside the itemised lines, and rewriting the total to match them is the
    /// bug that put ฿915.92 on an ฿856 bill.
    private var linesMismatch: Bool {
        hasLines && abs(linesTotal - (Double(amountStr) ?? 0)) > 0.01
    }

    private let categories = [("food", "🍽️ อาหาร"), ("transport", "🚗 เดินทาง"), ("accommodation", "🏨 ที่พัก"), ("activity", "🎯 กิจกรรม"), ("other", "💰 อื่นๆ")]

    var body: some View {
        NavigationStack {
            ZStack {
                Color.background.ignoresSafeArea()
                Form {
                    Section {
                        PhotosPicker(selection: $photoItem, matching: .images) {
                            HStack {
                                Image(systemName: scanning ? "hourglass" : "doc.text.viewfinder")
                                    .foregroundColor(Color.brand500)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(scanning ? "กำลังอ่านใบเสร็จ…" : "สแกนใบเสร็จ")
                                        .font(.system(size: 14, weight: .medium))
                                    Text("อ่านยอดและรายการย่อยให้ · ตรวจก่อนบันทึกได้")
                                        .font(.system(size: 11))
                                        .foregroundColor(Color.textSecondary)
                                }
                                Spacer()
                                if scanning { ProgressView().controlSize(.small) }
                            }
                        }
                        .disabled(scanning)

                        if documentId != nil {
                            Label("แนบใบเสร็จแล้ว — ผูกกับรายจ่ายนี้", systemImage: "paperclip")
                                .font(.system(size: 11))
                                .foregroundColor(Color.statusApproved)
                        }
                        ForEach(scanIssues.prefix(4), id: \.self) { issue in
                            Text("· \(issue)")
                                .font(.system(size: 10.5))
                                .foregroundColor(Color.statusReviewing)
                        }
                    }

                    Section("รายละเอียดรายจ่าย") {
                        TextField("ชื่อรายจ่าย (เช่น ค่าที่พัก)", text: $title)
                        HStack {
                            TextField("จำนวนเงิน", text: $amountStr).keyboardType(.decimalPad)
                            Text(currency)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(Color.textSecondary)
                        }
                        Picker("หมวด", selection: $category) {
                            ForEach(categories, id: \.0) { Text($0.1).tag($0.0) }
                        }
                        TextField("รายละเอียด (ไม่บังคับ)", text: $note, axis: .vertical)
                            .lineLimit(1...3)
                    }

                    Section {
                        ForEach($lines) { $line in
                            VStack(spacing: 6) {
                                TextField("ชื่อรายการ", text: $line.description)
                                    .font(.system(size: 14))
                                HStack(spacing: 8) {
                                    TextField("จำนวน", text: $line.quantity)
                                        .keyboardType(.decimalPad).frame(width: 62)
                                        .onChange(of: line.quantity) { _, _ in recalc(&line) }
                                    TextField("ราคา/หน่วย", text: $line.unitPrice)
                                        .keyboardType(.decimalPad)
                                        .onChange(of: line.unitPrice) { _, _ in recalc(&line) }
                                    TextField("รวม", text: $line.amount)
                                        .keyboardType(.decimalPad)
                                        .multilineTextAlignment(.trailing)
                                        .font(.system(size: 14, weight: .semibold))
                                }
                                .font(.system(size: 13))
                            }
                            .padding(.vertical, 2)
                        }
                        .onDelete { lines.remove(atOffsets: $0) }

                        Button {
                            hapticLight()
                            lines.append(DraftLine())
                        } label: {
                            Label("เพิ่มรายการย่อย", systemImage: "plus.circle")
                                .font(.system(size: 13))
                        }

                        if hasLines {
                            HStack {
                                Text("รวมรายการย่อย").font(.system(size: 12))
                                    .foregroundColor(Color.textSecondary)
                                Spacer()
                                Text("\(linesTotal, specifier: "%.2f") \(currency)")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(linesMismatch ? Color.statusReviewing : Color.textSecondary)
                            }
                        }
                        if linesMismatch {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("รายการย่อยรวมไม่ตรงกับยอดที่จ่าย — อาจมีค่าบริการหรือส่วนลดที่ไม่ได้แยกไว้ ระบบจะเก็บทั้งสองค่าตามที่กรอก")
                                    .font(.system(size: 10.5))
                                    .foregroundColor(Color.statusReviewing)
                                Button("ใช้ยอดรวมรายการย่อย") {
                                    amountStr = String(format: "%.2f", linesTotal)
                                }
                                .font(.system(size: 11, weight: .semibold))
                            }
                        }
                    } header: {
                        Text("รายการย่อย (ไม่บังคับ)")
                    } footer: {
                        Text("แยกได้ว่าอะไรเท่าไหร่ — สแกนใบเสร็จแล้วระบบจะเติมให้ หรือกดเพิ่มเอง")
                            .font(.system(size: 10.5))
                    }

                    Section("บิลนี้ใครออกก่อน") {
                        Picker("ผู้จ่าย", selection: $paidById) {
                            ForEach(participants) { p in
                                Text(p.displayName + (p.isHost ? " (โฮสต์)" : "")).tag(p.id)
                            }
                        }
                    }

                    Section("หารกันแบบไหน") {
                        Picker("วิธีหาร", selection: $splitMode) {
                            ForEach(TripSplitMode.allCases, id: \.self) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.segmented)
                    }

                    Section("ใครร่วมจ่ายบิลนี้") {
                        ForEach(participants) { p in
                            HStack {
                                Button {
                                    if included.contains(p.id) { included.remove(p.id) } else { included.insert(p.id) }
                                } label: {
                                    Image(systemName: included.contains(p.id) ? "checkmark.square.fill" : "square")
                                        .foregroundColor(included.contains(p.id) ? Color.brand500 : Color.textSecondary)
                                }
                                .buttonStyle(.plain)
                                Text(p.displayName)
                                Spacer()
                                if included.contains(p.id), splitMode != .equal {
                                    TextField(
                                        splitMode == .individual ? "บาท" : splitMode == .percent ? "%" : "หุ้น",
                                        text: Binding(
                                            get: { values[p.id] ?? "" },
                                            set: { values[p.id] = $0 }
                                        )
                                    )
                                    .keyboardType(.decimalPad)
                                    .multilineTextAlignment(.trailing)
                                    .frame(width: 70)
                                }
                            }
                        }
                    }

                    if let err = errorMsg {
                        Section { Text(err).foregroundColor(.red).font(.caption) }
                    }
                }
            }
            .navigationTitle("เพิ่มรายจ่าย")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ยกเลิก") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("บันทึก") { save() }
                        .disabled(title.isEmpty || amountStr.isEmpty || included.isEmpty || isSaving)
                        .fontWeight(.semibold)
                }
            }
            .onAppear {
                if included.isEmpty { included = Set(participants.map(\.id)) }
                if paidById.isEmpty { paidById = participants.first(where: \.isHost)?.id ?? participants.first?.id ?? userId }
            }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task {
                    guard let data = try? await item.loadTransferable(type: Data.self) else {
                        errorMsg = "อ่านรูปไม่สำเร็จ"; return
                    }
                    await scan(data)
                }
            }
        }
    }

    /// Keep a line's total consistent with quantity × unit price — only when
    /// BOTH are present. A line with just a total (the usual shape of a Thai
    /// receipt row) keeps what was typed; recomputing from a blank quantity
    /// would zero it.
    private func recalc(_ line: inout DraftLine) {
        guard let q = Double(line.quantity), let u = Double(line.unitPrice),
              !line.quantity.isEmpty, !line.unitPrice.isEmpty else { return }
        line.amount = String(format: "%.2f", (q * u).rounded(toPlaces: 2))
    }

    /// Read a receipt into the form.
    ///
    /// Fills in; it does not submit. Everything here came from a machine reading
    /// small print, and this codebase's recurring failure is a machine-read
    /// figure nobody compared to the paper that then reconciles perfectly with
    /// itself forever after.
    private func scan(_ data: Data) async {
        scanning = true
        scanIssues = []
        defer { scanning = false }
        do {
            let r = try await TripDocumentAPI.scanReceipt(
                tripId: journeyId, imageData: data,
                fileName: "receipt.jpg", mimeType: "image/jpeg")
            documentId = r.documentId
            if let vendor = r.vendorName, title.isEmpty { title = vendor }
            if let total = r.total { amountStr = String(format: "%.2f", total) }
            currency = r.currency
            lines = r.items.map { item in
                DraftLine(
                    description: item.description,
                    quantity:  item.quantity.map { String(format: "%g", $0) } ?? "",
                    unitPrice: item.unitPrice.map { String(format: "%.2f", $0) } ?? "",
                    amount:    String(format: "%.2f", item.amount)
                )
            }
            scanIssues = r.issues
            hapticSuccess()
        } catch {
            errorMsg = error.localizedDescription
        }
    }

    private func save() {
        guard let amount = Double(amountStr.replacingOccurrences(of: ",", with: "")) else {
            errorMsg = "กรุณากรอกจำนวนเงินให้ถูกต้อง"
            return
        }
        let splitValues: [String: Double] = values.reduce(into: [:]) { acc, kv in
            if let v = Double(kv.value) { acc[kv.key] = v }
        }
        isSaving = true
        Task {
            do {
                try await vm.addExpense(
                    journeyId: journeyId, paidById: paidById, title: title, amount: amount,
                    category: category, splitMode: splitMode, splitWith: Array(included),
                    splitValues: splitValues, allParticipantIds: participants.map(\.id),
                    note: note.isEmpty ? nil : note,
                    currency: currency,
                    // A scanned foreign receipt keeps its own currency; the rate
                    // is 1 until somebody sets one, so the trip total counts the
                    // printed figure rather than silently guessing a conversion.
                    exchangeRate: 1,
                    documentId: documentId,
                    items: lines
                        .filter { !$0.description.trimmingCharacters(in: .whitespaces).isEmpty }
                        .map { line in
                            TripsViewModel.DraftExpenseItem(
                                description: line.description.trimmingCharacters(in: .whitespaces),
                                quantity:  Double(line.quantity),
                                unitPrice: Double(line.unitPrice),
                                amount:    Double(line.amount) ?? 0
                            )
                        }
                )
                hapticSuccess()
                onSave()
                dismiss()
            } catch {
                errorMsg = error.localizedDescription
            }
            isSaving = false
        }
    }
}

// MARK: – Pay Sheet (settlement transfer — shows PromptPay QR, mirrors web's PaymentModal)

struct PaySheet: View {
    let target: TripDetailView.PayTarget
    let onPaid: (String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var note = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                VStack(spacing: 4) {
                    Text("\(target.from.displayName) → \(target.to.displayName)")
                        .font(.system(size: 14))
                        .foregroundColor(Color.textSecondary)
                    Text(fmtTHB(target.amount))
                        .font(.system(size: 32, weight: .black))
                        .foregroundColor(Color.brand500)
                }
                .padding(.top, 12)

                if let qrUrl = target.to.qrImageUrl, let url = URL(string: qrUrl) {
                    AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { ProgressView() }
                        .frame(width: 200, height: 200)
                } else if let ppValue = target.to.promptpayValue,
                          let img = PromptPayQR.image(target: ppValue, amount: target.amount) {
                    Image(uiImage: img).resizable().scaledToFit().frame(width: 200, height: 200)
                    Text(ppValue).font(.system(size: 14, weight: .semibold))
                } else {
                    Text("ไม่มีข้อมูล PromptPay — ติดต่อผู้รับโดยตรง")
                        .font(.system(size: 12))
                        .foregroundColor(Color.textSecondary)
                }

                TextField("หมายเหตุ (ไม่บังคับ)", text: $note)
                    .textFieldStyle(.roundedBorder)
                    .padding(.horizontal, 20)

                Button {
                    hapticSuccess()
                    onPaid(note.isEmpty ? nil : note)
                } label: {
                    Text("ฉันโอนแล้ว ✓")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color.green)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding(.horizontal, 20)

                Spacer()
            }
            .navigationTitle("จ่ายเงิน")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ปิด") { dismiss() } }
            }
        }
    }
}

// MARK: – Add Participant Sheet

struct TripAddParticipantSheet: View {
    let journeyId: String
    let totalExpenses: Double
    let participantCount: Int
    let onSave: (TripParticipant?) -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm = TripsViewModel()
    @State private var displayName = ""
    @State private var amountStr = ""
    @State private var isSaving = false
    @State private var errorMsg: String?

    private var suggestedAmount: Double {
        guard participantCount > 0, totalExpenses > 0 else { return 0 }
        return totalExpenses / Double(participantCount + 1)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.background.ignoresSafeArea()
                Form {
                    Section("ข้อมูลผู้เข้าร่วม") {
                        TextField("ชื่อ", text: $displayName)
                        HStack {
                            TextField("ยอดที่ต้องจ่าย (฿)", text: $amountStr)
                                .keyboardType(.decimalPad)
                            if suggestedAmount > 0 {
                                Button("หาร \(fmtTHB(suggestedAmount))") {
                                    amountStr = String(format: "%.2f", suggestedAmount)
                                }
                                .font(.caption)
                                .foregroundColor(Color.brand500)
                            }
                        }
                    }
                    if let err = errorMsg {
                        Section {
                            Text(err).foregroundColor(.red).font(.caption)
                        }
                    }
                }
            }
            .navigationTitle("เพิ่มผู้เข้าร่วม")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ยกเลิก") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("เพิ่ม") { save() }
                        .disabled(displayName.isEmpty || isSaving)
                        .fontWeight(.semibold)
                }
            }
        }
    }

    private func save() {
        let amount = Double(amountStr.replacingOccurrences(of: ",", with: "")) ?? 0
        isSaving = true
        Task {
            do {
                try await vm.addParticipant(journeyId: journeyId, displayName: displayName, amountOwed: amount)
                hapticSuccess()
                onSave(nil)
                dismiss()
            } catch {
                errorMsg = error.localizedDescription
            }
            isSaving = false
        }
    }
}
