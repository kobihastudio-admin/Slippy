import SwiftUI
import MapKit
import Supabase

/// The trip map — real Apple Maps, and the itinerary is edited on it.
///
/// MapKit rather than the web's Leaflet + OpenStreetMap tiles: it is already on
/// the device, needs no tile provider or API key, and handles gestures, labels
/// and dark mode the way the rest of iOS does. The pin colours and symbols come
/// from JourneyStyle, which mirrors the web's table, so the same trip reads the
/// same on both.
///
/// INTERACTION MODEL (mirrors the web map)
///   • A day strip is always visible at the top — which day you're looking at
///     is never a mystery, and tapping a chip switches it. "ทั้งหมด" shows every
///     day at once.
///   • Tapping the map always does something, like Google Maps: tap a pin to
///     see and act on it, tap empty ground to preview what's there and
///     optionally add it — no mode to arm first.
///   • "ย้ายตำแหน่ง" on a selected pin arms a one-shot move: the next tap on
///     empty ground relocates it. A drag would be more direct, but SwiftUI's
///     Map has no draggable annotation, and a fake one competes with the map's
///     own pan gesture — on a touch screen that means half your drags scroll
///     the map instead of moving the pin.
///
/// TWO SELECTION MECHANISMS, ON PURPOSE
/// Our own pins (Annotation) are hit-tested BY HAND: a gesture recognizer
/// attached to `Map` converts each pin's coordinate to a screen point and
/// compares it to where the tap landed. `Map`'s own `selection:` binding
/// cannot be used for these, because they are custom `Annotation` content, not
/// a `Marker`/`MapFeature` the binding resolves on its own.
/// Apple's OWN labeled places (a restaurant, a museum — content `Map` draws
/// itself, that this view never created) go through `selection: $selectedFeature`
/// instead: there is no coordinate to hand-test against, since this view does
/// not know where Apple placed that label. The two coexist because the tap
/// gesture is `.simultaneousGesture`, not exclusive — it does not stop `Map`
/// from also resolving its own feature underneath the same tap.
struct TripMapView: View {
    let trip: Trip
    let days: [TripItineraryDay]
    /// nil = the whole trip.
    @Binding var activeDay: Int?
    let canEdit: Bool
    /// Called after any write, so the parent can refresh from the server.
    let onChanged: () async -> Void
    /// Owned by the caller (TripDetailView), not this view: TripMapView is
    /// only on screen while the Map tab (or the itinerary tab's embedded
    /// map) is active, so a `@StateObject` here used to be torn down every
    /// time the user switched away — silently killing the ping loop and
    /// hiding the "currently sharing" banner mid-share. Lifting the instance
    /// to TripDetailView (which persists across its own tab switches) means
    /// sharing survives leaving this view; TripDetailView also renders the
    /// persistent banner itself now, so this view no longer shows its own.
    /// Placed right after the other required (non-defaulted) parameters, and
    /// before `showDayStrip`, so every call site's positional argument order
    /// stays unambiguous.
    @ObservedObject var locationVM: TripLocationViewModel
    /// False when a caller already renders its own day strip above this map
    /// (the itinerary tab, whose strip also drives the timeline list below).
    var showDayStrip: Bool = true

    @State private var camera: MapCameraPosition = .automatic
    @State private var selectedId: String?
    /// Non-nil while the next tap on open ground should relocate this item.
    @State private var movingId: String?
    /// A tapped, not-yet-added point — the "what's here" preview.
    @State private var pending: PendingPlace?
    @State private var busy = false
    @State private var errorText: String?
    @State private var showAddSheet = false
    @State private var showEditSheet = false
    @State private var showImportSheet = false
    @StateObject private var routeStore = TripRouteStore()

    /// Tapping a place Apple Maps already labels (a restaurant, a museum, a
    /// station) sets this via `Map`'s own `selection:` binding — a real named
    /// place, not a bare coordinate. `resolvePlace(_:)` turns it into `poi`.
    @State private var selectedFeature: MapFeature?
    /// A named place, resolved with its address/phone/website — ready to open
    /// straight into AddStopSheet without the "what's here" confirmation step
    /// `pending` needs, because this one is already a known, specific place.
    @State private var poi: ResolvedPlace?
    @State private var resolvingPOI = false

    @State private var showShareLocationSheet = false

    private struct PendingPlace {
        let coordinate: CLLocationCoordinate2D
        var name: String?
        var subtitle: String?
    }

    // MARK: – Data shaping

    private var scopedDays: [TripItineraryDay] {
        guard let activeDay else { return days }
        return days.filter { $0.dayNumber == activeDay }
    }

    /// Numbered stops, in itinerary order.
    private var pins: [(index: Int, day: TripItineraryDay, item: TripItineraryItem)] {
        var out: [(Int, TripItineraryDay, TripItineraryItem)] = []
        var n = 0
        for day in scopedDays {
            for item in (day.items ?? []) where item.coordinate != nil {
                n += 1
                out.append((n, day, item))
            }
        }
        return out.map { (index: $0.0, day: $0.1, item: $0.2) }
    }

