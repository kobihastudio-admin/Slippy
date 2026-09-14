import SwiftUI
import CoreImage.CIFilterBuiltins
import Supabase

/// Drives `TwoFactorSettingsView` (enroll/unenroll TOTP) and the login-time
/// MFA challenge step in `LoginView` — wraps Supabase Auth's MFA API
/// (`db.auth.mfa.*`), which mirrors the web app's implementation in
/// `web/src/app/(app)/privacy/page.tsx`'s `MfaCard` exactly.
@MainActor
final class MfaViewModel: ObservableObject {
    @Published var verifiedFactor: Factor?
    @Published var isLoading = true
    @Published var isBusy = false
    @Published var error: String?

    // Enrollment in progress
    @Published var enrollFactorId: String?
    @Published var qrImage: UIImage?
    @Published var secret: String?

    private let db = SupabaseManager.shared.client

    func loadFactors() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let factors = try await db.auth.mfa.listFactors()
            verifiedFactor = factors.totp.first
        } catch {
            self.error = error.localizedDescription
        }
    }

    func startEnroll() async {
        isBusy = true
        defer { isBusy = false }
        do {
            let response = try await db.auth.mfa.enroll(params: .totp(issuer: "Slippy", friendlyName: "Slippy"))
            enrollFactorId = response.id
            secret = response.totp?.secret
            if let uri = response.totp?.uri {
                qrImage = Self.generateQRCode(from: uri)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Cleans up the unverified factor created by startEnroll() if the user
    /// backs out without confirming — otherwise it lingers forever.
    func cancelEnroll() async {
        if let factorId = enrollFactorId {
            _ = try? await db.auth.mfa.unenroll(params: MFAUnenrollParams(factorId: factorId))
        }
        enrollFactorId = nil; qrImage = nil; secret = nil
    }

    func confirmEnroll(code: String) async -> Bool {
        guard let factorId = enrollFactorId else { return false }
        isBusy = true
        defer { isBusy = false }
        do {
            try await db.auth.mfa.challengeAndVerify(params: MFAChallengeAndVerifyParams(factorId: factorId, code: code))
            enrollFactorId = nil; qrImage = nil; secret = nil
            await loadFactors()
            return true
        } catch {
            self.error = "รหัสไม่ถูกต้อง กรุณาลองใหม่"
            return false
        }
    }

    func disable() async {
        guard let factor = verifiedFactor else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            try await db.auth.mfa.unenroll(params: MFAUnenrollParams(factorId: factor.id))
            await loadFactors()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Renders a QR code locally from the TOTP URI instead of dealing with
    /// Supabase's returned `qrCode` field, which is raw SVG markup (not a
    /// data URI/UIImage) — CoreImage's built-in generator is simpler and
    /// has no extra dependency.
    private static func generateQRCode(from string: String) -> UIImage? {
        let context = CIContext()
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        guard let outputImage = filter.outputImage else { return nil }
        let scaled = outputImage.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
