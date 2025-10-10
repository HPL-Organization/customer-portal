// lib/HubSpot.ts
import axios, { AxiosInstance } from "axios";

const hubspot: AxiosInstance = axios.create({
  baseURL: "https://api.hubapi.com",
  headers: {
    Authorization: `Bearer ${process.env.HUBSPOT_TOKEN as string}`,
    "Content-Type": "application/json",
  },
});

export async function getContactByDealId(dealId: string): Promise<any> {
  const baseUrl = "https://api.hubapi.com";

  // Step 1: Get associated contact ID from deal
  const dealResponse = await fetch(
    `${baseUrl}/crm/v3/objects/deals/${dealId}/associations/contacts`,
    {
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_TOKEN as string}`,
      },
    }
  );

  const dealData = (await dealResponse.json()) as any;
  const contactId = dealData.results?.[0]?.id;

  if (!contactId) throw new Error("No contact associated with deal");

  // Step 2: Fetch contact details with full address properties
  const contactResponse = await fetch(
    `${baseUrl}/crm/v3/objects/contacts/${contactId}?properties=firstname,middle_name,lastname,phone,email,mobilephone,address,address_line_2,city,state,zip,country,shipping_address,shipping_address_line_2,shipping_city,shipping_state_region,shipping_postalcode,shipping_country_region,required_shipping_method,hpl_shipping_check,hpl_billing_check`,
    {
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_TOKEN as string}`,
      },
    }
  );

  const contactData = (await contactResponse.json()) as any;

  return contactData;
}

export async function getContactById(contactId: string): Promise<any> {
  const baseUrl = "https://api.hubapi.com";

  const props = [
    "firstname",
    "middle_name",
    "lastname",
    "phone",
    "email",
    "mobilephone",
    "address",
    "address_line_2",
    "city",
    "state",
    "zip",
    "country",
    "shipping_address",
    "shipping_address_line_2",
    "shipping_city",
    "shipping_state_region",
    "shipping_postalcode",
    "shipping_country_region",
    "required_shipping_method",
    "hpl_shipping_check",
    "hpl_billing_check",
  ].join(",");

  const res = await fetch(
    `${baseUrl}/crm/v3/objects/contacts/${encodeURIComponent(
      contactId
    )}?properties=${props}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_TOKEN as string}`,
      },
    }
  );

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`HubSpot GET contact failed: ${res.status} ${msg}`);
  }

  return res.json();
}

export async function updateContactById(
  contactId: string,
  updateFields: Record<string, any>
): Promise<any> {
  const res = await hubspot.patch(`/crm/v3/objects/contacts/${contactId}`, {
    properties: updateFields,
  });
  return res.data;
}

// put sales order number from netsuite to hubspot
export async function updateDealWithSalesOrder(
  dealId: string,
  tranid: string
): Promise<void> {
  try {
    await hubspot.patch(`/crm/v3/objects/deals/${dealId}`, {
      properties: {
        netsuite_sale_id: tranid,
      },
    });
    console.log(
      ` Updated HubSpot deal ${dealId} with NetSuite tranid ${tranid}`
    );
  } catch (error: any) {
    console.error(
      " Failed to update HubSpot deal with tranid:",
      error.response?.data || error.message
    );
  }
}

// get sales order number from hubspot-
export async function getSalesOrderNumberFromDeal(
  dealId: string
): Promise<string | null> {
  console.log("fetching sales order");
  try {
    const response = await hubspot.get(`/crm/v3/objects/deals/${dealId}`, {
      params: {
        properties: "netsuite_sale_id",
      },
    });

    const tranid = response.data.properties?.netsuite_sale_id as
      | string
      | undefined;
    console.log(` Fetched tranid from HubSpot deal ${dealId}:`, tranid);
    return tranid || null;
  } catch (error: any) {
    console.error(" Failed to fetch tranid from deal:", error.message);
    return null;
  }
}

// Put internal NetSuite sales order ID into HubSpot
export async function updateDealWithSalesOrderInternalId(
  dealId: string,
  internalId: string
): Promise<void> {
  try {
    await hubspot.patch(`/crm/v3/objects/deals/${dealId}`, {
      properties: {
        netsuite_so_int_id: internalId,
      },
    });
    console.log(
      ` Updated HubSpot deal ${dealId} with internal ID ${internalId}`
    );
  } catch (error: any) {
    console.error(
      " Failed to update HubSpot deal with internal ID:",
      error.response?.data || error.message
    );
  }
}

// Fetch internal NetSuite sales order ID from HubSpot
export async function getSalesOrderInternalIdFromDeal(
  dealId: string
): Promise<string | null> {
  try {
    const response = await hubspot.get(`/crm/v3/objects/deals/${dealId}`, {
      params: {
        properties: "netsuite_so_int_id",
      },
    });

    const internalId = response.data.properties?.netsuite_so_int_id as
      | string
      | undefined;
    console.log(
      ` Fetched internal ID from HubSpot deal ${dealId}:`,
      internalId
    );
    return internalId || null;
  } catch (error: any) {
    console.error(" Failed to fetch internal ID from deal:", error.message);
    return null;
  }
}

// Fetch shipping method options
export async function getShippingMethodOptions(): Promise<any[]> {
  try {
    const response = await hubspot.get(
      "/properties/v1/contacts/properties/named/required_shipping_method"
    );
    return (response.data.options as any[]) || [];
  } catch (error: any) {
    console.error("Error fetching shipping method options", error);
    return [];
  }
}