    /// Legs with both ends, drawn as lines.
    private var legs: [TripItineraryItem] {
        scopedDays.flatMap { ($0.items ?? []).filter(\.isLeg) }
    }

    private var selected: TripItineraryItem? {
        pins.first { $0.item.id == selectedId }?.item
    }

    private var movingItem: TripItineraryItem? {
        pins.first { $0.item.id == movingId }?.item
    }

    /// The day a new stop lands in — the active one, or the first that exists.
    private var targetDay: TripItineraryDay? { scopedDays.first ?? days.first }

    // MARK: – Body

    var body: some View {
        VStack(spacing: 0) {
            daySelector
            mapArea
            bottomBar
        }
        .onAppear {
            // Start on a named day rather than "whole trip" — the whole point
            // is that you should never have to wonder which day you're on.
            if activeDay == nil, let first = days.first {
                activeDay = first.dayNumber
            }
            frameToPins()
            routeStore.ensure(for: legs)
            // locationVM's polling start/stop lives in TripDetailView now
            // (see locationVM's own doc comment above) — tied to the whole
            // trip screen's lifetime rather than to whichever embedding of
            // this map happens to be on screen.
        }
        .onChange(of: days.count) { _, _ in routeStore.ensure(for: legs) }
        .onChange(of: activeDay) { _, _ in
            selectedId = nil
            movingId = nil
            pending = nil
            frameToPins()
        }
        .onChange(of: selectedFeature) { _, feature in
            guard let feature, canEdit else { return }
            selectedId = nil
            pending = nil
            Task { await resolvePlace(feature) }
        }
        .alert("ทำรายการไม่สำเร็จ", isPresented: .constant(errorText != nil)) {
            Button("ตกลง") { errorText = nil }
        } message: {
            Text(errorText ?? "")
        }
        .sheet(isPresented: $showAddSheet, onDismiss: { pending = nil; poi = nil }) {
            if let day = targetDay {
                if let poi {
                    AddStopSheet(
                        coordinate: poi.coordinate,
                        placeNameHint: poi.title,
                        resolved: poi,
                        day: day,
                        baseCurrency: trip.baseCurrency ?? "THB",
                        onDone: { added in
                            showAddSheet = false
                            self.poi = nil
                            if added { Task { await onChanged() } }
                        }
                    )
                } else if let place = pending {
                    AddStopSheet(
                        coordinate: place.coordinate,
                        placeNameHint: place.name,
                        resolved: nil,
                        day: day,
                        baseCurrency: trip.baseCurrency ?? "THB",
                        onDone: { added in
                            showAddSheet = false
                            pending = nil
                            if added { Task { await onChanged() } }
                        }
                    )
                }
            }
        }
        .sheet(isPresented: $showEditSheet) {
            if let selected {
                EditStopSheet(item: selected) { changed in
                    showEditSheet = false
                    if changed { Task { await onChanged() } }
                }
            }
        }
        .sheet(isPresented: $showImportSheet) {
            if let day = targetDay {
                TripImportSavedPlacesSheet(
                    days: days,
                    defaultDay: day,
                    baseCurrency: trip.baseCurrency ?? "THB",
                    onDone: { added in
                        showImportSheet = false
                        if added { Task { await onChanged() } }
                    }
                )
            }
        }
        .sheet(isPresented: $showShareLocationSheet) {
            ShareLocationSheet { duration in
                showShareLocationSheet = false
                locationVM.startSharing(journeyId: trip.id, duration: duration)
            }
        }
    }

    // MARK: – Day strip

