import Foundation

enum TripMapProvider: String, CaseIterable, Identifiable {
    case apple
    case google

    var id: String { rawValue }
    var title: String { self == .apple ? "Apple Maps" : "Google Maps" }

    static func initial(googleConfigured: Bool) -> Self {
        googleConfigured ? .google : .apple
    }

    static func nativeKey(_ value: String?) -> String? {
        guard let key = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !key.isEmpty, !key.contains("$("), key != "YOUR_API_KEY" else { return nil }
        return key
    }

    func available(nativeKey: String?) -> Bool {
        self == .apple || Self.nativeKey(nativeKey) != nil
    }
}
