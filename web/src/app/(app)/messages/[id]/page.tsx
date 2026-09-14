import { createClient } from "@/lib/supabase/server"
import { redirect }     from "next/navigation"
import ChatRoom         from "./ChatRoom"

export default async function ConvPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb     = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect("/login")
  return <ChatRoom convId={id} currentUserId={user.id} />
}
