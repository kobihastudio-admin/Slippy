/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

// Custom icon set matching Slippy design — strokeWidth 1.75
import type { SVGProps } from "react"

type IconProps = SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }

const Ic = ({ size = 18, strokeWidth = 1.75, children, className = "", ...rest }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size} height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...rest}
  >
    {children}
  </svg>
)

export const Icons = {
  Dashboard:        (p: IconProps) => <Ic {...p}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></Ic>,
  FileText:         (p: IconProps) => <Ic {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></Ic>,
  BarChart:         (p: IconProps) => <Ic {...p}><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx="0.5"/><rect x="12" y="8" width="3" height="10" rx="0.5"/><rect x="17" y="5" width="3" height="13" rx="0.5"/></Ic>,
  Receipt:          (p: IconProps) => <Ic {...p}><path d="M4 4v17l2.5-1.5L9 21l2.5-1.5L14 21l2.5-1.5L19 21V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1z"/><path d="M8 8h7"/><path d="M8 12h7"/><path d="M8 16h4"/></Ic>,
  Building:         (p: IconProps) => <Ic {...p}><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22V12h6v10"/><path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01"/></Ic>,
  Users:            (p: IconProps) => <Ic {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15 14.5a4.5 4.5 0 0 1 6.5 4"/></Ic>,
  Smartphone:       (p: IconProps) => <Ic {...p}><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="17" r="1"/></Ic>,
  QrCode:           (p: IconProps) => <Ic {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="5" y="5" width="3" height="3" fill="currentColor" stroke="none"/><rect x="16" y="5" width="3" height="3" fill="currentColor" stroke="none"/><rect x="5" y="16" width="3" height="3" fill="currentColor" stroke="none"/><path d="M14 14h2v2h-2zM16 16h2v2h-2zM18 14h2v2h-2zM14 18h4v2h-4z" fill="currentColor" stroke="none"/></Ic>,
  CreditCard:       (p: IconProps) => <Ic {...p}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h3"/></Ic>,
  Plug:             (p: IconProps) => <Ic {...p}><path d="M9 2v6"/><path d="M15 2v6"/><path d="M7 8h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5z"/><path d="M12 16v6"/></Ic>,
  Bell:             (p: IconProps) => <Ic {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.7 1.7 0 0 0 3.4 0"/></Ic>,
  ShieldCheck:      (p: IconProps) => <Ic {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></Ic>,
  User:             (p: IconProps) => <Ic {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></Ic>,
  HelpCircle:       (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 5.66 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></Ic>,
  Settings:         (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></Ic>,
  Split:            (p: IconProps) => <Ic {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15 14.5a4.5 4.5 0 0 1 6.5 4"/></Ic>,
  // Utility icons
  ChevronDown:      (p: IconProps) => <Ic {...p}><path d="m6 9 6 6 6-6"/></Ic>,
  ChevronRight:     (p: IconProps) => <Ic {...p}><path d="m9 6 6 6-6 6"/></Ic>,
  ChevronLeft:      (p: IconProps) => <Ic {...p}><path d="m15 6-6 6 6 6"/></Ic>,
  Plus:             (p: IconProps) => <Ic {...p}><path d="M12 5v14"/><path d="M5 12h14"/></Ic>,
  X:                (p: IconProps) => <Ic {...p}><path d="M18 6L6 18"/><path d="M6 6l12 12"/></Ic>,
  Check:            (p: IconProps) => <Ic {...p}><path d="M20 6L9 17l-5-5"/></Ic>,
  LogOut:           (p: IconProps) => <Ic {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></Ic>,
  Menu:             (p: IconProps) => <Ic {...p}><path d="M3 12h18"/><path d="M3 6h18"/><path d="M3 18h18"/></Ic>,
  PanelLeftClose:   (p: IconProps) => <Ic {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></Ic>,
  PanelLeftOpen:    (p: IconProps) => <Ic {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/></Ic>,
  Building2:        (p: IconProps) => <Ic {...p}><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></Ic>,
  Sun:              (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></Ic>,
  Moon:             (p: IconProps) => <Ic {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></Ic>,
  Monitor:          (p: IconProps) => <Ic {...p}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></Ic>,
  Download:         (p: IconProps) => <Ic {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></Ic>,
  Upload:           (p: IconProps) => <Ic {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></Ic>,
  Search:           (p: IconProps) => <Ic {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></Ic>,
  Filter:           (p: IconProps) => <Ic {...p}><path d="M3 5h18l-7 9v6l-4-2v-4z"/></Ic>,
  Calendar:         (p: IconProps) => <Ic {...p}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M8 3v4"/><path d="M16 3v4"/></Ic>,
  MoreHorizontal:   (p: IconProps) => <Ic {...p}><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></Ic>,
  ArrowUpRight:     (p: IconProps) => <Ic {...p}><path d="M7 17 17 7"/><path d="M7 7h10v10"/></Ic>,
  Send:             (p: IconProps) => <Ic {...p}><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></Ic>,
  Sparkles:         (p: IconProps) => <Ic {...p}><path d="m12 3 1.6 4.5L18 9l-4.4 1.5L12 15l-1.6-4.5L6 9l4.4-1.5z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M5 18v3"/><path d="M6.5 19.5h-3"/></Ic>,
  Zap:              (p: IconProps) => <Ic {...p}><path d="M13 2 3 14h8l-1 8 10-12h-8z"/></Ic>,
  Mail:             (p: IconProps) => <Ic {...p}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></Ic>,
  Copy:             (p: IconProps) => <Ic {...p}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></Ic>,
  Eye:              (p: IconProps) => <Ic {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/></Ic>,
  EyeOff:           (p: IconProps) => <Ic {...p}><path d="M9.9 5a10.4 10.4 0 0 1 2.1-.2c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7"/><path d="M6.6 6.6A13.5 13.5 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="m2 2 20 20"/></Ic>,
  AlertTriangle:    (p: IconProps) => <Ic {...p}><path d="m21.7 18-9.7-16-9.7 16z"/><path d="M12 9v4"/><path d="M12 17h.01"/></Ic>,
  Edit:             (p: IconProps) => <Ic {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/></Ic>,
  Trash:            (p: IconProps) => <Ic {...p}><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></Ic>,
  Camera:           (p: IconProps) => <Ic {...p}><path d="M14.5 4h-5L8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4z"/><circle cx="12" cy="13" r="3.5"/></Ic>,
  ZoomIn:           (p: IconProps) => <Ic {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></Ic>,
  ZoomOut:          (p: IconProps) => <Ic {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/><path d="M8 11h6"/></Ic>,
  RotateCw:         (p: IconProps) => <Ic {...p}><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></Ic>,
  Info:             (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h1v4h1"/></Ic>,
  Loader:           (p: IconProps) => <Ic {...p} className={`animate-spin ${p.className || ""}`}><path d="M12 2v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="M2 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="M12 18v4"/><path d="m19.07 19.07-2.83-2.83"/><path d="M20 12h4"/><path d="m19.07 4.93-2.83 2.83"/></Ic>,
  TrendingUp:       (p: IconProps) => <Ic {...p}><path d="m3 17 6-6 4 4 8-8"/><path d="M17 7h4v4"/></Ic>,
  TrendingDown:     (p: IconProps) => <Ic {...p}><path d="m3 7 6 6 4-4 8 8"/><path d="M17 17h4v-4"/></Ic>,
  PackagePlus:      (p: IconProps) => <Ic {...p}><path d="M16 16h6"/><path d="M19 13v6"/><path d="M12 3H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 3z"/><path d="M7 7h.01"/></Ic>,
  Star:             (p: IconProps) => <Ic {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></Ic>,
  LineBot:          (p: IconProps) => <Ic {...p}><rect x="2" y="4" width="20" height="15" rx="4"/><path d="M12 8.5c-3.3 0-6 2-6 4.5 0 1.5.9 2.8 2.3 3.6-.1.5-.4 1.7-.5 2l2.2-1.2c.6.2 1.3.3 2 .3 3.3 0 6-2 6-4.5S15.3 8.5 12 8.5z"/><path d="M10 12.5h4"/><path d="M12 11v3"/></Ic>,
  // ── Trip & Activity icons ────────────────────────────────────
  MapPin:           (p: IconProps) => <Ic {...p}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></Ic>,
  // ── Business Suite icons ────────────────────────────────────
  Briefcase:        (p: IconProps) => <Ic {...p}><rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></Ic>,
  // ── Life Graph icon ─────────────────────────────────────────
  Brain:            (p: IconProps) => <Ic {...p}><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.07-4.6A3 3 0 0 1 4.5 9a2.96 2.96 0 0 1 .09-.23 2.5 2.5 0 0 1-.09-4.27A2.5 2.5 0 0 1 9.5 2"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.07-4.6A3 3 0 0 0 19.5 9a2.96 2.96 0 0 0-.09-.23 2.5 2.5 0 0 0 .09-4.27A2.5 2.5 0 0 0 14.5 2"/></Ic>,
  // ── Personal Space icons ─────────────────────────────────────
  Leaf:             (p: IconProps) => <Ic {...p}><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></Ic>,
  Heart:            (p: IconProps) => <Ic {...p}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/></Ic>,
  Activity:         (p: IconProps) => <Ic {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></Ic>,
  Target:           (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></Ic>,
  Wallet:           (p: IconProps) => <Ic {...p}><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></Ic>,
  // ── Social Space icons ───────────────────────────────────────
  Globe:            (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></Ic>,
  Compass:          (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></Ic>,
  PenLine:          (p: IconProps) => <Ic {...p}><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.86a.5.5 0 0 1-.62-.62l.86-2.872a2 2 0 0 1 .506-.854z"/></Ic>,
  ShoppingBag:      (p: IconProps) => <Ic {...p}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></Ic>,
  UserPlus:         (p: IconProps) => <Ic {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></Ic>,
  MessageSquare:    (p: IconProps) => <Ic {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></Ic>,
  Users2:           (p: IconProps) => <Ic {...p}><path d="M14 19a6 6 0 0 0-12 0"/><circle cx="8" cy="9" r="4"/><path d="M22 19a6 6 0 0 0-6-6 4 4 0 1 0 0-8"/></Ic>,
  Clock:            (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></Ic>,
}
