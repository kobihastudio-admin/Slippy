import SwiftUI

/// One reminder schedule for a medication — matches web's `medication_schedules`
/// row shape exactly (web/src/app/api/medications/route.ts), so a schedule
/// created from either surface reads correctly on the other.
struct MedicationSchedule: Codable {
    let id: String
    let times: [String]           // "08:00", "14:00", ...
    let doseQty: Double
    let mealRelation: String      // before | after | with | any
    let mealNote: String?
    let reminderEnabled: Bool
    /// Display-only — a real HH:mm is still stored in `times` and still
    /// drives the actual reminder. This just means "show 'ก่อนนอน' instead
    /// of the literal time" wherever a schedule's time is displayed.
    let isBedtime: Bool

    enum CodingKeys: String, CodingKey {
        case id, times
        case doseQty = "dose_qty"
        case mealRelation = "meal_relation"
        case mealNote = "meal_note"
        case reminderEnabled = "reminder_enabled"
        case isBedtime = "is_bedtime"
    }
}

/// Stock on hand for a medication — matches `medication_inventory`.
struct MedicationInventory: Codable {
    let id: String
    let qtyRemaining: Double
    let qtyUnit: String
    let qtyPerPack: Double?
    let lowStockAlert: Double
    let expiryDate: String?
    let locCode: String?
    let lotNo: String?

    enum CodingKeys: String, CodingKey {
        case id
        case qtyRemaining = "qty_remaining"
        case qtyUnit = "qty_unit"
        case qtyPerPack = "qty_per_pack"
        case lowStockAlert = "low_stock_alert"
        case expiryDate = "expiry_date"
        case locCode = "loc_code"
        case lotNo = "lot_no"
    }

    /// Days of stock left, at the actual consumption rate — not the fixed
    /// low_stock_alert threshold. Nil when there is no schedule to compute a
    /// daily rate from (an as-needed medication has nothing to divide by).
    func daysRemaining(schedule: MedicationSchedule?) -> Int? {
        guard let schedule, !schedule.times.isEmpty else { return nil }
        let perDay = schedule.doseQty * Double(schedule.times.count)
        guard perDay > 0 else { return nil }
        return Int(qtyRemaining / perDay)
    }
}

/// A hospital, clinic, or pharmacy the user has medications from — a
/// personal, reusable list so "which hospital was this from" is a pick,
/// not retyped free text, and medication history can be filtered by source.
struct MedicalProvider: Codable, Identifiable, Hashable {
    let id: String
    let userId: String
    let name: String
    let type: String          // hospital | clinic | pharmacy
    /// Patient number AT THIS hospital — meaningless (and typically nil) for
    /// a clinic or pharmacy, since HN is tied to the specific hospital, not
    /// the person globally.
    let hn: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, name, type, hn
        case userId = "user_id"
        case createdAt = "created_at"
    }

    var typeLabel: String {
        switch type {
        case "hospital": return "🏥 โรงพยาบาล"
        case "clinic":   return "🩺 คลินิก"
        case "pharmacy": return "💊 ร้านยา"
        default:         return type
        }
    }
}

enum MedicationCourseStatus: String, Codable {
    case active, paused, stopped, completed
}

struct MedicationDoseSlot: Codable, Identifiable {
    let id: String
    let timeValue: String?
    let periodLabel: String
    let doseQty: Double
    let mealRelation: String
    let mealNote: String?
    let sortOrder: Int
    let reminderEnabled: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case timeValue = "time_value"
        case periodLabel = "period_label"
        case doseQty = "dose_qty"
        case mealRelation = "meal_relation"
        case mealNote = "meal_note"
        case sortOrder = "sort_order"
        case reminderEnabled = "reminder_enabled"
    }
}

struct MedicationCourse: Codable, Identifiable {
    let id: String
    let status: MedicationCourseStatus
    let startDate: String
    let plannedEndDate: String?
    let actualEndAt: String?
    let prescribedBy: String?
    let doctorInstructions: String?
    let instructionSource: String
    let doseSlots: [MedicationDoseSlot]

    enum CodingKeys: String, CodingKey {
        case id, status
        case startDate = "start_date"
        case plannedEndDate = "planned_end_date"
        case actualEndAt = "actual_end_at"
        case prescribedBy = "prescribed_by"
        case doctorInstructions = "doctor_instructions"
        case instructionSource = "instruction_source"
        case doseSlots = "medication_dose_slots"
    }
}

