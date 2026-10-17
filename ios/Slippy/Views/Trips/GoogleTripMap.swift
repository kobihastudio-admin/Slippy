import SwiftUI
import MapKit
import GoogleMaps

/// Only app-owned itinerary/location data belongs here. Apple search results
/// and MKDirections geometry stay on the Apple renderer.
struct GoogleTripMap: UIViewRepresentable {
    struct Pin: Equatable {
        let id: String
        let title: String
        let coordinate: CLLocationCoordinate2D
        let color: UIColor
        var label: String? = nil

        static func == (lhs: Pin, rhs: Pin) -> Bool {
            lhs.id == rhs.id && lhs.title == rhs.title && lhs.label == rhs.label
                && lhs.coordinate.latitude == rhs.coordinate.latitude
                && lhs.coordinate.longitude == rhs.coordinate.longitude
                && lhs.color.isEqual(rhs.color)
        }
    }

    let pins: [Pin]
    let selectedID: String?
    let region: MKCoordinateRegion?
    let cameraRevision: Int
    let bottomInset: CGFloat
    let onSelect: (String) -> Void
    let onTap: (CLLocationCoordinate2D) -> Void
    let onPOI: (String, CLLocationCoordinate2D) -> Void
    let onRegionChange: (MKCoordinateRegion) -> Void
    @Environment(\.colorScheme) private var colorScheme

    @MainActor
    static var isConfigured: Bool {
        #if DEBUG
        let environment = ProcessInfo.processInfo.environment
        if environment["SLIPPY_APPEARANCE_PREVIEW"] == "trip-map-test",
           environment["SLIPPY_MAPS_TEST_MISSING_KEY"] == "1" { return false }
        #endif
        return configured
    }

    @MainActor
    private static let configured: Bool = {
        guard let key = TripMapProvider.nativeKey(
            Bundle.main.object(forInfoDictionaryKey: "GoogleMapsIOSAPIKey") as? String
        ) else { return false }
        return GMSServices.provideAPIKey(key)
    }()

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> GMSMapView {
        let options = GMSMapViewOptions()
        options.camera = GMSCameraPosition(latitude: 33.59, longitude: 130.40, zoom: 10)
        let map = GMSMapView(options: options)
        map.accessibilityIdentifier = "trip.map.google"
        map.delegate = context.coordinator
        map.settings.compassButton = true
        // Do not start another location-permission or GPS workflow.
        map.isMyLocationEnabled = false
        return map
    }

    func updateUIView(_ map: GMSMapView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        map.overrideUserInterfaceStyle = colorScheme == .dark ? .dark : .light
        map.padding = UIEdgeInsets(top: 48, left: 8, bottom: bottomInset, right: 8)

        if coordinator.lastPins != pins || coordinator.lastSelectedID != selectedID {
            coordinator.lastPins = pins
            coordinator.lastSelectedID = selectedID
            let currentIDs = Set(pins.map(\.id))
            for id in coordinator.markers.keys.filter({ !currentIDs.contains($0) }) {
                coordinator.markers[id]?.map = nil
                coordinator.markers.removeValue(forKey: id)
            }
            for pin in pins {
                let marker = coordinator.markers[pin.id] ?? GMSMarker(position: pin.coordinate)
                coordinator.markers[pin.id] = marker
                marker.position = pin.coordinate
                marker.title = pin.title
                marker.userData = pin.id
                if let text = pin.label {
                    let badge = UILabel(frame: CGRect(x: 0, y: 0, width: 32, height: 32))
                    badge.text = text
                    badge.textAlignment = .center
                    badge.textColor = .white
                    badge.font = .systemFont(ofSize: 12, weight: .bold)
                    badge.adjustsFontSizeToFitWidth = true
                    badge.minimumScaleFactor = 0.5
                    badge.backgroundColor = pin.color
                    badge.layer.cornerRadius = 16
                    badge.layer.masksToBounds = true
                    badge.layer.borderColor = UIColor.white.cgColor
                    badge.layer.borderWidth = pin.id == selectedID ? 3 : 1
                    marker.iconView = badge
                    marker.groundAnchor = CGPoint(x: 0.5, y: 0.5)
                } else {
                    marker.icon = GMSMarker.markerImage(with: pin.color)
                }
                marker.zIndex = pin.id == selectedID ? 2 : 1
                marker.map = map
            }
        }
        if coordinator.lastRevision != cameraRevision, let region {
            coordinator.lastRevision = cameraRevision
            let halfLat = region.span.latitudeDelta / 2
            let halfLng = region.span.longitudeDelta / 2
            let bounds = GMSCoordinateBounds(
                coordinate: CLLocationCoordinate2D(
                    latitude: max(-85, region.center.latitude - halfLat),
                    longitude: region.center.longitude - halfLng),
                coordinate: CLLocationCoordinate2D(
                    latitude: min(85, region.center.latitude + halfLat),
                    longitude: region.center.longitude + halfLng))
            map.moveCamera(GMSCameraUpdate.fit(bounds, withPadding: 24))
        }
    }

