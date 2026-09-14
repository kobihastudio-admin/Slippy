import SwiftUI
import Supabase
import AuthenticationServices
import LineSDK

typealias AuthSession = Supabase.Session

@MainActor
final class AuthViewModel: ObservableObject {
    @Published var session: AuthSession?
    @Published var profile: UserProfile?
    @Published var membership: OrganizationMember?
    /// All organizations the user belongs to — mirrors the list `getMembership()`
    /// chooses from on web (`organization_members` rows for this user).
    @Published var memberships: [OrganizationMember] = []
    @Published var isLoading = true
    @Published var error: String?

    /// Client-side cooldown after repeated failed sign-ins — defense-in-depth
    /// UX layer on top of Supabase Auth's own platform-level rate limiting
    /// (which is what actually stops a scripted attacker hitting the API
    /// directly; this just slows down a human retrying in the app and gives
    /// clear feedback instead of silently hammering signIn()).
    @Published var loginLockedUntil: Date?
    private var consecutiveFailures = 0
    private static let lockoutThresholds: [(failures: Int, seconds: TimeInterval)] = [
        (3, 15), (5, 60), (8, 300),
    ]

    /// Set right after a successful email/password sign-in if the account
    /// has a verified TOTP factor — `isSignedIn` stays false while this is
    /// set, so RootView shows the MFA challenge screen instead of the main
    /// app until `completeMfaChallenge()` is called. Mirrors the web app's
    /// /api/auth/login `mfaRequired` flow.
    @Published var pendingMfaFactorId: String?

    /// Active-org selection persisted locally — the mobile equivalent of the
    /// web's `active-org` httpOnly cookie (each platform/client keeps its own).
    private static let activeOrgKey = "slippy.activeOrgId"

    private let db = SupabaseManager.shared.client

    init() {
        Task { await listenForAuthChanges() }
    }

    // MARK: – Auth State Listener
    private func listenForAuthChanges() async {
        for await state in db.auth.authStateChanges {
            switch state.event {
            // `.tokenRefreshed` MUST be here.
            //
            // A Supabase access token lives about an hour, so on almost every
            // launch the stored session is already expired. `initialSession`
            // then arrives carrying that expired session, the guard below
            // correctly refuses it, and the login screen appears — while the
            // SDK, in the background, quietly refreshes the token using a
            // refresh token that was valid all along and emits
            // `.tokenRefreshed`. That event used to land in `default:`, which
            // only cleared the spinner and never restored the session. The
            // user was signed in the whole time and was asked to log in again
            // anyway, roughly every time they opened the app after an hour.
            //
            // `.userUpdated` and `.mfaChallengeVerified` carry a session too,
            // and dropping those silently signs the user out mid-flow.
            case .initialSession, .signedIn, .tokenRefreshed, .userUpdated, .mfaChallengeVerified:
                // emitLocalSessionAsInitialSession=true can emit expired sessions.
                // Ignore an expired one here rather than showing stale data —
                // the refresh above is what brings the real session back.
                let validSession = state.session.flatMap { $0.isExpired ? nil : $0 }

                // Never downgrade a live session to nil on an expired emission:
                // the events can interleave, and one stale `initialSession`
                // arriving after a successful refresh would log the user out.
                if validSession != nil || self.session == nil {
                    self.session = validSession
                }
                self.isLoading = false
                if validSession != nil, self.profile == nil {
                    Task { await loadUserData() }
                }
            case .signedOut, .userDeleted:
                self.session    = nil
                self.profile    = nil
                self.membership = nil
                self.isLoading  = false
            case .passwordRecovery:
                self.isLoading = false
            }
        }
    }

    private func loadUserData() async {
        async let profileTask    = fetchProfile()
        async let membershipTask = fetchMembership()
        _ = await (profileTask, membershipTask)
    }

    // MARK: – Sign In / Out
    func signIn(email: String, password: String) async {
        error = nil

        if let lockedUntil = loginLockedUntil, lockedUntil > Date() {
            let remaining = Int(lockedUntil.timeIntervalSinceNow.rounded(.up))
            error = "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารออีก \(remaining) วินาที"
            return
        }

        do {
            try await db.auth.signIn(email: email.trimmingCharacters(in: .whitespaces),
                                     password: password)
            consecutiveFailures = 0
            loginLockedUntil = nil
            await checkMfaChallengeNeeded()
        } catch {
            self.error = error.localizedDescription
            consecutiveFailures += 1
            if let tier = Self.lockoutThresholds.last(where: { consecutiveFailures >= $0.failures }) {
                loginLockedUntil = Date().addingTimeInterval(tier.seconds)
            }
        }
    }

