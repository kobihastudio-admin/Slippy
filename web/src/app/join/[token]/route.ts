import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

type JoinActivityResult = { activity_id: string; joined: boolean }

export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { token } = await params
  const { data, error } = await supabase.rpc("join_activity_registration", { p_raw_token: token }).maybeSingle()
  const result = data as JoinActivityResult | null
  if (error || !result) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ activityId: result.activity_id, joined: result.joined })
}
