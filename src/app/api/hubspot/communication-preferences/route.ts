import { NextRequest, NextResponse } from "next/server";
import { updateContactById } from "@/lib/hubspot/hubspotCentral";

// Maps portal internal values → HubSpot dropdown option labels
const FREQ_LABEL: Record<string, string> = {
  all: "All of them",
  weekly: "Weekly summary",
  monthly: "Monthly summary",
  none: "I don't want to receive anything from here.",
};

const REMINDER_LABEL: Record<string, string> = {
  none: "I don't need reminders.",
  hour: "Remind me an hour before the event.",
  day: "Remind me one day before the event.",
};

const CHANNEL_LABEL: Record<string, string> = {
  true: "Enabled",
  false: "Disabled",
};

/**
 * POST /api/hubspot/communication-preferences
 * Body: { hubspotContactId: string, section: string, prefs: object }
 *
 * Supported sections: "liveEvents" | "newsletters" | "promotions" | "support"
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { hubspotContactId, section, prefs } = body;

  if (!hubspotContactId || !section || !prefs) {
    return NextResponse.json(
      { error: "Missing hubspotContactId, section, or prefs" },
      { status: 400 }
    );
  }

  let properties: Record<string, string> = {};

  switch (section) {
    case "liveEvents":
      properties = {
        live_events_general: FREQ_LABEL[prefs.general] ?? prefs.general,
        live_events_reminders_email: REMINDER_LABEL[prefs.remindersEmail] ?? prefs.remindersEmail,
        live_events_reminders_sms:   REMINDER_LABEL[prefs.remindersSms]   ?? prefs.remindersSms,
      };
      break;

    case "newsletters":
      properties = {
        educational_newsletters_and_guides:
          FREQ_LABEL[prefs.frequency] ?? prefs.frequency,
      };
      break;

    case "promotions":
      properties = {
        promotions_and_announcements_general:
          FREQ_LABEL[prefs.general] ?? prefs.general,
        promotions_and_announcements_discounts_and_giveaway:
          FREQ_LABEL[prefs.discounts] ?? prefs.discounts,
        promotions_and_announcements_new_machines_rough_rock_or_finished_goods:
          FREQ_LABEL[prefs.newProducts] ?? prefs.newProducts,
      };
      break;

    case "support":
      properties = {
        cs_support_tickets_email: CHANNEL_LABEL[String(prefs.ticketsEmail)] ?? String(prefs.ticketsEmail),
        cs_support_tickets_sms: CHANNEL_LABEL[String(prefs.ticketsSms)] ?? String(prefs.ticketsSms),
      };
      break;

    default:
      return NextResponse.json(
        { error: `Unknown section: "${section}"` },
        { status: 400 }
      );
  }

  try {
    const result = await updateContactById(hubspotContactId, properties);
    return NextResponse.json({ ok: true, updated: properties, result });
  } catch (err: any) {
    console.error("[HubSpot comm-prefs] Update failed:", err?.message);
    return NextResponse.json(
      { error: err?.message ?? "HubSpot update failed" },
      { status: 500 }
    );
  }
}