    @ViewBuilder
    private var daySelector: some View {
        if showDayStrip, !days.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    dayChip(label: "ทั้งหมด", isActive: activeDay == nil) { activeDay = nil }
                    ForEach(days) { day in
                        dayChip(label: "วันที่ \(day.dayNumber)", isActive: activeDay == day.dayNumber) {
                            activeDay = day.dayNumber
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .background(Color.surface)
        }
    }

    private func dayChip(label: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button {
            hapticLight()
            action()
        } label: {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(isActive ? .white : Color.textPrimary)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isActive ? Color.brand500 : Color.background, in: Capsule())
                .overlay(Capsule().stroke(isActive ? Color.clear : Color.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: – Map

    private var mapArea: some View {
        MapReader { proxy in
            Map(position: $camera, selection: canEdit ? $selectedFeature : .constant(nil)) {
                ForEach(legs, id: \.id) { leg in
                    if let computed = routeStore.legs[leg.id] {
                        // A real road or footpath is drawn solid because it IS
                        // the path taken; a direct line is dashed because it is
                        // not. See TripRouteStore.
                        MapPolyline(computed.polyline)
                            .stroke(
                                JourneyStyle.spec(leg.type).color.opacity(computed.isRealRoute ? 0.9 : 0.7),
                                style: StrokeStyle(
                                    lineWidth: computed.isRealRoute ? 5 : 4,
                                    lineCap: .round,
                                    dash: computed.isRealRoute ? [] : [10, 8]
                                )
                            )
                    } else if let a = leg.coordinate, let bLat = leg.endLat, let bLng = leg.endLng {
                        // Until the route arrives, show where it goes.
                        MapPolyline(coordinates: [
                            CLLocationCoordinate2D(latitude: a.lat, longitude: a.lng),
                            CLLocationCoordinate2D(latitude: bLat, longitude: bLng),
                        ])
                        .stroke(JourneyStyle.spec(leg.type).color.opacity(0.4),
                                style: StrokeStyle(lineWidth: 3, dash: [4, 6]))
                    }
                }

                ForEach(pins, id: \.item.id) { pin in
                    if let c = pin.item.coordinate {
                        Annotation(
                            pin.item.title,
                            coordinate: CLLocationCoordinate2D(latitude: c.lat, longitude: c.lng)
                        ) {
                            pinBadge(index: pin.index, item: pin.item)
                        }
                    }
                }

                ForEach(locationVM.others) { loc in
                    Annotation("", coordinate: CLLocationCoordinate2D(latitude: loc.latitude, longitude: loc.longitude)) {
                        livePinBadge(loc)
                    }
                }
            }
            .mapStyle(.standard(elevation: .flat))
            .frame(minHeight: 320)
            .simultaneousGesture(
                SpatialTapGesture().onEnded { value in
                    let point = value.location
                    guard let coordinate = proxy.convert(point, from: .local) else { return }
                    handleMapTap(coordinate, screenPoint: point, proxy: proxy)
                }
            )
            .overlay(alignment: .top) {
                // The "currently sharing" banner used to live here, but only
                // ever appeared while THIS view happened to be on screen —
                // TripDetailView renders it now, tab-independently, from the
                // same shared locationVM instance. See locationVM's doc
                // comment above.
                VStack(spacing: 6) {
                    if resolvingPOI { resolvingBanner }
                    movingBanner
                }
            }
            // Floats over the map itself — pinned to mapArea's own bottom
            // edge, growing upward — rather than living in the outer VStack's
            // linear flow. Both call sites embed this whole view in a fixed
            // outer `.frame(height:)` sized only for daySelector + map +
            // bottomBar; when this card lived in that flow, its own height
            // (address/notes/price can push it past 150pt) routinely
            // exceeded the remaining budget and got silently clipped by the
            // parent's `.clipShape` — visually indistinguishable from
            // "selecting a place does nothing." An overlay has no flow
            // height to exceed, so it always renders fully, on top of
            // bottomBar's own visible position, never crowding it out.
            .overlay(alignment: .bottom) {
                if let selected {
                    selectionCard(selected)
                } else if let pending {
                    pendingCard(pending)
                }
            }
        }
    }

    private var resolvingBanner: some View {
        HStack(spacing: 6) {
            ProgressView().controlSize(.small).tint(.white)
            Text("กำลังดึงรายละเอียดสถานที่…")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.white)
        }
        .padding(.horizontal, 12).padding(.vertical, 7)
        .background(Capsule().fill(Color.black.opacity(0.75)))
        .padding(.top, 10)
    }

    private func pinBadge(index: Int, item: TripItineraryItem) -> some View {
        let spec = JourneyStyle.spec(item.type)
        let isSelected = item.id == selectedId
        return ZStack {
            Circle()
                .fill(spec.color)
                .frame(width: isSelected ? 38 : 30, height: isSelected ? 38 : 30)
                .overlay(Circle().stroke(.white, lineWidth: 2.5))
                .shadow(radius: isSelected ? 5 : 2)
            Image(systemName: spec.symbol)
                .font(.system(size: isSelected ? 15 : 12, weight: .bold))
                .foregroundColor(.white)
        }
        .overlay(alignment: .topTrailing) {
            Text("\(index)")
                .font(.system(size: 9, weight: .bold))
                .foregroundColor(spec.color)
                .padding(3)
                .background(Circle().fill(.white))
                .offset(x: 5, y: -5)
        }
    }

    /// Two formatters, not one: `ISO8601DateFormatter()`'s default options
    /// can't parse PostgREST's `timestamptz` output, which normally includes
    /// fractional seconds — without `.withFractionalSeconds` this silently
    /// fails to parse every single time, and the `?? true` fallback below
    /// then makes every live pin render as permanently stale regardless of
    /// how recent it actually is. PostgREST isn't guaranteed to always
    /// include fractional seconds either, so the fractional formatter is
    /// tried first and the plain one is a fallback, not a replacement.
    private static let iso8601Fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let iso8601Plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private func livePinBadge(_ loc: TripLocationAPI.MemberLocation) -> some View {
        let parsed = Self.iso8601Fractional.date(from: loc.recordedAt) ?? Self.iso8601Plain.date(from: loc.recordedAt)
        let stale = (parsed.map { Date().timeIntervalSince($0) > 60 }) ?? true
        return ZStack {
            Circle()
                .fill(stale ? Color.gray : Color.brand500)
                .frame(width: 26, height: 26)
                .overlay(Circle().stroke(.white, lineWidth: 2))
                .shadow(radius: 3)
            Image(systemName: "location.fill")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(.white)
        }
        .opacity(stale ? 0.6 : 1)
    }

    @ViewBuilder
    private var movingBanner: some View {
        if let movingItem {
            HStack(spacing: 8) {
                Text("แตะตำแหน่งใหม่ของ \(movingItem.title)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white)
                Button {
                    hapticLight()
                    movingId = nil
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.white.opacity(0.85))
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(Capsule().fill(Color.black.opacity(0.75)))
            .padding(.top, 10)
        }
    }

    // MARK: – Controls

    private var bottomBar: some View {
        HStack(spacing: 8) {
            if canEdit {
                Button {
                    hapticLight()
                    showImportSheet = true
                } label: {
                    Label("นำเข้าจาก Google Maps", systemImage: "square.and.arrow.down.on.square")
                        .font(.system(size: 12, weight: .semibold))
                }
                .buttonStyle(.bordered)
            }
            Button {
                hapticLight()
                if locationVM.mySession != nil { locationVM.stopSharing() } else { showShareLocationSheet = true }
            } label: {
                Label(locationVM.mySession != nil ? "หยุดแชร์ตำแหน่ง" : "แชร์ตำแหน่ง",
                      systemImage: locationVM.mySession != nil ? "location.slash.fill" : "location.fill")
                    .font(.system(size: 12, weight: .semibold))
            }
            .buttonStyle(.bordered)
            Spacer()
            if busy { ProgressView().controlSize(.small) }
            Button {
                hapticLight()
                frameToPins()
            } label: {
                Image(systemName: "scope").font(.system(size: 13, weight: .semibold))
            }
            .buttonStyle(.bordered)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(Color.surface)
    }

    private func selectionCard(_ item: TripItineraryItem) -> some View {
        let spec = JourneyStyle.spec(item.type)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: spec.symbol)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(spec.color)
                    .frame(width: 30, height: 30)
                    .background(spec.color.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))

                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Color.textPrimary)
                    Text([spec.label, item.timeFrom.map { String($0.prefix(5)) }]
                            .compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 11))
                        .foregroundColor(Color.textSecondary)
                    if item.location != nil || item.endLocation != nil {
                        Text([item.location, item.endLocation].compactMap { $0 }.joined(separator: " → "))
                            .font(.system(size: 11))
                            .foregroundColor(Color.textSecondary)
                            .lineLimit(2)
                    }
                    if let route = routeStore.legs[item.id], item.isLeg {
                        Text(route.isRealRoute
                             ? String(format: "เส้นทางจริง %.1f กม.%@", route.distanceMetres / 1000,
                                      route.expectedSeconds.map { " · ~\(Int($0 / 60)) นาที" } ?? "")
                             : String(format: "เส้นตรง %.1f กม. (ไม่ใช่เส้นทางจริง)", route.distanceMetres / 1000))
                            .font(.system(size: 10))
                            .foregroundColor(Color.textSecondary)
                    }
                    if item.baseAmount > 0 {
                        HStack(spacing: 6) {
                            Text(fmtTHB(item.baseAmount))
                                .font(.system(size: 12, weight: .bold))
                            if let original = item.originalAmount(tripCurrency: trip.baseCurrency ?? "THB") {
                                Text(original)
                                    .font(.system(size: 10))
                                    .foregroundColor(Color.textSecondary)
                            }
                        }
                    }
                }
                Spacer(minLength: 0)

                VStack(spacing: 10) {
                    if let c = item.coordinate {
                        Button {
                            hapticLight()
                            GoogleMapsLinks.open(GoogleMapsLinks.streetViewURL((c.lat, c.lng)))
                        } label: {
                            Image(systemName: "figure.walk").font(.system(size: 15))
                        }
                        .buttonStyle(.borderless)
                    }

                    Button {
                        hapticLight()
                        openInGoogleMaps(item)
                    } label: {
                        Image(systemName: "arrow.up.right.square").font(.system(size: 15))
                    }
                    .buttonStyle(.borderless)

                    if canEdit {
                        Button {
                            hapticLight()
                            showEditSheet = true
                        } label: {
                            Image(systemName: "pencil").font(.system(size: 13))
                        }
                        .buttonStyle(.borderless)

                        Button {
                            hapticLight()
                            movingId = item.id
                            selectedId = nil
                        } label: {
                            Image(systemName: "arrow.up.and.down.and.arrow.left.and.right").font(.system(size: 13))
                        }
                        .buttonStyle(.borderless)

                        Button(role: .destructive) {
                            Task { await deleteSelected(item) }
                        } label: {
                            Image(systemName: "trash").font(.system(size: 13))
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }

            if item.provider != nil || item.confirmationCode != nil || item.notes != nil {
                Divider()
                VStack(alignment: .leading, spacing: 3) {
                    if let provider = item.provider {
                        Text(provider)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(Color.textPrimary)
                    }
                    if let code = item.confirmationCode {
                        Text("รหัสจอง \(code)")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(Color.textSecondary)
                    }
                    if let notes = item.notes, !notes.isEmpty {
                        Text(notes)
                            .font(.system(size: 11))
                            .foregroundColor(Color.textSecondary)
                    }
                }
            }
        }
        .padding(12)
        .background(Color.surface, in: RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.16), radius: 10, y: 4)
        .padding(.horizontal, 10)
        .padding(.bottom, 10)
    }

    private func pendingCard(_ place: PendingPlace) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "mappin.circle.fill")
                .font(.system(size: 20))
                .foregroundColor(Color.brand500)

