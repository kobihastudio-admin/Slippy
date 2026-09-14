import Foundation
import CoreLocation

/// Foreground-only live location for one trip screen. No
/// NSLocationAlwaysAndWhenInUseUsageDescription is requested — sharing stops
/// the moment the app backgrounds, per the spec's locked-in decision.
@MainActor
final class TripLocationViewModel: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var mySession: TripLocationAPI.Session?
    @Published var others: [TripLocationAPI.MemberLocation] = []
    @Published var permissionDenied = false
    @Published var errorText: String?

    private let manager = CLLocationManager()
    private var journeyId: String?
    private var pingTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func startSharing(journeyId: String, duration: TripLocationAPI.Duration) {
        self.journeyId = journeyId
        Task {
            guard await TripLocationAPI.isFeatureEnabled(tripId: journeyId) else {
                errorText = "ฟีเจอร์นี้ยังไม่เปิดใช้งาน"
                return
            }
            do {
                let session = try await TripLocationAPI.start(journeyId: journeyId, duration: duration)
                mySession = session
                manager.requestWhenInUseAuthorization()
                manager.startUpdatingLocation()
                startPingLoop(sessionId: session.id, journeyId: journeyId)
            } catch {
                errorText = error.localizedDescription
            }
        }
    }

    func stopSharing() {
        guard let session = mySession else { return }
        pingTask?.cancel()
        manager.stopUpdatingLocation()
        Task {
            try? await TripLocationAPI.stop(sessionId: session.id)
            mySession = nil
        }
    }

    /// Two formatters, not one: PostgREST's timestamptz output usually
    /// includes fractional seconds, but isn't guaranteed to — try the
    /// fractional variant first and fall back to the plain one rather than
    /// letting an unexpected format silently fail to parse (see the same
    /// pattern, and the same reasoning, in TripMapView's livePinBadge).
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
    private static func parseISODate(_ s: String) -> Date? {
        iso8601Fractional.date(from: s) ?? iso8601Plain.date(from: s)
    }

    /// Posts the current location every 12 seconds while a session is
    /// active — inside the spec's 10-15s cadence, matched to how often other
    /// members' pins should visibly move.
    ///
    /// Also stops itself once the session's own expires_at has passed:
    /// relying only on `mySession != nil` meant this loop kept running (and
    /// kept pinging a session the server had already started refusing
    /// writes for, per pingLocation's own expiry check) until the user
    /// happened to reopen the map and notice, or force-quit the app —
    /// nothing ever cleared `mySession` on the client side once the clock
    /// ran out.
    private func startPingLoop(sessionId: String, journeyId: String) {
        pingTask?.cancel()
        pingTask = Task { [weak self] in
            while let self, !Task.isCancelled, let session = self.mySession {
                if let expiresAt = Self.parseISODate(session.expiresAt), Date() >= expiresAt {
                    self.stopSharing()
                    break
                }
                if let loc = self.manager.location {
                    try? await TripLocationAPI.ping(
                        sessionId: sessionId, journeyId: journeyId, coordinate: loc.coordinate,
                        accuracy: loc.horizontalAccuracy, heading: loc.course >= 0 ? loc.course : nil,
                        speed: loc.speed >= 0 ? loc.speed : nil
                    )
                }
                try? await Task.sleep(nanoseconds: 12_000_000_000)
            }
        }
    }

    /// Other members' pins — polled, not subscribed, matching this app's
    /// existing convention (MessagesViewModel has no realtime subscription
    /// either; "refresh on open + pull-to-refresh" is the established
    /// pattern here, extended to a repeating timer since a live map needs to
    /// visibly move without the user manually refreshing).
    func startPolling(journeyId: String) {
        self.journeyId = journeyId
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while let self, !Task.isCancelled {
                if let locations = try? await TripLocationAPI.activeLocations(journeyId: journeyId) {
                    self.others = locations
                }
                try? await Task.sleep(nanoseconds: 10_000_000_000)
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            switch manager.authorizationStatus {
            case .denied, .restricted: self.permissionDenied = true
            default: self.permissionDenied = false
            }
        }
    }
}
