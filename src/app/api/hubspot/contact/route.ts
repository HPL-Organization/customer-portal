// src/app/api/hubspot/contact/route.ts
import {
  getContactById,
  updateContactById,
} from "@/lib/hubspot/hubspotCentral";

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const contactId = searchParams.get("contactId");

  if (!contactId) {
    return new Response(JSON.stringify({ error: "Missing contactId" }), {
      status: 400,
    });
  }

  try {
    const contact = await getContactById(contactId);
    return new Response(JSON.stringify(contact), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
    });
  }
}

export async function PATCH(req: Request): Promise<Response> {
  const body: any = await req.json();
  const { contactId, update } = body;

  if (!contactId || !update) {
    return new Response(
      JSON.stringify({ error: "Missing contactId or update data" }),
      {
        status: 400,
      }
    );
  }

  try {
    const result = await updateContactById(contactId, update);
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err: any) {
    console.error("HubSpot Update Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
    });
  }
}