    func signOut() async {
        do {
            try await db.auth.signOut()
            pendingMfaFactorId = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Password alone only proves aal1. If the account has a verified TOTP
    /// factor, the session's nextLevel comes back "aal2" — set
    /// pendingMfaFactorId so RootView shows the challenge screen instead of
    /// the main app until completeMfaChallenge() succeeds.
    private func checkMfaChallengeNeeded() async {
        guard let aal = try? await db.auth.mfa.getAuthenticatorAssuranceLevel() else { return }
        guard aal.nextLevel == "aal2", aal.currentLevel != aal.nextLevel else { return }
        let factors = try? await db.auth.mfa.listFactors()
        pendingMfaFactorId = factors?.totp.first?.id
    }

    /// Called by the MFA challenge screen after a successful TOTP verify.
    func completeMfaChallenge(code: String) async -> Bool {
        guard let factorId = pendingMfaFactorId else { return false }
        do {
            try await db.auth.mfa.challengeAndVerify(params: MFAChallengeAndVerifyParams(factorId: factorId, code: code))
            pendingMfaFactorId = nil
            return true
        } catch {
            self.error = "รหัสไม่ถูกต้อง กรุณาลองใหม่"
            return false
        }
    }

    // MARK: – OAuth (Google / Facebook / LINE)
    /// Opens an ASWebAuthenticationSession for the given provider.
    func signInWithOAuth(provider: Provider) async {
        error = nil
        do {
            // 1. Build the provider OAuth URL
            let redirectURL = URL(string: "slippy://auth/callback")!
            let oauthURL = try db.auth.getOAuthSignInURL(
                provider: provider,
                scopes: nil,
                redirectTo: redirectURL,
                queryParams: []
            )

            // 2. Open browser session and wait for redirect
            let callbackURL: URL = try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.main.async {
                    let session = ASWebAuthenticationSession(
                        url: oauthURL,
                        callbackURLScheme: "slippy"
                    ) { url, sessionError in
                        if let url {
                            continuation.resume(returning: url)
                        } else {
                            continuation.resume(throwing: sessionError ?? URLError(.cancelled))
                        }
                    }
                    session.prefersEphemeralWebBrowserSession = false
                    session.presentationContextProvider = PresentationContextProvider.shared
                    session.start()
                    // Retain session so it isn't deallocated
                    PresentationContextProvider.shared.retain(session)
                }
            }

            // 3. Exchange callback URL for a session
            try await db.auth.session(from: callbackURL)
        } catch {
            // Error code 1 = user cancelled the browser session — silently ignore
            let nsErr = error as NSError
            if nsErr.domain == "com.apple.AuthenticationServices.WebAuthenticationSession" && nsErr.code == 1 {
                return
            }
            self.error = "เข้าสู่ระบบไม่สำเร็จ: \(error.localizedDescription)"
        }
    }

    // MARK: – Sign in with LINE
    /// LINE is **not** a native Supabase OAuth provider — the web app runs a
    /// custom server-side flow (`/api/auth/line` → LINE → `/api/auth/line/callback`,
    /// see `web/src/app/api/auth/line/*`) that creates/links a Supabase user and
    /// hands back a session via a Supabase magic-link.
    ///
    /// We open that exact flow with `?platform=ios`, which tells the callback
    /// route to redirect the minted session straight to `slippy://auth/callback`
    /// (instead of the web's hash-reading page) so `ASWebAuthenticationSession`
    /// can capture it here, exactly like the Google/Facebook flow above.
    func signInWithLine() async {
        error = nil
        do {
            let startURL = Config.webAppURL
                .appendingPathComponent("api/auth/line")
                .appending(queryItems: [URLQueryItem(name: "platform", value: "ios")])

            let callbackURL: URL = try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.main.async {
                    let session = ASWebAuthenticationSession(
                        url: startURL,
                        callbackURLScheme: "slippy"
                    ) { url, sessionError in
                        if let url {
                            continuation.resume(returning: url)
                        } else {
                            continuation.resume(throwing: sessionError ?? URLError(.cancelled))
                        }
                    }
                    session.prefersEphemeralWebBrowserSession = false
                    session.presentationContextProvider = PresentationContextProvider.shared
                    session.start()
                    PresentationContextProvider.shared.retain(session)
                }
            }

            // The callback can also carry `?error=line_xxx` if the server-side
            // flow failed before a session could be minted — same reason
            // codes web's callback route produces (api/src/app/api/auth/
            // line/callback/route.ts), so the same short summary applies.
            if let comps = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
               let errCode = comps.queryItems?.first(where: { $0.name == "error" })?.value {
                self.error = Self.lineErrorMessage(forCode: errCode)
                return
            }

            try await db.auth.session(from: callbackURL)
        } catch {
            let nsErr = error as NSError
            if nsErr.domain == "com.apple.AuthenticationServices.WebAuthenticationSession" && nsErr.code == 1 {
                return
            }
            self.error = Self.lineErrorMessage(forSystemError: error)
        }
    }

