/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import type { Metadata }       from "next"
import { Inter, Noto_Sans_Thai } from "next/font/google"
import { getLocale, getMessages } from "next-intl/server"
import { NextIntlClientProvider } from "next-intl"
import { ThemeProvider }         from "@/components/layout/theme-provider"
import { Toaster }               from "sonner"
import { CookieBanner, CookieManageButton } from "@/components/ui/cookie-banner"
import { AppLoadingProvider } from "@/lib/loading"
import { SlippyLoader }       from "@/components/ui/slippy-loader"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

const notoSansThai = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-noto",
  display: "swap",
})

export const metadata: Metadata = {
  title:       { default: "Slippy", template: "%s | Slippy" },
  description: "เรื่องเล็กๆวันนี้เปลี่ยนชีวิตให้ดีได้ขึ้นทุกวัน",
  keywords:    ["slippy", "accounting", "document", "AI", "OCR", "FlowAccount", "บัญชี", "สลิป", "ใบเสร็จ", "PDPA"],
  manifest:    "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Slippy" },
  themeColor:  [
    { media: "(prefers-color-scheme: light)", color: "#6366f1" },
    { media: "(prefers-color-scheme: dark)",  color: "#312e81" },
  ],
  icons: {
    icon: [
      { url: "/icon.svg",             type: "image/svg+xml" },
      { url: "/favicon-32x32.png",    type: "image/png", sizes: "32x32" },
      { url: "/favicon-16x16.png",    type: "image/png", sizes: "16x16" },
    ],
    apple: [
      { url: "/icons/ios/icon-60@3x.png",   sizes: "180x180" },
      { url: "/icons/ios/icon-76@2x.png",   sizes: "152x152" },
      { url: "/icons/ios/icon-83.5@2x.png", sizes: "167x167" },
    ],
    other: [
      { rel: "mask-icon",       url: "/icon.svg", color: "#6366f1" },
      { rel: "shortcut icon",   url: "/favicon-32x32.png" },
    ],
  },
  openGraph: {
    type:        "website",
    locale:      "th_TH",
    url:         "https://dev.slippyai.app",
    siteName:    "Slippy",
    title:       "Slippy — ระบบจัดการเอกสารบัญชีอัจฉริยะ",
    description: "เรื่องเล็กๆวันนี้เปลี่ยนชีวิตให้ดีได้ขึ้นทุกวัน",
    images: [
      {
        url:    "/og-image.png",
        width:  1200,
        height: 630,
        alt:    "Slippy — ระบบจัดการเอกสารบัญชีอัจฉริยะ",
      },
    ],
  },
  twitter: {
    card:        "summary_large_image",
    title:       "Slippy — ระบบจัดการเอกสารบัญชีอัจฉริยะ",
    description: "เรื่องเล็กๆวันนี้เปลี่ยนชีวิตให้ดีได้ขึ้นทุกวัน",
    images:      ["/og-image.png"],
  },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale   = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${inter.variable} ${notoSansThai.variable} font-sans`} suppressHydrationWarning>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <AppLoadingProvider>
              <SlippyLoader />
              {children}
            </AppLoadingProvider>
            <CookieBanner />
            <CookieManageButton />
            <Toaster
              position="top-right"
              richColors
              closeButton
              toastOptions={{
                style: { fontFamily: "var(--font-noto), var(--font-inter), sans-serif" },
              }}
            />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
