/**
 * The trip document's stylesheet — for the print page and for the PDF alike.
 *
 * EVERYTHING IS SCOPED UNDER `.doc`. That is not tidiness, it is the bug fix:
 * this stylesheet used to set `html, body { background: #fff }` and a dark body
 * colour, and it is injected into the running app. In dark mode that painted the
 * whole page white while the app's own theme kept the surrounding chrome light,
 * so the toolbar vanished into the background and the page was unreadable.
 *
 * The document is a SHEET OF PAPER. It is white with dark text in both themes —
 * the same way Preview or Google Docs shows a page — and the surface it sits on
 * belongs to the app. Nothing here may reach outside `.doc`.
 *
 * Three callers need it: the print page, the PDF route, and scripts/verify-pdf.ts,
 * which renders the same document to check that Thai and Japanese come out right.
 * A stylesheet only the route has cannot be tested without the route.
 */
export const PRINT_CSS = `
/* ── The sheet ────────────────────────────────────────────────────────────
   Fixed light colours on purpose. Paper is paper in both themes; the app's
   background behind it is what changes. */
.doc {
  --ink:        #0f172a;
  --ink-soft:   #475569;
  --ink-faint:  #64748b;
  --ink-ghost:  #94a3b8;
  --rule:       #e2e8f0;
  --rule-soft:  #f1f5f9;
  --accent:     #4f46e5;

  /* The stack has to cover three scripts on two operating systems.
     Thai: Noto Sans Thai (container) / Thonburi (macOS) / Loma (tlwg).
     CJK: Japanese place names appear in Japanese travel documents, and without
     a CJK family Chrome drops them SILENTLY — 指定席 came out as blank space in
     the first PDF, not as tofu, so nothing showed anything was missing. */
  font-family: "Noto Sans Thai", "Noto Sans", "Thonburi", "Loma",
               "Hiragino Sans", "Hiragino Kaku Gothic ProN",
               "Noto Sans CJK JP", "Noto Sans JP", "IPAGothic",
               "Helvetica Neue", Arial, sans-serif;
  background: #fff;
  color: var(--ink);
  font-size: 13px;
  line-height: 1.65;
  max-width: 860px;
  margin: 24px auto 64px;
  padding: 56px 56px 48px;
  border-radius: 4px;
  box-shadow: 0 1px 2px rgba(15,23,42,.06), 0 12px 32px rgba(15,23,42,.10);
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.doc *, .doc *::before, .doc *::after { box-sizing: border-box; }
.doc p { margin: 0; }
.doc table { border-collapse: collapse; width: 100%; }

/* ── Cover ── */
.doc .eyebrow { font-size: 10.5px; font-weight: 700; text-transform: uppercase;
                letter-spacing: .2em; color: var(--accent); }
.doc h1 { font-size: 32px; font-weight: 800; line-height: 1.15; letter-spacing: -0.02em;
          margin: 10px 0 0; color: var(--ink); }
.doc .sub  { font-size: 15px; color: var(--ink-soft); margin-top: 6px; }
.doc .lede { max-width: 62ch; color: var(--ink-soft); margin-top: 18px; }
.doc .muted { color: var(--ink-faint); }
.doc .tiny  { font-size: 11.5px; }
.doc .strong { font-weight: 600; }
.doc .reg { font-weight: 400; }
.doc .r { text-align: right; }
.doc .nowrap { white-space: nowrap; }
.doc .pre { white-space: pre-line; }
.doc .note { font-style: italic; color: var(--ink-faint); margin-top: 3px; }
.doc .num { font-variant-numeric: tabular-nums; }
.doc .mono { font-family: "DejaVu Sans Mono", ui-monospace, "SF Mono", monospace; }
.doc .block { margin-top: 22px; }
.doc .pad-top { padding-top: 30px; }

/* Section headings get a coloured rule — the one bit of colour on the page,
   which is what makes it scannable when printed in black and white too. */
.doc h2 { font-size: 17px; font-weight: 700; margin: 0; padding-bottom: 9px;
          border-bottom: 2px solid var(--accent); color: var(--ink);
          letter-spacing: -0.01em; }

.doc .stats { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 14px;
              border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
              padding: 18px 0; margin-top: 30px; }
.doc .statk { font-size: 9.5px; text-transform: uppercase; letter-spacing: .1em;
              color: var(--ink-faint); font-weight: 600; }
.doc .statv { font-size: 17px; font-weight: 700; margin-top: 3px;
              font-variant-numeric: tabular-nums; }

.doc .summary { margin-top: 28px; font-size: 12px; }
.doc .summary th { text-align: left; font-weight: 600; color: var(--ink-faint);
                   font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
                   border-bottom: 1px solid var(--rule); padding: 0 12px 7px 0; }
.doc .summary td { border-bottom: 1px solid var(--rule-soft); padding: 8px 12px 8px 0;
                   vertical-align: top; }
.doc .summary td.r, .doc .summary th.r { padding-right: 0; }
.doc .summary tr:last-child td { border-bottom: 0; }

/* ── Bookings ── */
.doc .cards { margin-top: 18px; }
.doc .card { border: 1px solid var(--rule); border-radius: 10px; padding: 14px 16px;
             margin-bottom: 12px; background: #fff; }
.doc .cardhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.doc .cardhead > div { min-width: 0; }
.doc .card p + p { margin-top: 6px; }
.doc .code { flex-shrink: 0; border: 1px solid var(--rule); border-radius: 6px;
             background: #f8fafc; padding: 5px 10px;
             font-family: "DejaVu Sans Mono", ui-monospace, monospace;
             font-size: 12px; font-weight: 700; letter-spacing: .02em; color: var(--ink); }

/* ── Day pages ── */
.doc .dayhead { border-bottom: 2px solid var(--accent); padding-bottom: 9px; }
.doc .dayhead h2 { border: 0; padding: 0; }
.doc .itin { margin-top: 14px; }
.doc .itin td { border-bottom: 1px solid var(--rule-soft); padding: 11px 12px 11px 0;
                vertical-align: top; }
.doc .itin tr:last-child td { border-bottom: 0; }
.doc .itin td.time { width: 54px; padding-right: 10px; font-size: 12px; font-weight: 700;
                     color: var(--accent); font-variant-numeric: tabular-nums; }
.doc .itin td.amt { width: 96px; padding-right: 0; }
.doc .itin p + p { margin-top: 3px; }
.doc .chip { border: 1px solid var(--rule); border-radius: 999px; padding: 1px 7px;
             font-size: 10px; font-weight: 600; color: var(--ink-faint); margin-left: 8px;
             white-space: nowrap; }

/* ── Budget / checklist / notes ── */
.doc .two { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 36px;
            margin-top: 18px; }
.doc .budget { margin-top: 10px; font-size: 12px; }
.doc .budget td { border-bottom: 1px solid var(--rule-soft); padding: 7px 0; }
.doc .budget .totalrow td { border-bottom: 2px solid var(--ink); font-weight: 700;
                            padding-top: 9px; }
.doc .checks { list-style: none; padding: 0; margin: 10px 0 0; font-size: 12px; }
.doc .checks li { display: flex; gap: 9px; margin-bottom: 6px; align-items: flex-start; }
.doc .box { flex-shrink: 0; width: 12px; height: 12px; margin-top: 3px;
            border: 1.5px solid var(--ink-faint); border-radius: 3px;
            text-align: center; font-size: 9px; line-height: 10px; color: var(--ink); }
.doc .done { color: var(--ink-ghost); text-decoration: line-through; }
.doc .note-block { margin-top: 14px; }
.doc .footer { margin-top: 44px; border-top: 1px solid var(--rule); padding-top: 14px;
               font-size: 10px; color: var(--ink-ghost); }

/* ── Paper ────────────────────────────────────────────────────────────────
   On paper the sheet IS the page: no shadow, no margin, no rounded corner. */
@media print {
  .no-print { display: none !important; }
  .doc { max-width: none; margin: 0; padding: 0; box-shadow: none; border-radius: 0; }
  .doc .print-page { break-after: page; }
  .doc .print-page:last-child { break-after: auto; }
  .doc .keep-together { break-inside: avoid; }
  .doc a[href]::after { content: ""; }
}
@page { size: A4; margin: 14mm 12mm; }
`
