import SwiftUI
import MapKit
import Supabase

/// Drives `VenuePickerView` — MapKit place search (no API key, no location
/// permission needed; biased toward Thailand) plus the org's shared
/// `sport_venue_favorites` list.
@MainActor
final class VenuePickerViewModel: NSObject, ObservableObject {
    @Published var queryText = "" {
        didSet { completer.queryFragment = queryText }
    }
    @Published var suggestions: [MKLocalSearchCompletion] = []
    @Published var favorites: [SportVenueFavorite] = []
    @Published var isResolving = false
    @Published var isLoadingFavorites = false
    @Published var error: String?

    private let db = SupabaseManager.shared.client
    private let completer = MKLocalSearchCompleter()

    /// Bangkok-centered, wide enough to cover Thailand — keeps search results
    /// locally relevant without ever asking for location permission.
    private static let thailandRegion = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 13.7563, longitude: 100.5018),
        span: MKCoordinateSpan(latitudeDelta: 8, longitudeDelta: 8)
    )

    override init() {
        super.init()
        completer.resultTypes = .pointOfInterest
        completer.region = Self.thailandRegion
        completer.delegate = self
    }

    func loadFavorites(orgId: String) async {
        isLoadingFavorites = true
        defer { isLoadingFavorites = false }
        do {
            favorites = try await db
                .from("sport_venue_favorites")
                .select()
                .eq("organization_id", value: orgId)
                .order("created_at", ascending: false)
                .execute()
                .value
        } catch {
            self.error = error.localizedDescription
        }
    }

    struct ResolvedVenue {
        let name: String
        let address: String?
        let mapUrl: String
        let latitude: Double
        let longitude: Double
    }

    /// Resolves a tapped autocomplete row to a coordinate + a Google Maps
    /// link (the format people in Thailand actually expect to tap and open).
    func resolve(_ completion: MKLocalSearchCompletion) async -> ResolvedVenue? {
        isResolving = true
        defer { isResolving = false }
        let request = MKLocalSearch.Request(completion: completion)
        do {
            let response = try await MKLocalSearch(request: request).start()
            guard let item = response.mapItems.first else { return nil }
            let coordinate = item.placemark.coordinate
            let mapUrl = "https://www.google.com/maps/search/?api=1&query=\(coordinate.latitude),\(coordinate.longitude)"
            return ResolvedVenue(
                name: item.name ?? completion.title,
                address: item.placemark.title,
                mapUrl: mapUrl,
                latitude: coordinate.latitude,
                longitude: coordinate.longitude
            )
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func saveFavorite(orgId: String, userId: String, venue: ResolvedVenue) async {
        struct Insert: Encodable {
            let organization_id: String
            let created_by: String
            let name: String
            let address: String?
            let map_url: String
            let latitude: Double
            let longitude: Double
        }
        do {
            try await db
                .from("sport_venue_favorites")
                .insert(Insert(
                    organization_id: orgId, created_by: userId,
                    name: venue.name, address: venue.address,
                    map_url: venue.mapUrl, latitude: venue.latitude, longitude: venue.longitude
                ))
                .execute()
            await loadFavorites(orgId: orgId)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func deleteFavorite(_ favorite: SportVenueFavorite) async {
        do {
            try await db.from("sport_venue_favorites").delete().eq("id", value: favorite.id).execute()
            favorites.removeAll { $0.id == favorite.id }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension VenuePickerViewModel: MKLocalSearchCompleterDelegate {
    // MapKit delivers these callbacks on the main thread, so the conformance is
    // `nonisolated` (satisfying the non-isolated protocol) and we assume main-
    // actor isolation to touch @Published state without a data-race warning.
    nonisolated func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        MainActor.assumeIsolated { suggestions = completer.results }
    }

    nonisolated func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
        MainActor.assumeIsolated { self.error = error.localizedDescription }
    }
}