    static func dismantleUIView(_ map: GMSMapView, coordinator: Coordinator) {
        map.delegate = nil
        map.clear()
    }

    final class Coordinator: NSObject, GMSMapViewDelegate {
        var parent: GoogleTripMap
        var lastRevision: Int?
        var lastPins: [Pin] = []
        var lastSelectedID: String?
        var markers: [String: GMSMarker] = [:]
        init(_ parent: GoogleTripMap) { self.parent = parent }

        func mapView(_ mapView: GMSMapView, didTap marker: GMSMarker) -> Bool {
            guard let id = marker.userData as? String else { return false }
            if id.hasPrefix("live:") { return false }
            parent.onSelect(id)
            return true
        }

        func mapView(_ mapView: GMSMapView, didTapAt coordinate: CLLocationCoordinate2D) {
            parent.onTap(coordinate)
        }

        func mapView(_ mapView: GMSMapView, didTapPOIWithPlaceID placeID: String,
                     name: String, location: CLLocationCoordinate2D) {
            parent.onPOI(name, location)
        }

        #if DEBUG
        func mapViewDidStartTileRendering(_ mapView: GMSMapView) {
            mapView.accessibilityValue = "loading"
        }

        func mapViewSnapshotReady(_ mapView: GMSMapView) {
            // SDK marker labels are not exposed as accessible hit targets.
            // Export projected points only for the synthetic local test fixture.
            if ProcessInfo.processInfo.environment["SLIPPY_APPEARANCE_PREVIEW"] == "trip-map-test" {
                let points = Dictionary(uniqueKeysWithValues: parent.pins.map { pin in
                    let point = mapView.projection.point(for: pin.coordinate)
                    return (pin.id, ["x": point.x / max(mapView.bounds.width, 1),
                                     "y": point.y / max(mapView.bounds.height, 1)])
                })
                if let data = try? JSONSerialization.data(withJSONObject: ["ready": true, "pins": points]),
                   let value = String(data: data, encoding: .utf8) {
                    mapView.accessibilityValue = value
                    return
                }
            }
            mapView.accessibilityValue = "snapshot-ready"
        }
        #endif

        func mapView(_ mapView: GMSMapView, idleAt position: GMSCameraPosition) {
            let bounds = GMSCoordinateBounds(region: mapView.projection.visibleRegion())
            let longitudeDelta = bounds.northEast.longitude - bounds.southWest.longitude
            let region = MKCoordinateRegion(
                center: position.target,
                span: MKCoordinateSpan(
                    latitudeDelta: max(bounds.northEast.latitude - bounds.southWest.latitude, 0.001),
                    longitudeDelta: max(longitudeDelta < 0 ? longitudeDelta + 360 : longitudeDelta, 0.001)))
            parent.onRegionChange(region)
        }
    }
}

#if DEBUG
struct TripMapTestPreview: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var activeDay: Int? = 1
    @StateObject private var locationVM = TripLocationViewModel()
    private let trip = try! JSONDecoder().decode(Trip.self, from: Data(
        #"{"id":"preview-map","organization_id":"preview","title":"Kyushu","status":"active","created_at":"2026-10-15"}"#.utf8))
    private let days = try! JSONDecoder().decode([TripItineraryDay].self, from: Data(
        #"[{"id":"preview-day","day_number":1,"title":"Fukuoka","trip_itinerary_items":[{"id":"preview-stop","day_id":"preview-day","sort_order":0,"type":"activity","title":"Kushida Shrine","status":"confirmed","lat":33.593,"lng":130.410}]}]"#.utf8))

    var body: some View {
        TripMapView(trip: trip, days: days, activeDay: $activeDay, canEdit: false,
                    onChanged: {}, locationVM: locationVM)
            .frame(height: 520)
            .environment(\.colorScheme, previewColorScheme ?? colorScheme)
    }

    private var previewColorScheme: ColorScheme? {
        switch ProcessInfo.processInfo.environment["SLIPPY_MAPS_TEST_STYLE"] {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }
}
#endif
