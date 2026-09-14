/**
 * sport-play.ts — Slippy Play: Badminton AI Tracker API
 * Handles sport sessions, shot events, and AI insights from Apple Watch
 */
import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase"

export default async function sportPlayRoutes(app: FastifyInstance) {

  // ── Create / start session ───────────────────────────────────────────────
  app.post("/v1/sport-play/sessions", async (req, reply) => {
    const userId = (req as any).userId as string
    const body   = req.body as any

    const { data, error } = await supabase
      .from("sport_play_sessions")
      .insert({
        user_id:    userId,
        sport:      body.sport      ?? "badminton",
        source:     body.source     ?? "apple_watch",
        started_at: body.startedAt  ?? new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return reply.status(500).send({ error: error.message })
    return reply.status(201).send(data)
  })

  // ── Upload shot events (batch) ────────────────────────────────────────────
  app.post("/v1/sport-play/sessions/:id/shots/batch", async (req, reply) => {
    const userId    = (req as any).userId as string
    const sessionId = (req.params as any).id as string
    const body      = req.body as any

    // Verify ownership
    const { data: session } = await supabase
      .from("sport_play_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .single()

    if (!session) return reply.status(404).send({ error: "session not found" })

    const rows = (body.shots as any[]).map((s: any) => ({
      session_id:        sessionId,
      shot_at:           s.timestamp,
      shot_type:         s.shotType         ?? "unknown",
      confidence:        s.confidence       ?? 0,
      peak_acceleration: s.peakAcceleration ?? null,
      peak_gyro:         s.peakGyro         ?? null,
      energy:            s.energy           ?? null,
    }))

    const { error } = await supabase.from("sport_play_shots").insert(rows)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.send({ inserted: rows.length })
  })

  // ── Complete session ─────────────────────────────────────────────────────
  app.patch("/v1/sport-play/sessions/:id/complete", async (req, reply) => {
    const userId    = (req as any).userId as string
    const sessionId = (req.params as any).id as string
    const body      = req.body as any

    const { data, error } = await supabase
      .from("sport_play_sessions")
      .update({
        status:           "completed",
        sync_status:      "synced",
        ended_at:         body.endedAt,
        duration_seconds: body.durationSeconds,
        total_shots:      body.totalShots   ?? 0,
        smash_count:      body.smashCount   ?? 0,
        avg_heart_rate:   body.avgHeartRate ?? null,
        max_heart_rate:   body.maxHeartRate ?? null,
        active_calories:  body.activeCalories ?? null,
      })
      .eq("id", sessionId)
      .eq("user_id", userId)
      .select()
      .single()

    if (error) return reply.status(500).send({ error: error.message })
    return reply.send(data)
  })

  // ── Get session summary ──────────────────────────────────────────────────
  app.get("/v1/sport-play/sessions/:id/summary", async (req, reply) => {
    const userId    = (req as any).userId as string
    const sessionId = (req.params as any).id as string

    const { data: session, error } = await supabase
      .from("sport_play_sessions")
      .select("*, sport_play_shots(*), sport_play_ai_insights(*)")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .single()

    if (error || !session) return reply.status(404).send({ error: "not found" })
    return reply.send(session)
  })

  // ── Get dashboard / history ──────────────────────────────────────────────
  app.get("/v1/sport-play/dashboard", async (req, reply) => {
    const userId = (req as any).userId as string
    const range  = ((req.query as any).range as string) ?? "30d"
    const days   = parseInt(range) || 30
    const since  = new Date(Date.now() - days * 86400 * 1000).toISOString()

    const { data, error } = await supabase
      .from("sport_play_sessions")
      .select("id, started_at, ended_at, duration_seconds, total_shots, smash_count, avg_heart_rate, active_calories, status")
      .eq("user_id", userId)
      .eq("status", "completed")
      .gte("started_at", since)
      .order("started_at", { ascending: false })

    if (error) return reply.status(500).send({ error: error.message })

    const sessions     = data ?? []
    const totalShots   = sessions.reduce((s, r) => s + (r.total_shots ?? 0), 0)
    const totalSmash   = sessions.reduce((s, r) => s + (r.smash_count ?? 0), 0)
    const totalMinutes = sessions.reduce((s, r) => s + Math.floor((r.duration_seconds ?? 0) / 60), 0)

    return reply.send({
      sessions,
      stats: {
        totalSessions:  sessions.length,
        totalShots,
        totalSmash,
        totalMinutes,
        smashRatio: totalShots > 0 ? Math.round((totalSmash / totalShots) * 100) : 0,
      }
    })
  })

  // ── Generate AI insight (rule-based MVP) ─────────────────────────────────
  app.post("/v1/sport-play/sessions/:id/ai-insight", async (req, reply) => {
    const userId    = (req as any).userId as string
    const sessionId = (req.params as any).id as string

    const { data: session } = await supabase
      .from("sport_play_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .single()

    if (!session) return reply.status(404).send({ error: "not found" })

    const total  = session.total_shots   ?? 0
    const smash  = session.smash_count   ?? 0
    const hr     = session.avg_heart_rate ?? 0
    const ratio  = total > 0 ? Math.round((smash / total) * 100) : 0

    let text = `วันนี้คุณตีลูกทั้งหมด ${total} ครั้ง`
    if (smash > 0) text += ` เป็น Smash ${smash} ครั้ง (${ratio}%)`
    if (hr > 150)  text += ` Heart Rate สูงมาก แนะนำพักและดื่มน้ำให้เพียงพอ`
    else if (hr)   text += ` ความเข้มข้นการเล่นอยู่ในระดับดี`
    if (ratio > 20) text += ` สัดส่วน Smash ดีมาก ควรฝึก Footwork เพิ่มเติม`
    else            text += ` ลองเพิ่มจำนวน Smash เพื่อกดดันคู่แข่ง`

    const skillScore       = Math.min(100, 40 + ratio + (hr > 0 ? 10 : 0))
    const powerScore       = Math.min(100, smash > 50 ? 80 : 40 + smash)
    const staminaScore     = hr > 0 ? Math.max(0, 100 - Math.floor((hr - 120) / 2)) : 60
    const consistencyScore = total > 300 ? 80 : Math.floor(total / 4)

    const { data: insight, error } = await supabase
      .from("sport_play_ai_insights")
      .upsert({
        session_id:        sessionId,
        insight_text:      text,
        skill_score:       skillScore,
        power_score:       powerScore,
        stamina_score:     staminaScore,
        consistency_score: consistencyScore,
      }, { onConflict: "session_id" })
      .select()
      .single()

    if (error) return reply.status(500).send({ error: error.message })
    return reply.send(insight)
  })
}
