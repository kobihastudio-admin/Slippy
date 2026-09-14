import { NextRequest, NextResponse } from "next/server"
import { createClient }       from "@/lib/supabase/server"
import { createAdminClient }  from "@/lib/supabase/admin"
import { createTripExpense, type SplitMode } from "@/lib/trip-settlement"
import { getTripAccess }  from "@/lib/trips/trip-access"
import { recordDenied }   from "@/lib/activity-log"

type Params = { params: Promise<{ id: string }> }

// POST — add expense to a trip + auto-compute splits
export async function POST(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // Authorization, not just authentication. Every route in this folder reaches
  // for the service-role client below, which bypasses RLS entirely — so a
  // logged-in session proved only that somebody exists, never that this trip is
  // theirs. Until this guard, a trip id worked as a bearer token: anyone with an
  // account could read or write any trip whose id they could see or guess.
  //
  // 404 rather than 403, so a stranger cannot use the difference to discover
  // which trip ids are real.
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) {
    recordDenied("trip.view", { userId: user.id, resourceType: "trip", resourceId: tripId, req })
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const body = await req.json() as {
    paid_by_id:   string
    title:        string
    amount:       number
    category?:    string
    split_mode?:  SplitMode
    split_with?:  string[]              // participant IDs included (empty = everyone)
    split_values?: Record<string, number> // raw input for individual/percent/shares — keyed by participant id
    document_id?: string                // linked receipt
    note?:        string
    expense_date?: string
    currency?:      string              // defaults to trip's base_currency
    exchange_rate?: number              // manual override — omit to auto-fetch by expense_date
    /**
     * Optional per-item breakdown. Amounts are in `currency` — the receipt's
     * own currency — never the trip base. There is one conversion per expense
     * and it happens on the expense row; see the migration.
     */
    items?: Array<{
      description: string
      quantity?: number | null
      unit_price?: number | null
      amount: number
    }>
  }

  const admin = createAdminClient()

  try {
    const expenseId = await createTripExpense({
      tripId,
      paidById:    body.paid_by_id,
      title:       body.title,
      amount:      body.amount,
      category:    body.category,
      splitMode:   body.split_mode,
      splitWith:   body.split_with,
      splitValues: body.split_values,
      documentId:  body.document_id,
      note:        body.note,
      expenseDate: body.expense_date,
      currency:     body.currency,
      exchangeRate: body.exchange_rate,
    }, admin)

    // The breakdown, if one was given. Written after the expense so a failure
    // here cannot leave an orphan — and reported rather than swallowed, because
    // an expense that silently lost its lines looks identical to one that never
    // had any.
    let itemsSaved = 0
    let itemsError: string | null = null
    const items = (body.items ?? []).filter(i => i.description?.trim())
    if (items.length) {
      const { error } = await admin.from("trip_expense_items").insert(
        items.map((i, k) => ({
          expense_id:  expenseId,
          sort_order:  k,
          description: i.description.trim(),
          quantity:    i.quantity ?? null,
          unit_price:  i.unit_price ?? null,
          amount:      Number(i.amount) || 0,
        })),
      )
      if (error) itemsError = error.message
      else itemsSaved = items.length
    }

    return NextResponse.json({ expenseId, itemsSaved, itemsError })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "หารเงินไม่สำเร็จ" }, { status: 400 })
  }
}

// GET — list expenses for a trip
export async function GET(req: NextRequest, { params }: Params) {
  const { id: tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // Authorization, not just authentication. Every route in this folder reaches
  // for the service-role client below, which bypasses RLS entirely — so a
  // logged-in session proved only that somebody exists, never that this trip is
  // theirs. Until this guard, a trip id worked as a bearer token: anyone with an
  // account could read or write any trip whose id they could see or guess.
  //
  // 404 rather than 403, so a stranger cannot use the difference to discover
  // which trip ids are real.
  const access = await getTripAccess(tripId, user.id)
  if (!access.allowed) {
    recordDenied("trip.view", { userId: user.id, resourceType: "trip", resourceId: tripId, req })
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { data: expenses } = await supabase.from("trip_expenses")
    .select(`
      id, title, amount, category, split_mode, split_values, note, expense_date, created_at,
      currency, exchange_rate, amount_base_currency, rate_is_manual,
      documents(vendor_name, total_amount, doc_date),
      trip_participants!trip_expenses_paid_by_id_fkey(id, display_name),
      expense_splits(id, participant_id, amount, is_paid)
    `)
    .eq("journey_id", tripId)
    .order("expense_date")

  return NextResponse.json({ expenses: expenses ?? [] })
}