struct Medication: Codable, Identifiable {
    let id: String
    let userId: String
    let name: String
    let brandName: String?
    let genericName: String?
    let dosageForm: String
    let strength: String?
    /// What the drug is for — surfaced in the reminder notification body so
    /// it answers "what/why", not just "time to take something named X".
    let purpose: String?
    let color: String?
    let notes: String?
    /// Soft-delete flag — mirrors web's `is_active` (medications-client.tsx,
    /// api/liff/medications/[id]'s DELETE). `loadMedications` already filters
    /// this server-side, so a decoded row is always true in practice; kept so
    /// the model can round-trip the column without a decode failure if that
    /// ever changes.
    let isActive: Bool
    let createdAt: String
    let schedules: [MedicationSchedule]
    // PostgREST always returns a to-many embed as an ARRAY — there is no
    // UNIQUE constraint on medication_inventory.medication_id for it to infer
    // a to-one relation from, same reason medication_schedules is an array.
    // A singular `MedicationInventory?` here throws a DecodingError the
    // moment any medication actually has an inventory row (a JSON array
    // token where Codable expects an object-or-null), which silently broke
    // the whole medications list on the phone. See the identical fix on web
    // (medications-client.tsx's own comment on this).
    let inventoryRows: [MedicationInventory]
    /// The hospital/clinic/pharmacy this came from, embedded via
    /// `provider_id`'s FK — PostgREST returns a to-one embed as an object,
    /// not an array, because there IS a real to-one relationship here
    /// (medications.provider_id -> medical_providers.id), unlike the
    /// schedules/inventory to-many embeds above.
    let provider: MedicalProvider?
    /// Reuses the existing (previously unused) `prescribed_by` column.
    let doctorName: String?
    let doctorInstructions: String?
    let courses: [MedicationCourse]

    enum CodingKeys: String, CodingKey {
        case id, name, notes, purpose, color, strength, provider
        case userId = "user_id"
        case brandName = "brand_name"
        case genericName = "generic_name"
        case dosageForm = "dosage_form"
        case isActive = "is_active"
        case createdAt = "created_at"
        case schedules = "medication_schedules"
        case inventoryRows = "medication_inventory"
        case doctorName = "prescribed_by"
        case doctorInstructions = "doctor_instructions"
        case courses = "medication_courses"
    }

    var inventory: MedicationInventory? { inventoryRows.first }

    var dosageFormLabel: String {
        switch dosageForm {
        case "tablet":    return "💊 เม็ด"
        case "capsule":   return "💊 แคปซูล"
        case "liquid":    return "🧴 น้ำ"
        case "inhaler":   return "💨 พ่น"
        case "injection": return "💉 ฉีด"
        case "patch":     return "🩹 แผ่นแปะ"
        case "cream":     return "🧴 ครีม"
        default:          return "💊 อื่นๆ"
        }
    }

    /// The active schedule this card reminds/estimates from — a medication
    /// can only usefully show one at a time, same simplification the web
    /// card already makes (`med.medication_schedules[0]`).
    var primarySchedule: MedicationSchedule? { schedules.first }
    var currentCourse: MedicationCourse? {
        courses.first { $0.status == .active || $0.status == .paused } ?? courses.first
    }
}

struct MedicationLog: Codable, Identifiable {
    let id: String
    let medicationId: String
    let userId: String
    let status: String
    let createdAt: String
    let scheduledAt: String
    let takenAt: String?
    let doseTaken: Double?
    let courseId: String?
    let slotId: String?

    enum CodingKeys: String, CodingKey {
        case id, status
        case medicationId = "medication_id"
        case userId = "user_id"
        case createdAt = "created_at"
        case scheduledAt = "scheduled_at"
        case takenAt = "taken_at"
        case doseTaken = "dose_taken"
        case courseId = "course_id"
        case slotId = "slot_id"
    }

    var statusLabel: String {
        switch status {
        case "taken":   return "ทานแล้ว ✅"
        case "missed":  return "ลืมทาน ❌"
        case "skipped": return "ข้าม ⏭️"
        case "cancelled": return "ยกเลิกตามคอร์ส"
        default:        return "รอทาน ⏳"
        }
    }

    var statusColor: Color {
        switch status {
        case "taken":   return .green
        case "missed":  return .red
        case "skipped": return .orange
        default:        return .gray
        }
    }
}

/// What POST /api/medications/scan proposes, read from a photo of a label —
/// mirrors web's ScannedMedication (medications-client.tsx) and the pipeline's
/// own ProposedMedication (api/src/pipeline/medication-label.ts) field for
/// field. Read-only: nothing here is written until AddMedicationView's
/// existing review form is saved, same discipline as every other scan flow
/// in this app (TripDocumentAPI.Proposed, ScannedReceipt).
struct ScannedMedication: Codable {
    let name: String
    let brandName: String?
    let genericName: String?
    let dosageForm: String
    let strength: String?
    let purpose: String?
    let instructionsVerbatim: String?
    let times: [String]
    let doseQty: Double
    let mealRelation: String
    let mealNote: String?
    let qtyTotal: Double?
    let qtyUnit: String
    let expiryDate: String?
    let prescribingDoctor: String?
    let hospitalName: String?
    let lotNo: String?
    let confidence: Double

    enum CodingKeys: String, CodingKey {
        case name, times, strength, purpose, confidence
        case brandName = "brand_name"
        case genericName = "generic_name"
        case dosageForm = "dosage_form"
        case instructionsVerbatim = "instructions_verbatim"
        case doseQty = "dose_qty"
        case mealRelation = "meal_relation"
        case mealNote = "meal_note"
        case qtyTotal = "qty_total"
        case qtyUnit = "qty_unit"
        case expiryDate = "expiry_date"
        case prescribingDoctor = "prescribing_doctor"
        case hospitalName = "hospital_name"
        case lotNo = "lot_no"
    }
}