            VStack(alignment: .leading, spacing: 2) {
                Text(place.name ?? "กำลังค้นหา…")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                if let subtitle = place.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 11))
                        .foregroundColor(Color.textSecondary)
                        .lineLimit(2)
                }
                Text(String(format: "%.5f, %.5f", place.coordinate.latitude, place.coordinate.longitude))
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(Color.textSecondary)
            }
            Spacer(minLength: 0)

            HStack(spacing: 14) {
                if canEdit {
                    Button {
                        hapticLight()
                        showAddSheet = true
                    } label: {
                        Image(systemName: "plus.circle.fill").font(.system(size: 20))
                            .foregroundColor(Color.brand500)
                    }
                    .buttonStyle(.borderless)
                }
                Button {
                    hapticLight()
                    pending = nil
                } label: {
                    Image(systemName: "xmark.circle").font(.system(size: 18))
                        .foregroundColor(Color.textSecondary)
                }
                .buttonStyle(.borderless)
            }
        }
        .padding(12)
        .background(Color.surface, in: RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.16), radius: 10, y: 4)
        .padding(.horizontal, 10)
        .padding(.bottom, 10)
    }

    /// Directions when the type has a road/rail equivalent Google can route
    /// (see GoogleMapsLinks.travelMode); a plain pin otherwise — a flight or a
    /// ferry has no such equivalent, and asking Google to drive there would be
    /// wrong in a way that looks like it worked.
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

    // MARK: – Actions

    /// Hit-tests pins by hand — see the type header for why `Map`'s own
    /// `selection:` binding is not used. A tap within ~26pt of a pin selects
    /// it; anything else previews a new place (or, while `movingId` is set,
    /// relocates that item there).
    private func handleMapTap(_ coordinate: CLLocationCoordinate2D, screenPoint: CGPoint, proxy: MapProxy) {
        if let movingId, let item = pins.first(where: { $0.item.id == movingId })?.item {
            self.movingId = nil
            Task { await moveSelected(item, to: coordinate) }
            return
        }

        if let nearest = pins.min(by: {
            screenDistance($0.item, to: screenPoint, proxy: proxy) < screenDistance($1.item, to: screenPoint, proxy: proxy)
        }), screenDistance(nearest.item, to: screenPoint, proxy: proxy) < 26 {
            hapticLight()
            pending = nil
            selectedId = nearest.item.id
            return
        }

        guard canEdit else {
            selectedId = nil
            return
        }
        selectedId = nil
        pending = PendingPlace(coordinate: coordinate)
        Task { await lookUpPlaceName(coordinate) }
    }

    private func screenDistance(_ item: TripItineraryItem, to point: CGPoint, proxy: MapProxy) -> CGFloat {
        guard let c = item.coordinate,
              let p = proxy.convert(CLLocationCoordinate2D(latitude: c.lat, longitude: c.lng), to: .local)
        else { return .greatestFiniteMagnitude }
        return hypot(p.x - point.x, p.y - point.y)
    }

    /// Names the tapped point so the preview card reads like a place, not a
    /// coordinate pair. CLGeocoder is used rather than the server's Nominatim
    /// proxy — on-device, no extra network permission, coordinates never leave
    /// Apple's stack. Failure just leaves the raw coordinates showing.
    private func lookUpPlaceName(_ coordinate: CLLocationCoordinate2D) async {
        guard let mark = try? await CLGeocoder().reverseGeocodeLocation(
            CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        ).first else { return }
        // The user may have tapped elsewhere, or dismissed, before this
        // returns — only apply it if it is still about the same point.
        guard let current = pending?.coordinate,
              current.latitude == coordinate.latitude, current.longitude == coordinate.longitude else { return }
        pending?.name = mark.name ?? mark.thoroughfare ?? mark.locality
        pending?.subtitle = [mark.locality, mark.administrativeArea, mark.country].compactMap { $0 }.joined(separator: ", ")
    }

    /// Resolves a tapped `MapFeature` (a name and a rough category — everything
    /// `Map`'s built-in selection gives for free) into a full place. `MapFeature`
    /// has no phone/address of its own, so this runs one `MKLocalSearch` for the
    /// feature's own name near its own coordinate and keeps whichever result is
    /// actually closest — a chain name (there is more than one "Starbucks") must
    /// resolve to the branch that was tapped, not whichever the API lists first.
    private func resolvePlace(_ feature: MapFeature) async {
        resolvingPOI = true
        defer { resolvingPOI = false }

        var address: String?, phone: String?, website: String?
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = feature.title
        request.region = MKCoordinateRegion(center: feature.coordinate,
                                             latitudinalMeters: 300, longitudinalMeters: 300)
        let here = CLLocation(latitude: feature.coordinate.latitude, longitude: feature.coordinate.longitude)
        if let response = try? await MKLocalSearch(request: request).start() {
            let nearest = response.mapItems.min {
                CLLocation(latitude: $0.placemark.coordinate.latitude, longitude: $0.placemark.coordinate.longitude).distance(from: here)
                    < CLLocation(latitude: $1.placemark.coordinate.latitude, longitude: $1.placemark.coordinate.longitude).distance(from: here)
            }
            if let nearest {
                let mark = nearest.placemark
                address = [mark.thoroughfare, mark.locality, mark.administrativeArea, mark.country]
                    .compactMap { $0 }.joined(separator: ", ")
                phone = nearest.phoneNumber
                website = nearest.url?.absoluteString
            }
        }

        // The user may have tapped a different feature, or dismissed, before
        // this search returned.
        guard selectedFeature == feature else { return }
        poi = ResolvedPlace(
            coordinate: feature.coordinate,
            title: feature.title ?? "สถานที่",
            suggestedType: Self.appType(for: feature.pointOfInterestCategory),
            address: address?.isEmpty == false ? address : nil,
            phone: phone,
            website: website
        )
        showAddSheet = true
    }

    /// A best-effort guess only — AddStopSheet's type picker is always right
    /// there to correct it, so a wrong guess costs one tap, never a bad write.
    fileprivate static func appType(for category: MKPointOfInterestCategory?) -> String {
        guard let category else { return "activity" }
        if #available(iOS 18.0, *) {
            if category == .spa { return "onsen" }
            if category == .rvPark { return "hotel" }
        }
        switch category {
        case .restaurant, .cafe, .bakery, .foodMarket, .brewery, .winery, .nightlife:
            return "restaurant"
        case .hotel, .campground, .marina:
            return "hotel"
        case .store, .pharmacy, .laundry:
            return "shopping"
        default:
            return "activity"
        }
    }

    private func moveSelected(_ item: TripItineraryItem, to coordinate: CLLocationCoordinate2D) async {
        busy = true
        defer { busy = false }
        do {
            _ = try await TripItineraryAPI.move(itemId: item.id,
                                                lat: coordinate.latitude,
                                                lng: coordinate.longitude)
            hapticSuccess()
            // Re-read from the server rather than patching locally: the parent
            // owns the days array, and a local edit that the server rejected
            // would leave the pin somewhere the database has never heard of.
            await onChanged()
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func deleteSelected(_ item: TripItineraryItem) async {
        busy = true
        defer { busy = false }
        do {
            try await TripItineraryAPI.remove(itemId: item.id)
            selectedId = nil
            hapticSuccess()
            await onChanged()
        } catch {
            errorText = error.localizedDescription
        }
    }

    /// Fit the camera to whatever is currently shown.
    private func frameToPins() {
        let coords = pins.compactMap(\.item.coordinate)
        guard !coords.isEmpty else { return }

        if coords.count == 1 {
            camera = .region(MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: coords[0].lat, longitude: coords[0].lng),
                latitudinalMeters: 2_000, longitudinalMeters: 2_000))
            return
        }

        let lats = coords.map(\.lat), lngs = coords.map(\.lng)
        let minLat = lats.min()!, maxLat = lats.max()!
        let minLng = lngs.min()!, maxLng = lngs.max()!
        camera = .region(MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2,
                                           longitude: (minLng + maxLng) / 2),
            span: MKCoordinateSpan(
                // A floor, because a day spent in one neighbourhood has a span of
                // almost zero and would otherwise zoom to street level.
                latitudeDelta:  max((maxLat - minLat) * 1.4, 0.01),
                longitudeDelta: max((maxLng - minLng) * 1.4, 0.01))))
    }
}

