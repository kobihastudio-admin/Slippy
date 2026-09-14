import { LiffApiAuth } from "@/components/liff/liff-api-auth"

export default function LiffLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LiffApiAuth />
      {children}
    </>
  )
}
