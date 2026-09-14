import SwiftUI
import Supabase

/// Mirrors `web/src/app/(app)/billing/page.tsx` — reads the same
/// `organizations` columns (plan/usage/subscription) and `billing_invoices`
/// rows directly from Supabase, so plan/usage figures always match the web.
///
/// Note: actual Stripe Checkout/Customer-Portal session creation
/// (`/api/stripe/create-checkout`, `/api/stripe/portal`) requires the
/// service-role key + Stripe secret key and runs server-side only — the iOS
/// app opens those flows in an in-app browser (`SFSafariViewController`)
/// pointed at the authenticated web billing page, rather than handing off to
/// external Safari. This keeps the secrets server-side while presenting the
/// experience natively in-app.
@MainActor
final class BillingViewModel: ObservableObject {
    @Published var org: BillingOrg?
    @Published var invoices: [BillingInvoice] = []
    @Published var isLoading = false
    @Published var error: String?

    private let db = SupabaseManager.shared.client

    func load(orgId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let orgTask: BillingOrg = db
                .from("organizations")
                .select("id, name, plan, doc_used, doc_quota, stripe_customer_id, subscription_status, subscription_ends_at")
                .eq("id", value: orgId)
                .single()
                .execute().value

            async let invoiceTask: [BillingInvoice] = db
                .from("billing_invoices")
                .select()
                .eq("organization_id", value: orgId)
                .order("created_at", ascending: false)
                .limit(10)
                .execute().value

            org = try await orgTask
            invoices = (try? await invoiceTask) ?? []
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct BillingOrg: Codable {
    let id: String
    let name: String
    let plan: String
    let docUsed: Int
    let docQuota: Int
    let stripeCustomerId: String?
    let subscriptionStatus: String?
    let subscriptionEndsAt: String?

    enum CodingKeys: String, CodingKey {
        case id, name, plan
        case docUsed  = "doc_used"
        case docQuota = "doc_quota"
        case stripeCustomerId   = "stripe_customer_id"
        case subscriptionStatus = "subscription_status"
        case subscriptionEndsAt = "subscription_ends_at"
    }

    var quotaPercent: Double {
        guard docQuota > 0 else { return 0 }
        return min(1, Double(docUsed) / Double(docQuota))
    }

    var planLabel: String {
        switch plan {
        case "free":       return "ฟรี"
        case "pro":        return "Pro"
        case "premium":    return "Premium"
        case "team":       return "Team"
        case "business":   return "Business"
        case "enterprise": return "Enterprise"
        default:           return plan.capitalized
        }
    }

    var statusLabel: String {
        // The free plan has no Stripe subscription, so `subscription_status` sits
        // at "inactive" and used to fall through to `.capitalized` — printing the
        // raw English "Inactive" next to a plan the customer is actively using.
        // Reading "ฟรี — Inactive" is alarming and wrong: nothing is inactive,
        // there is simply no subscription to have a status.
        if plan == "free" { return "ใช้งานอยู่" }

        switch subscriptionStatus {
        case "active":    return "ใช้งานอยู่"
        case "trialing":  return "ทดลองใช้"
        case "past_due":  return "ค้างชำระ"
        case "canceled":  return "ยกเลิกแล้ว"
        case "inactive":  return "ยังไม่ได้สมัคร"
        case nil:         return "—"
        // Anything new from Stripe still surfaces rather than being hidden, but
        // it is a status we have not translated — say so instead of pretending.
        default:          return subscriptionStatus?.capitalized ?? "—"
        }
    }
}

struct BillingInvoice: Codable, Identifiable {
    let id: String
    let amount: Double?
    let status: String?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, amount, status
        case createdAt = "created_at"
    }
}