/// A real, named place resolved from a tapped map feature — everything
/// AddStopSheet needs to file it without the user typing any of it.
fileprivate struct ResolvedPlace {
    let coordinate: CLLocationCoordinate2D
    let title: String
    let suggestedType: String
    let address: String?
    let phone: String?
    let website: String?
}

// MARK: – Share location

private struct ShareLocationSheet: View {
    let onPick: (TripLocationAPI.Duration) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("เพื่อนร่วมทริปจะเห็นตำแหน่งของคุณแบบสด ๆ จนกว่าจะหมดเวลาหรือคุณกดหยุด")
                        .font(.system(size: 12))
                        .foregroundColor(Color.textSecondary)
                }
                ForEach([
                    (TripLocationAPI.Duration.m15, "15 นาที"),
                    (.h1, "1 ชั่วโมง"),
                    (.h4, "4 ชั่วโมง"),
                    (.eod, "จนถึงสิ้นวัน"),
                ], id: \.0) { duration, label in
                    Button(label) { onPick(duration); dismiss() }
                }
            }
            .navigationTitle("แชร์ตำแหน่งนานแค่ไหน")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ยกเลิก") { dismiss() } }
            }
        }
    }
}

// MARK: – Add stop

/// Names and files a stop dropped on the map.
///
/// `placeNameHint` comes from the map's own tap-to-inspect preview, which has
/// usually already resolved a name by the time this sheet opens — reused
/// here instead of geocoding the same point twice.
private struct AddStopSheet: View {
    let coordinate: CLLocationCoordinate2D
    let placeNameHint: String?
    /// Set when this stop came from tapping a place Apple Maps already knows
    /// about — pre-fills everything below, all of it still editable before
    /// anything is saved.
    let resolved: ResolvedPlace?
    let day: TripItineraryDay
    let baseCurrency: String
    let onDone: (Bool) -> Void