    /// Short, human summary for a reason CODE from the server-side LINE
    /// callback — never the raw code or exception text. Mirrors web's
    /// ERROR_MESSAGES map (oauth-error-banner.tsx) so the same failure
    /// reads the same way on both platforms.
    private static func lineErrorMessage(forCode code: String) -> String {
        let messages: [String: String] = [
            "line_cancelled":      "ยกเลิกการเข้าสู่ระบบด้วย LINE",
            "line_state_mismatch": "Session หมดอายุ กรุณาลองใหม่",
            "line_no_code":        "ไม่ได้รับอนุญาตจาก LINE กรุณาลองใหม่",
            "line_no_token":       "ไม่ได้รับ token จาก LINE กรุณาลองใหม่",
            "line_not_configured": "LINE Login ยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
            "line_token":          "เชื่อมต่อกับ LINE ไม่สำเร็จ กรุณาลองใหม่",
            "line_profile":        "ดึงข้อมูลโปรไฟล์ LINE ไม่สำเร็จ กรุณาลองใหม่",
            "line_create":         "สร้างบัญชีไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ",
            "line_session":        "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่",
            "line_unexpected":     "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่",
        ]
        return messages[code] ?? "เข้าสู่ระบบด้วย LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"
    }

    /// Short summary for a system/network-level failure (ASWebAuthenticationSession,
    /// URLSession) — distinguishes "no internet" (the one case worth telling
    /// the user apart from everything else) from a generic retry prompt,
    /// rather than surfacing `error.localizedDescription` verbatim.
    private static func lineErrorMessage(forSystemError error: Error) -> String {
        if let urlErr = error as? URLError,
           [.notConnectedToInternet, .networkConnectionLost, .timedOut].contains(urlErr.code) {
            return "ไม่มีการเชื่อมต่ออินเทอร์เน็ต กรุณาลองใหม่"
        }
        return "เข้าสู่ระบบด้วย LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"
    }

    // MARK: – Sign in with Apple
    func signInWithApple(credential: ASAuthorizationAppleIDCredential) async {
        error = nil
        guard
            let idTokenData = credential.identityToken,
            let idToken = String(data: idTokenData, encoding: .utf8)
        else {
            self.error = "ไม่สามารถอ่าน Apple ID Token ได้"
            return
        }
        do {
            try await db.auth.signInWithIdToken(
                credentials: .init(
                    provider: .apple,
                    idToken: idToken,
                    nonce: nil
                )
            )
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: – Native Google Sign-In
    func signInWithGoogleNative() async {
        error = nil
        do {
            // Use Supabase OAuth with prompt=select_account to bypass Google's
            // Passkey cross-device QR flow and show account/password picker instead
            let redirectURL = URL(string: "slippy://auth/callback")!
            let oauthURL = try db.auth.getOAuthSignInURL(
                provider: .google,
                scopes: "email profile",
                redirectTo: redirectURL,
                queryParams: [("prompt", "select_account")]
            )

            let callbackURL: URL = try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.main.async {
                    let session = ASWebAuthenticationSession(
                        url: oauthURL,
                        callbackURLScheme: "slippy"
                    ) { url, sessionError in
                        if let url {
                            continuation.resume(returning: url)
                        } else {
                            continuation.resume(throwing: sessionError ?? URLError(.cancelled))
                        }
                    }
                    session.prefersEphemeralWebBrowserSession = false
                    session.presentationContextProvider = PresentationContextProvider.shared
                    session.start()
                    PresentationContextProvider.shared.retain(session)
                }
            }

            try await db.auth.session(from: callbackURL)
        } catch {
            let nsErr = error as NSError
            if nsErr.domain == "com.apple.AuthenticationServices.WebAuthenticationSession" && nsErr.code == 1 { return }
            self.error = "Google Sign-In ไม่สำเร็จ: \(error.localizedDescription)"
        }
    }

    // MARK: – Facebook via Supabase OAuth (ASWebAuthenticationSession)
    // Uses the same web-based flow as Google — no Facebook SDK native platform required.
    func signInWithFacebookNative() async {
        error = nil
        do {
            let redirectURL = URL(string: "slippy://auth/callback")!
            let oauthURL = try db.auth.getOAuthSignInURL(
                provider: .facebook,
                scopes: "email,public_profile",
                redirectTo: redirectURL
            )

            let callbackURL: URL = try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.main.async {
                    let session = ASWebAuthenticationSession(
                        url: oauthURL,
                        callbackURLScheme: "slippy"
                    ) { url, sessionError in
                        if let url {
                            continuation.resume(returning: url)
                        } else {
                            continuation.resume(throwing: sessionError ?? URLError(.cancelled))
                        }
                    }
                    session.prefersEphemeralWebBrowserSession = false
                    session.presentationContextProvider = PresentationContextProvider.shared
                    session.start()
                    PresentationContextProvider.shared.retain(session)
                }
            }

            try await db.auth.session(from: callbackURL)
        } catch {
            let nsErr = error as NSError
            if nsErr.domain == "com.apple.AuthenticationServices.WebAuthenticationSession" && nsErr.code == 1 { return }
            self.error = "Facebook Login ไม่สำเร็จ: \(error.localizedDescription)"
        }
    }

