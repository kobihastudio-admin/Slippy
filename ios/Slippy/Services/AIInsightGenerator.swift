import Foundation

/// On-device port of `api/src/routes/sport-play.ts`'s `/ai-insight` formulas.
///
/// The Fastify endpoint exists but sits behind the API's internal-key auth
/// (meant for server-to-server calls between the web app and the API), and
/// its handler reads `req.userId` from a property that's never actually set
/// by that auth hook — so it isn't safely or correctly callable from a
/// mobile client as-is. The iOS app already writes session/shot data
/// straight to Supabase under RLS (`SportPlaySync`), so insight generation
/// is computed here instead and upserted to `sport_play_ai_insights` the
/// same way — same formulas, same shape, just running on-device.
struct AIInsight {
    let text: String
    let skillScore: Int
    let powerScore: Int
    let staminaScore: Int
    let consistencyScore: Int
}

enum AIInsightGenerator {
    static func generate(for session: SportSession) -> AIInsight {
        let total = session.totalShots
        let smash = session.smashCount
        let hr    = session.avgHeartRate ?? 0
        let ratio = total > 0 ? Int((Double(smash) / Double(total) * 100).rounded()) : 0

        var text = "วันนี้คุณตีลูกทั้งหมด \(total) ครั้ง"
        if smash > 0 { text += " เป็น Smash \(smash) ครั้ง (\(ratio)%)" }
        if hr > 150 { text += " Heart Rate สูงมาก แนะนำพักและดื่มน้ำให้เพียงพอ" }
        else if hr > 0 { text += " ความเข้มข้นการเล่นอยู่ในระดับดี" }
        if ratio > 20 { text += " สัดส่วน Smash ดีมาก ควรฝึก Footwork เพิ่มเติม" }
        else { text += " ลองเพิ่มจำนวน Smash เพื่อกดดันคู่แข่ง" }

        let skillScore       = min(100, 40 + ratio + (hr > 0 ? 10 : 0))
        let powerScore       = min(100, smash > 50 ? 80 : 40 + smash)
        let staminaScore     = hr > 0 ? max(0, 100 - (hr - 120) / 2) : 60
        let consistencyScore = total > 300 ? 80 : total / 4

        return AIInsight(
            text: text,
            skillScore: skillScore,
            powerScore: powerScore,
            staminaScore: staminaScore,
            consistencyScore: consistencyScore
        )
    }
}
