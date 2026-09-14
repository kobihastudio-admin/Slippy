/**
 * Shows error codes returned from OAuth callbacks as a short, one-line
 * summary — never the raw `detail` (a LINE API error body, a Supabase
 * exception message, an HTTP response dump). That raw text used to render
 * verbatim in a monospace block below the summary; it's meaningful to a
 * developer reading logs, not to someone stuck on the login screen, so it's
 * logged server-side (see the callback route) and never sent to the client.
 */

const ERROR_MESSAGES: Record<string, string> = {
  line_cancelled:      "ยกเลิกการเข้าสู่ระบบด้วย LINE",
  line_state_mismatch: "Session หมดอายุ กรุณาลองใหม่",
  line_no_code:        "ไม่ได้รับอนุญาตจาก LINE กรุณาลองใหม่",
  line_no_token:       "ไม่ได้รับ token จาก LINE กรุณาลองใหม่",
  line_not_configured: "LINE Login ยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
  line_token:          "เชื่อมต่อกับ LINE ไม่สำเร็จ กรุณาลองใหม่",
  line_profile:        "ดึงข้อมูลโปรไฟล์ LINE ไม่สำเร็จ กรุณาลองใหม่",
  line_create:         "สร้างบัญชีไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ",
  line_session:        "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่",
  line_unexpected:     "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่",
  auth:                "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่",
}

const FALLBACK_MESSAGE = "เข้าสู่ระบบด้วย LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"

export async function OAuthErrorBanner({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string }>
}) {
  const { error } = await searchParams
  if (!error) return null

  const message = ERROR_MESSAGES[error] ?? FALLBACK_MESSAGE

  return (
    <div className="mb-5 p-3.5 rounded-[10px] bg-red-50 border border-red-200
      text-red-700 text-sm">
      <div className="font-semibold flex items-center gap-2">
        <span>⚠️</span> {message}
      </div>
    </div>
  )
}