    // MARK: – Native LINE Login (server-verified session exchange)
    func signInWithLineNative() async {
        error = nil
        do {
            // Step 1: LINE SDK login — openID scope provides a JWT ID token
            let loginResult: LineSDK.LoginResult =
                try await withCheckedThrowingContinuation { cont in
                    DispatchQueue.main.async {
                        LoginManager.shared.login(
                            permissions: [.profile, .openID, .email],
                            in: nil,
                            completionHandler: { result in
                                switch result {
                                case .success(let r): cont.resume(returning: r)
                                case .failure(let e): cont.resume(throwing: e)
                                }
                            }
                        )
                    }
                }

            guard let idToken = loginResult.accessToken.IDTokenRaw else {
                self.error = "ไม่ได้รับข้อมูลยืนยันตัวตนจาก LINE กรุณาลองใหม่"; return
            }

            // Step 2: Exchange LINE ID token for Supabase session via our server
            // The server verifies the token with LINE, finds/creates the user,
            // and returns real access/refresh tokens without needing Supabase OIDC config.
            let endpoint = Config.webAppURL.appendingPathComponent("api/auth/line/native-token")
            var req = URLRequest(url: endpoint)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(["idToken": idToken])

            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                // The raw response body (a server error message, sometimes a
                // full JSON error object) goes to the console for debugging,
                // never to the user — same discipline as web's server-side
                // log() calls in the callback route.
                #if DEBUG
                print("[LINE native] token exchange failed:", String(data: data, encoding: .utf8) ?? "unknown")
                #endif
                self.error = "เชื่อมต่อกับ LINE ไม่สำเร็จ กรุณาลองใหม่"; return
            }

            // Step 3: Set the Supabase session with returned tokens
            let token = try JSONDecoder().decode(SupabaseTokenResponse.self, from: data)
            try await db.auth.setSession(
                accessToken: token.accessToken,
                refreshToken: token.refreshToken
            )
        } catch {
            let lineErr = error as? LineSDKError
            if lineErr?.errorCode == 3003 { return } // user cancelled
            self.error = Self.lineErrorMessage(forSystemError: error)
        }
    }

    // MARK: – Fetch helpers
    private func fetchProfile() async {
        guard let userId = session?.user.id.uuidString else { return }
        do {
            // Decode as an array — `profile` is a single optional, but a non-`.single()`
            // query always returns a JSON array from PostgREST. Decoding straight into
            // `UserProfile?` here would fail (array vs object) and leave profile nil forever.
            let rows: [UserProfile] = try await db
                .from("users")
                .select()
                .eq("id", value: userId)
                .limit(1)
                .execute()
                .value
            if let existing = rows.first {
                profile = existing
            } else {
                // The `handle_new_user()` DB trigger should create this row on signup,
                // but create it client-side as a fallback so editing name/avatar has
                // somewhere to write to instead of silently failing.
                await createMissingProfileRow(userId: userId)
            }
        } catch { print("[Auth] Profile error:", error) }
    }

    private func createMissingProfileRow(userId: String) async {
        struct NewProfile: Encodable { let id: String; let email: String }
        let email = session?.user.email ?? ""
        do {
            let created: UserProfile = try await db
                .from("users")
                .insert(NewProfile(id: userId, email: email))
                .select()
                .single()
                .execute()
                .value
            profile = created
        } catch {
            print("[Auth] Create profile row error:", error)
        }
    }

    private func fetchMembership() async {
        guard let userId = session?.user.id.uuidString else { return }
        do {
            let results: [OrganizationMember] = try await db
                .from("organization_members")
                .select("*, organizations(*)")
                .eq("user_id", value: userId)
                .execute()
                .value
            memberships = results

            // Honour the locally-persisted "active org" choice if it's still
            // a valid membership — same fallback logic as web's getMembership().
            let savedOrgId = UserDefaults.standard.string(forKey: Self.activeOrgKey)
            membership = (savedOrgId.flatMap { id in results.first { $0.organizations.id == id } })
                ?? results.first
        } catch { print("[Auth] Membership error:", error) }
    }

    /// Switches the active organization — mirrors `/api/org/switch`'s
    /// membership-verification, persisted locally (mobile's analogue of the
    /// web's `active-org` cookie).
    func switchOrg(to organizationId: String) {
        guard let target = memberships.first(where: { $0.organizations.id == organizationId }) else { return }
        membership = target
        UserDefaults.standard.set(organizationId, forKey: Self.activeOrgKey)
        hapticSuccess()
    }

    /// Updates the user's profile fields directly on `users` — same table the
    /// web reads/writes for account info (full_name/avatar_url).
    func updateProfile(fullName: String) async -> Bool {
        guard let userId = session?.user.id.uuidString else { return false }
        do {
            struct Patch: Encodable { let full_name: String }
            let updated: UserProfile = try await db
                .from("users")
                .update(Patch(full_name: fullName))
                .eq("id", value: userId)
                .select()
                .single()
                .execute()
                .value
            profile = updated
            hapticSuccess()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    /// Same table/pattern as updateProfile(fullName:) — see that function's
    /// comment for why this writes straight to `users`.
    func updateDateOfBirth(_ isoDate: String?) async -> Bool {
        guard let userId = session?.user.id.uuidString else { return false }
        do {
            struct Patch: Encodable { let date_of_birth: String? }
            let updated: UserProfile = try await db
                .from("users")
                .update(Patch(date_of_birth: isoDate))
                .eq("id", value: userId)
                .select()
                .single()
                .execute()
                .value
            profile = updated
            hapticSuccess()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    // MARK: – Upload avatar to Supabase Storage → update profile
    func uploadAvatar(_ imageData: Data) async -> Bool {
        guard let userId = session?.user.id.uuidString else { return false }
        do {
            let fileName = "avatars/\(userId).jpg"
            _ = try await db.storage
                .from(Config.storageBucket)
                .upload(fileName, data: imageData,
                        options: .init(contentType: "image/jpeg", upsert: true))

            let publicURL = try db.storage.from(Config.storageBucket).getPublicURL(path: fileName)
            // append cache-buster so AsyncImage reloads
            let urlStr = publicURL.absoluteString + "?t=\(Int(Date().timeIntervalSince1970))"

            struct Patch: Encodable { let avatar_url: String }
            let updated: UserProfile = try await db
                .from("users")
                .update(Patch(avatar_url: urlStr))
                .eq("id", value: userId)
                .select()
                .single()
                .execute()
                .value
            profile = updated
            hapticSuccess()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    var org: Organization? { membership?.organizations }
    var isSignedIn: Bool { session != nil && !isLoading && pendingMfaFactorId == nil }

#if DEBUG
    /// Preview-only init — skips network tasks.
    init(_preview: Bool) {
        // intentionally empty; call setPreviewData() after
    }

    func setPreviewData(profile: UserProfile, org: Organization, role: String = "owner") {
        self.isLoading = false
        self.profile = profile
        let orgMember = OrganizationMember(
            id: "preview-member",
            userId: "preview-user",
            role: role,
            joinedAt: "2026-01-01T00:00:00Z",
            organizations: org
        )
        self.membership = orgMember
        self.memberships = [orgMember]
    }
#endif
}

// MARK: – Supabase token response (for LINE custom OIDC)
private struct SupabaseTokenResponse: Decodable {
    let accessToken:  String
    let refreshToken: String
    enum CodingKeys: String, CodingKey {
        case accessToken  = "access_token"
        case refreshToken = "refresh_token"
    }
}

// MARK: – ASWebAuthenticationSession presentation context
/// Provides the window anchor for ASWebAuthenticationSession and retains active sessions.
final class PresentationContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = PresentationContextProvider()
    private var activeSession: ASWebAuthenticationSession?

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }

    func retain(_ session: ASWebAuthenticationSession) { activeSession = session }
}