    @State private var title: String
    @State private var type: String
    @State private var timeFrom = ""
    @State private var placeName: String?
    @State private var address: String
    @State private var phone: String
    @State private var website: String
    @State private var saving = false
    @State private var errorText: String?
    @Environment(\.dismiss) private var dismiss

    init(coordinate: CLLocationCoordinate2D, placeNameHint: String?, resolved: ResolvedPlace?,
         day: TripItineraryDay, baseCurrency: String, onDone: @escaping (Bool) -> Void) {
        self.coordinate = coordinate
        self.placeNameHint = placeNameHint
        self.resolved = resolved
        self.day = day
        self.baseCurrency = baseCurrency
        self.onDone = onDone
        _title = State(initialValue: resolved?.title ?? "")
        _type = State(initialValue: resolved?.suggestedType ?? "activity")
        _address = State(initialValue: resolved?.address ?? "")
        _phone = State(initialValue: resolved?.phone ?? "")
        _website = State(initialValue: resolved?.website ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("รายละเอียด") {
                    TextField("ชื่อสถานที่", text: $title)
                    Picker("ประเภท", selection: $type) {
                        ForEach(JourneyStyle.creatable, id: \.self) { t in
                            Label(JourneyStyle.spec(t).label, systemImage: JourneyStyle.spec(t).symbol)
                                .tag(t)
                        }
                    }
                    TextField("เวลา (เช่น 09:30)", text: $timeFrom)
                        .keyboardType(.numbersAndPunctuation)
                }

                // Editable regardless of source — filled in automatically for a
                // place resolved from the map, blank and optional otherwise.
                Section("ข้อมูลสถานที่") {
                    TextField("ที่อยู่", text: $address, axis: .vertical)
                        .lineLimit(1...3)
                    TextField("เบอร์โทร", text: $phone)
                        .keyboardType(.phonePad)
                    TextField("เว็บไซต์", text: $website)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                }

                Section {
                    LabeledContent("วันที่") {
                        Text("วันที่ \(day.dayNumber)\(day.city.map { " · \($0)" } ?? "")")
                    }
                    LabeledContent("พิกัด") {
                        Text(String(format: "%.5f, %.5f", coordinate.latitude, coordinate.longitude))
                            .font(.system(size: 12, design: .monospaced))
                    }
                }

                if let errorText {
                    Section { Text(errorText).foregroundColor(.red).font(.system(size: 12)) }
                }
            }
            .navigationTitle("เพิ่มจุดแวะ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ยกเลิก") { onDone(false); dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "กำลังบันทึก…" : "เพิ่ม") { Task { await save() } }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || saving)
                }
            }
            .task { await lookUpName() }
        }
    }

    private func lookUpName() async {
        // A resolved place already has everything — no geocoding needed.
        if resolved != nil {
            placeName = address.isEmpty ? nil : address
            return
        }
        if let placeNameHint, !placeNameHint.isEmpty {
            placeName = placeNameHint
            if title.isEmpty { title = placeNameHint }
            return
        }
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        // Failure is fine — the user can type the name. A geocoder that is slow
        // or unavailable must not block placing a pin.
        guard let mark = try? await CLGeocoder().reverseGeocodeLocation(location).first else { return }
        let name = mark.name ?? mark.thoroughfare ?? mark.locality
        placeName = [mark.name, mark.locality, mark.country].compactMap { $0 }.joined(separator: ", ")
        if title.isEmpty, let name { title = name }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        var details: [String: AnyJSON] = [:]
        let trimmedAddress = address.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPhone = phone.trimmingCharacters(in: .whitespaces)
        let trimmedWebsite = website.trimmingCharacters(in: .whitespaces)
        if !trimmedAddress.isEmpty { details["address"] = .string(trimmedAddress) }
        if !trimmedPhone.isEmpty { details["phone"] = .string(trimmedPhone) }
        if !trimmedWebsite.isEmpty { details["website"] = .string(trimmedWebsite) }
        do {
            _ = try await TripItineraryAPI.addStop(
                dayId: day.id,
                title: title.trimmingCharacters(in: .whitespaces),
                type: type,
                lat: coordinate.latitude,
                lng: coordinate.longitude,
                location: placeName ?? (trimmedAddress.isEmpty ? nil : trimmedAddress),
                timeFrom: timeFrom.isEmpty ? nil : timeFrom,
                baseCurrency: baseCurrency,
                details: details
            )
            hapticSuccess()
            onDone(true)
            dismiss()
        } catch {
            errorText = error.localizedDescription
        }
    }
}

