import Foundation

@main
struct VerifyTripMapProvider {
    static func main() {
        precondition(TripMapProvider.initial(googleConfigured: true) == .google)
        precondition(TripMapProvider.initial(googleConfigured: false) == .apple)
        for invalid in [nil, "", "  ", "$(GOOGLE_MAPS_IOS_API_KEY)", "YOUR_API_KEY"] as [String?] {
            precondition(TripMapProvider.nativeKey(invalid) == nil)
            precondition(TripMapProvider.google.available(nativeKey: invalid) == false)
            precondition(TripMapProvider.apple.available(nativeKey: invalid))
        }
        precondition(TripMapProvider.nativeKey("  native-test-key \n") == "native-test-key")
        precondition(TripMapProvider.google.available(nativeKey: "native-test-key"))
        print("PASS: native key configuration and Apple fallback")
    }
}
