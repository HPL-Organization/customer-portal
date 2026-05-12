import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import logger from '@/lib/logger'

export const dynamic = 'force-dynamic'

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/**
 * Returns { supabase, userId, customerId, isAdmin }.
 *
 * Admin path (imp=1 cookie):  service-role client, no Supabase user required.
 * Normal path:                anon client validated via getUser().
 */
async function resolveAuth(nsIdFromBody?: number | null) {
  const cookieStore = await cookies()
  const imp        = cookieStore.get('imp')?.value
  const nsIdCookie = cookieStore.get('nsId')?.value

  const isAdmin = imp === '1' && !!nsIdCookie

  if (isAdmin) {
    // Same pattern as manage-users/actions.ts
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    // Prefer the nsId from the request body (the customer being edited),
    // fall back to the cookie nsId (the admin's own id).
    const customerId = nsIdFromBody ?? (nsIdCookie ? Number(nsIdCookie) : null)
    return { supabase, userId: null as string | null, customerId, isAdmin: true }
  }

  // Normal user path
  const supabase = await getServerSupabase()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null

  const hasNsId   = !!nsIdFromBody && nsIdFromBody > 0
  const customerId = hasNsId ? nsIdFromBody : null
  return { supabase, userId: user.id, customerId, isAdmin: false }
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const nsIdRaw = req.nextUrl.searchParams.get('nsId')
    const nsId    = nsIdRaw ? Number(nsIdRaw) : null

    const auth = await resolveAuth(nsId)
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { supabase, userId, customerId } = auth
    const hasNsId = !!customerId && customerId > 0

    // 1. Lookup by customer_id
    if (hasNsId) {
      const { data, error } = await supabase
        .from('communication_preferences')
        .select('*')
        .eq('customer_id', customerId)
        .maybeSingle()

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (data)  return NextResponse.json({ ok: true, data })
    }

    // 2. Fallback: lookup by user_id
    if (userId) {
      const { data, error } = await supabase
        .from('communication_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, data: data ?? null })
    }

    return NextResponse.json({ ok: true, data: null })

  } catch (err: any) {
    logger.error({ message: 'comm-prefs GET error', error: err?.message })
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

type PostBody = {
  section: 'liveEvents' | 'newsletters' | 'promotions' | 'support'
  prefs:   Record<string, any>
  nsId?:   number | null
}

export async function POST(req: NextRequest) {
  try {
    const body: PostBody = await req.json()
    const { section, prefs, nsId } = body

    if (!section || !prefs) {
      return NextResponse.json({ error: 'Missing section or prefs' }, { status: 400 })
    }

    const auth = await resolveAuth(nsId)
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { supabase, userId, customerId } = auth

    const patch = buildPatch(section, prefs)
    if (!patch) {
      return NextResponse.json({ error: `Unknown section: "${section}"` }, { status: 400 })
    }

    const hasNsId = !!customerId && customerId > 0

    // Determine conflict target — mirrors save-customer-info.ts logic
    let conflictTarget: 'customer_id' | 'user_id' = hasNsId ? 'customer_id' : 'user_id'

    if (hasNsId && userId) {
      const { data: existing } = await supabase
        .from('communication_preferences')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle()
      if (existing) conflictTarget = 'user_id'
    }

    const row: Record<string, any> = { ...patch }
    if (customerId) row.customer_id = customerId
    if (userId)     row.user_id     = userId

    const { data: saved, error: upsertErr } = await supabase
      .from('communication_preferences')
      .upsert(row, { onConflict: conflictTarget })
      .select()
      .single()

    if (upsertErr) {
      logger.error({ message: 'comm-prefs upsert failed', error: upsertErr.message })
      return NextResponse.json({ error: upsertErr.message }, { status: 500 })
    }

    // Fire-and-forget HubSpot sync — never blocks the user response
    syncToHubSpot(userId, customerId, section, prefs).catch((err) => {
      logger.error({ message: 'comm-prefs HubSpot sync failed (non-fatal)', error: err?.message })
    })

    return NextResponse.json({ ok: true, data: saved })

  } catch (err: any) {
    logger.error({ message: 'comm-prefs POST error', error: err?.message })
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildPatch(section: PostBody['section'], prefs: Record<string, any>) {
  switch (section) {
    case 'liveEvents':
      return {
        live_events_general:       prefs.general   ?? 'none',
        live_events_reminders:     prefs.reminders ?? 'none',
        live_events_channel_email: !!prefs.email,
        live_events_channel_sms:   !!prefs.sms,
      }
    case 'newsletters':
      return { newsletters_frequency: prefs.frequency ?? 'none' }
    case 'promotions':
      return {
        promotions_general:      prefs.general     ?? 'none',
        promotions_discounts:    prefs.discounts   ?? 'none',
        promotions_new_products: prefs.newProducts ?? 'none',
      }
    case 'support':
      return {
        support_tickets_email: !!prefs.ticketsEmail,
        support_tickets_sms:   !!prefs.ticketsSms,
      }
    default:
      return null
  }
}

async function syncToHubSpot(
  userId: string | null,
  customerId: number | null,
  section: string,
  prefs: Record<string, any>
) {
  // Service-role client — can read customer_information regardless of RLS
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  let query = supabase.from('customer_information').select('hubspot_id')

  if (customerId) {
    query = query.eq('customer_id', customerId)
  } else if (userId) {
    query = query.eq('user_id', userId)
  } else {
    return
  }

  const { data: info } = await query.limit(1).maybeSingle()
  const hsId = info?.hubspot_id
  if (!hsId) return

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/hubspot/communication-preferences`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hubspotContactId: String(hsId), section, prefs }),
    }
  )

  if (!res.ok) {
    throw new Error(`HubSpot ${res.status}: ${await res.text().catch(() => '')}`)
  }

  // Mark as synced
  const filter = customerId
    ? supabase.from('communication_preferences').update({ hs_synced_at: new Date().toISOString() }).eq('customer_id', customerId)
    : supabase.from('communication_preferences').update({ hs_synced_at: new Date().toISOString() }).eq('user_id', userId!)

  await filter
}
