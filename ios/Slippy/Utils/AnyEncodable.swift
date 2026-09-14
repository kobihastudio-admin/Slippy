import Foundation

/// Type-erased `Encodable`, so a `[String: AnyEncodable]` can carry a mixed
/// column patch straight to PostgREST without a bespoke struct per update.
///
/// Lived inside CameraPickerView until that screen was trimmed down; it is used
/// by DocumentDetailView and the upload path alike, so it belongs here.
struct AnyEncodable: Encodable {
    private let _encode: (Encoder) throws -> Void
    init<T: Encodable>(_ value: T) { _encode = value.encode }
    func encode(to encoder: Encoder) throws { try _encode(encoder) }
}