// MARK: – Edit stop

/// Renames, retimes, or adds a note to an existing stop — the "change it"
/// affordance that tapping a pin was missing entirely before.
private struct EditStopSheet: View {
    let item: TripItineraryItem
    let onDone: (Bool) -> Void

    @State private var title: String
    @State private var timeFrom: String
    @State private var notes: String
    @State private var location: String
    @State private var address: String
    @State private var phone: String
    @State private var website: String
    @State private var saving = false
    @State private var errorText: String?
    @Environment(\.dismiss) private var dismiss

    init(item: TripItineraryItem, onDone: @escaping (Bool) -> Void) {
        self.item = item
        self.onDone = onDone
        _title = State(initialValue: item.title)
        _timeFrom = State(initialValue: item.timeFrom.map { String($0.prefix(5)) } ?? "")
        _notes = State(initialValue: item.notes ?? "")
        _location = State(initialValue: item.location ?? "")
        _address = State(initialValue: item.placeAddress ?? "")
        _phone = State(initialValue: item.placePhone ?? "")
        _website = State(initialValue: item.placeWebsite ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("รายละเอียด") {
                    TextField("ชื่อสถานที่", text: $title)
                    TextField("เวลา (เช่น 09:30)", text: $timeFrom)
                        .keyboardType(.numbersAndPunctuation)
                    TextField("โน้ต", text: $notes, axis: .vertical)
                        .lineLimit(1...4)
                }
                Section("ข้อมูลสถานที่") {
                    TextField("ตำแหน่ง", text: $location)
                    TextField("ที่อยู่", text: $address, axis: .vertical)
                        .lineLimit(1...3)
                    TextField("เบอร์โทร", text: $phone)
                        .keyboardType(.phonePad)
                    TextField("เว็บไซต์", text: $website)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                }
                if let errorText {
                    Section { Text(errorText).foregroundColor(.red).font(.system(size: 12)) }
                }
            }
            .navigationTitle("แก้ไขจุดแวะ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ยกเลิก") { onDone(false); dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "กำลังบันทึก…" : "บันทึก") { Task { await save() } }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || saving)
                }
            }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        // Merge onto whatever details already exist (e.g. a flight_number from
        // a document import) rather than replacing the column outright.
        var details = item.details ?? [:]
        let trimmedAddress = address.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPhone = phone.trimmingCharacters(in: .whitespaces)
        let trimmedWebsite = website.trimmingCharacters(in: .whitespaces)
        trimmedAddress.isEmpty ? (details["address"] = nil) : (details["address"] = .string(trimmedAddress))
        trimmedPhone.isEmpty ? (details["phone"] = nil) : (details["phone"] = .string(trimmedPhone))
        trimmedWebsite.isEmpty ? (details["website"] = nil) : (details["website"] = .string(trimmedWebsite))
        do {
            _ = try await TripItineraryAPI.update(
                itemId: item.id,
                title: title.trimmingCharacters(in: .whitespaces),
                timeFrom: timeFrom.isEmpty ? nil : timeFrom,
                notes: notes.trimmingCharacters(in: .whitespaces).isEmpty ? nil : notes,
                location: location.trimmingCharacters(in: .whitespaces).isEmpty ? nil : location,
                details: details
            )
            hapticSuccess()
            onDone(true)
            dismiss()
        } catch {
            errorText = error.localizedDescription
        }
    }
}
