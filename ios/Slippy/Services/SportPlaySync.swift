import Foundation
import Supabase

/// Pushes a completed Apple Watch workout (`SportSession`, previously only
/// persisted to local `UserDefaults` via `PlaySessionStore`) up to the
/// `sport_play_sessions` / `sport_play_shots` tables — so shot/HR history
/// survives a reinstall and, when linked, can be analyzed alongside the
/// booked sport session's roster/payment data via `linked_split_bill_id`.
/// Also generates and upserts the AI insight (`AIInsightGenerator`) right
/// after, returning it so the caller can cache it on the in-memory session
/// for immediate display without a re-fetch.
enum SportPlaySync {

    static func sync(_ session: SportSession, orgId: String, userId: String) async -> AIInsight? {
        let db = SupabaseManager.shared.client
        let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        struct SessionInsert: Encodable {
            let id: String
            let user_id: String
            let organization_id: String
            let sport: String
            let source: String
            let status: String
            let sync_status: String
            let started_at: String
            let ended_at: String?
            let duration_seconds: Int?
            let total_shots: Int
            let smash_count: Int
            let avg_heart_rate: Int?
            let max_heart_rate: Int?
            let active_calories: Double?
            let linked_split_bill_id: String?
        }

        let insert = SessionInsert(
            id: session.id.uuidString, user_id: userId, organization_id: orgId,
            sport: session.sport, source: "apple_watch",
            status: session.status.rawValue, sync_status: "synced",
            started_at: iso.string(from: session.startedAt),
            ended_at: session.endedAt.map { iso.string(from: $0) },
            duration_seconds: session.durationSeconds,
            total_shots: session.totalShots, smash_count: session.smashCount,
            avg_heart_rate: session.avgHeartRate, max_heart_rate: session.maxHeartRate,
            active_calories: session.activeCalories,
            linked_split_bill_id: session.linkedSplitBillId
        )

        do {
            try await db.from("sport_play_sessions").upsert(insert).execute()

            if !session.shots.isEmpty {
                struct ShotInsert: Encodable {
                    let session_id: String
                    let shot_at: String
                    let shot_type: String
                    let confidence: Double
                    let peak_acceleration: Double
                    let peak_gyro: Double
                    let energy: Double
                }
                let shotRecords = session.shots.map { shot in
                    ShotInsert(
                        session_id: session.id.uuidString,
                        shot_at: iso.string(from: shot.timestamp),
                        shot_type: shot.shotType.rawValue,
                        confidence: shot.confidence,
                        peak_acceleration: shot.peakAcceleration,
                        peak_gyro: shot.peakGyro,
                        energy: shot.energy
                    )
                }
                try await db.from("sport_play_shots").insert(shotRecords).execute()
            }
        } catch {
            print("[SportPlaySync] sync failed:", error)
            return nil
        }

        let insight = AIInsightGenerator.generate(for: session)
        struct InsightUpsert: Encodable {
            let session_id: String
            let insight_text: String
            let skill_score: Int
            let power_score: Int
            let stamina_score: Int
            let consistency_score: Int
        }
        do {
            try await db.from("sport_play_ai_insights").upsert(
                InsightUpsert(
                    session_id: session.id.uuidString,
                    insight_text: insight.text,
                    skill_score: insight.skillScore,
                    power_score: insight.powerScore,
                    stamina_score: insight.staminaScore,
                    consistency_score: insight.consistencyScore
                ),
                onConflict: "session_id"
            ).execute()
        } catch {
            print("[SportPlaySync] insight upsert failed:", error)
        }

        return insight
    }
}
