// lib/netsuite/createNetsuiteCustomer.ts
import { getValidToken } from "./token";
import axios from "axios";
const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
//const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

const NSW_BASE = process.env.NS_WRITES_URL!;
const NSW_CLIENT_BEARER = process.env.NS_WRITES_ADMIN_BEARER!;

const COUNTRY_CODES: Record<string, string> = {
  Aruba: "AW",
  Afghanistan: "AF",
  Angola: "AO",
  Anguilla: "AI",
  "Åland Islands": "AX",
  Albania: "AL",
  Andorra: "AD",
  "United Arab Emirates": "AE",
  Argentina: "AR",
  Armenia: "AM",
  "American Samoa": "AS",
  Antarctica: "AQ",
  "French Southern Territories": "TF",
  "Antigua and Barbuda": "AG",
  Australia: "AU",
  Austria: "AT",
  Azerbaijan: "AZ",
  Burundi: "BI",
  Belgium: "BE",
  Benin: "BJ",
  "Bonaire, Sint Eustatius and Saba": "BQ",
  "Burkina Faso": "BF",
  Bangladesh: "BD",
  Bulgaria: "BG",
  Bahrain: "BH",
  Bahamas: "BS",
  "Bosnia and Herzegovina": "BA",
  "Saint Barthélemy": "BL",
  Belarus: "BY",
  Belize: "BZ",
  Bermuda: "BM",
  "Bolivia, Plurinational State of": "BO",
  Brazil: "BR",
  Barbados: "BB",
  "Brunei Darussalam": "BN",
  Bhutan: "BT",
  "Bouvet Island": "BV",
  Botswana: "BW",
  "Central African Republic": "CF",
  Canada: "CA",
  "Cocos (Keeling) Islands": "CC",
  Switzerland: "CH",
  Chile: "CL",
  China: "CN",
  "Côte d'Ivoire": "CI",
  Cameroon: "CM",
  "Congo, The Democratic Republic of the": "CD",
  Congo: "CG",
  "Cook Islands": "CK",
  Colombia: "CO",
  Comoros: "KM",
  "Cabo Verde": "CV",
  "Costa Rica": "CR",
  Cuba: "CU",
  Curaçao: "CW",
  "Christmas Island": "CX",
  "Cayman Islands": "KY",
  Cyprus: "CY",
  Czechia: "CZ",
  Germany: "DE",
  Djibouti: "DJ",
  Dominica: "DM",
  Denmark: "DK",
  "Dominican Republic": "DO",
  Algeria: "DZ",
  Ecuador: "EC",
  Egypt: "EG",
  Eritrea: "ER",
  "Western Sahara": "EH",
  Spain: "ES",
  Estonia: "EE",
  Ethiopia: "ET",
  Finland: "FI",
  Fiji: "FJ",
  "Falkland Islands (Malvinas)": "FK",
  France: "FR",
  "Faroe Islands": "FO",
  "Micronesia, Federated States of": "FM",
  Gabon: "GA",
  "United Kingdom": "GB",
  Georgia: "GE",
  Guernsey: "GG",
  Ghana: "GH",
  Gibraltar: "GI",
  Guinea: "GN",
  Guadeloupe: "GP",
  Gambia: "GM",
  "Guinea-Bissau": "GW",
  "Equatorial Guinea": "GQ",
  Greece: "GR",
  Grenada: "GD",
  Greenland: "GL",
  Guatemala: "GT",
  "French Guiana": "GF",
  Guam: "GU",
  Guyana: "GY",
  "Hong Kong": "HK",
  "Heard Island and McDonald Islands": "HM",
  Honduras: "HN",
  Croatia: "HR",
  Haiti: "HT",
  Hungary: "HU",
  Indonesia: "ID",
  "Isle of Man": "IM",
  India: "IN",
  "British Indian Ocean Territory": "IO",
  Ireland: "IE",
  "Iran, Islamic Republic of": "IR",
  Iraq: "IQ",
  Iceland: "IS",
  Israel: "IL",
  Italy: "IT",
  Jamaica: "JM",
  Jersey: "JE",
  Jordan: "JO",
  Japan: "JP",
  Kazakhstan: "KZ",
  Kenya: "KE",
  Kyrgyzstan: "KG",
  Cambodia: "KH",
  Kiribati: "KI",
  "Saint Kitts and Nevis": "KN",
  "Korea, Republic of": "KR",
  Kuwait: "KW",
  "Lao People's Democratic Republic": "LA",
  Lebanon: "LB",
  Liberia: "LR",
  Libya: "LY",
  "Saint Lucia": "LC",
  Liechtenstein: "LI",
  "Sri Lanka": "LK",
  Lesotho: "LS",
  Lithuania: "LT",
  Luxembourg: "LU",
  Latvia: "LV",
  Macao: "MO",
  "Saint Martin (French part)": "MF",
  Morocco: "MA",
  Monaco: "MC",
  "Moldova, Republic of": "MD",
  Madagascar: "MG",
  Maldives: "MV",
  Mexico: "MX",
  "Marshall Islands": "MH",
  "North Macedonia": "MK",
  Mali: "ML",
  Malta: "MT",
  Myanmar: "MM",
  Montenegro: "ME",
  Mongolia: "MN",
  "Northern Mariana Islands": "MP",
  Mozambique: "MZ",
  Mauritania: "MR",
  Montserrat: "MS",
  Martinique: "MQ",
  Mauritius: "MU",
  Malawi: "MW",
  Malaysia: "MY",
  Mayotte: "YT",
  Namibia: "NA",
  "New Caledonia": "NC",
  Niger: "NE",
  "Norfolk Island": "NF",
  Nigeria: "NG",
  Nicaragua: "NI",
  Niue: "NU",
  Netherlands: "NL",
  Norway: "NO",
  Nepal: "NP",
  Nauru: "NR",
  "New Zealand": "NZ",
  Oman: "OM",
  Pakistan: "PK",
  Panama: "PA",
  Pitcairn: "PN",
  Peru: "PE",
  Philippines: "PH",
  Palau: "PW",
  "Papua New Guinea": "PG",
  Poland: "PL",
  "Puerto Rico": "PR",
  "Korea, Democratic People's Republic of": "KP",
  Portugal: "PT",
  Paraguay: "PY",
  "Palestine, State of": "PS",
  "French Polynesia": "PF",
  Qatar: "QA",
  Réunion: "RE",
  Romania: "RO",
  "Russian Federation": "RU",
  Rwanda: "RW",
  "Saudi Arabia": "SA",
  Sudan: "SD",
  Senegal: "SN",
  Singapore: "SG",
  "South Georgia and the South Sandwich Islands": "GS",
  "Saint Helena, Ascension and Tristan da Cunha": "SH",
  "Svalbard and Jan Mayen": "SJ",
  "Solomon Islands": "SB",
  "Sierra Leone": "SL",
  "El Salvador": "SV",
  "San Marino": "SM",
  Somalia: "SO",
  "Saint Pierre and Miquelon": "PM",
  Serbia: "RS",
  "South Sudan": "SS",
  "Sao Tome and Principe": "ST",
  Suriname: "SR",
  Slovakia: "SK",
  Slovenia: "SI",
  Sweden: "SE",
  Eswatini: "SZ",
  "Sint Maarten (Dutch part)": "SX",
  Seychelles: "SC",
  "Syrian Arab Republic": "SY",
  "Turks and Caicos Islands": "TC",
  Chad: "TD",
  Togo: "TG",
  Thailand: "TH",
  Tajikistan: "TJ",
  Tokelau: "TK",
  Turkmenistan: "TM",
  "Timor-Leste": "TL",
  Tonga: "TO",
  "Trinidad and Tobago": "TT",
  Tunisia: "TN",
  Turkey: "TR",
  Tuvalu: "TV",
  "Taiwan, Province of China": "TW",
  "Tanzania, United Republic of": "TZ",
  Uganda: "UG",
  Ukraine: "UA",
  "United States Minor Outlying Islands": "UM",
  Uruguay: "UY",
  "United States": "US",
  USA: "US",
  Usa: "US",
  Uzbekistan: "UZ",
  "Holy See (Vatican City State)": "VA",
  "Saint Vincent and the Grenadines": "VC",
  "Venezuela, Bolivarian Republic of": "VE",
  "Virgin Islands, British": "VG",
  "Virgin Islands, U.S.": "VI",
  "Viet Nam": "VN",
  Vanuatu: "VU",
  "Wallis and Futuna": "WF",
  Samoa: "WS",
  Yemen: "YE",
  "South Africa": "ZA",
  Zambia: "ZM",
  Zimbabwe: "ZW",
};

function getCountryCode(name: string): string {
  return COUNTRY_CODES[name] || name; // fallback to input if already a code
}

function escapeSqlLiteral(v: string) {
  return v.replace(/'/g, "''");
}
async function findCustomerByEmail(email: string, accessToken: string) {
  const e = sanitizeSuiteQL(email);
  const q = `
    SELECT id FROM customer
    WHERE email = '${e}' OR entityid = '${e}'
  `;
  const resp = await axios.post(
    `${BASE_URL}/query/v1/suiteql`,
    { q },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "transient",
      },
    }
  );
  const match = resp.data.items?.[0];
  return match?.id || null;
}
function sanitizeSuiteQL(str: string) {
  return String(str ?? "").replace(/'/g, "''");
}

//Finding customer through HUBSPOT ID

async function findCustomerByHubspotId(hsId: string, accessToken: string) {
  const suiteQL = `
    SELECT id FROM customer
    WHERE custentity_hpl_hs_id = '${escapeSqlLiteral(hsId)}'
  `;

  const resp = await axios.post(
    `${BASE_URL}/query/v1/suiteql`,
    { q: suiteQL },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "transient",
      },
    }
  );

  const match = resp.data.items?.[0];
  return match?.id || null;
}

//Get Addressbook id (to avoid duplicate addresses in addressbook)
async function getCustomerWithAddressbook(id: string, accessToken: string) {
  const listResp = await axios.get(
    `${BASE_URL}/record/v1/customer/${id}/addressBook`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    }
  );

  const addressLinks = listResp.data.items.map(
    (item: any) => item.links.find((link: any) => link.rel === "self")?.href
  );

  const addressItems = await Promise.all(
    addressLinks.map((url: string) =>
      axios
        .get(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        })
        .then((res) => res.data)
    )
  );

  return { addressbook: { items: addressItems } };
}

async function enqueueUpdateCustomerToNSWrites(payload: any, idem?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${NSW_CLIENT_BEARER}`,
    "Content-Type": "application/json",
  };
  if (idem) headers["Idempotency-Key"] = idem;

  const r = await fetch(`${NSW_BASE}/api/netsuite/update-customer`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const txt = await r.text();
  let json: any;
  try {
    json = txt ? JSON.parse(txt) : undefined;
  } catch {}
  console.log("ns_writes response", {
    status: r.status,
    idem,
    body: json ?? txt,
  });
  if (!r.ok || json?.error) {
    const msg = json?.error || `HTTP ${r.status}: ${txt}`;
    throw new Error(`nswrites update-customer failed: ${msg}`);
  }
  return json; // { jobId }
}

function idemForUpdate(customer: any) {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);

  const idPart = customer.customerInternalId
    ? String(customer.customerInternalId)
    : "noid";

  return `upd2-${idPart}-${ts}-${rand}`;
}
export async function createNetsuiteCustomer(customer: any) {
  const accessToken = await getValidToken();

  let existingId: string | null =
    customer.customerInternalId != null && customer.customerInternalId !== ""
      ? String(customer.customerInternalId)
      : null;

  const hubspotId: string | null = customer.hsContactId || customer.id || null;

  if (!existingId && hubspotId) {
    existingId = await findCustomerByHubspotId(hubspotId, accessToken);
  }
  if (!existingId && customer.email) {
    existingId = await findCustomerByEmail(customer.email, accessToken);
  }

  if (existingId) {
    console.log("→ PATH A: ns_writes update-customer", { existingId });
    const nswPayload = {
      customerInternalId: existingId,
      hsContactId: hubspotId ?? undefined,
      id: hubspotId ?? undefined,

      email: customer.email ?? undefined,
      firstName: customer.firstName ?? undefined,
      middleName: customer.middleName ?? undefined,
      lastName: customer.lastName ?? undefined,
      phone: customer.phone ?? undefined,
      mobile: customer.mobile ?? undefined,

      billingAddress1: customer.billingAddress1 ?? undefined,
      billingAddress2: customer.billingAddress2 ?? undefined,
      billingCity: customer.billingCity ?? undefined,
      billingState: customer.billingState ?? undefined,
      billingZip: customer.billingZip ?? undefined,
      billingCountry: customer.billingCountry ?? undefined,

      shippingAddress1: customer.shippingAddress1 ?? undefined,
      shippingAddress2: customer.shippingAddress2 ?? undefined,
      shippingCity: customer.shippingCity ?? undefined,
      shippingState: customer.shippingState ?? undefined,
      shippingZip: customer.shippingZip ?? undefined,
      shippingCountry: customer.shippingCountry ?? undefined,

      shippingcarrier:
        (customer.shippingcarrier || "")?.toLowerCase() || undefined,
    };

    const idem = idemForUpdate(nswPayload);
    return await enqueueUpdateCustomerToNSWrites(nswPayload, idem);
  }
  console.log("→ PATH B: direct REST create in NetSuite");
  const payload = {
    entityId: customer.email,
    subsidiary: { id: "2" },
    companyName: `${customer.firstName ?? ""} ${
      customer.lastName ?? ""
    }`.trim(),
    email: customer.email,
    phone: customer.phone,
    mobilephone: customer.mobile,
    firstName: customer.firstName,
    middleName: customer.middleName,
    lastName: customer.lastName,
    custentity_hpl_hs_id: hubspotId || undefined,
    addressbook: {
      replaceAll: true,
      items: [
        {
          defaultBilling: true,
          defaultShipping: false,
          label: "Billing",
          addressbookaddress: {
            addr1: customer.billingAddress1,
            addr2: customer.billingAddress2,
            city: customer.billingCity,
            state: customer.billingState,
            zip: customer.billingZip,
            country: getCountryCode(customer.billingCountry),
            addressee: `${customer.firstName ?? ""} ${
              customer.lastName ?? ""
            }`.trim(),
            defaultBilling: true,
            defaultShipping: false,
          },
        },
        {
          defaultBilling: false,
          defaultShipping: true,
          label: "Shipping",
          addressbookaddress: {
            addr1: customer.shippingAddress1,
            addr2: customer.shippingAddress2,
            city: customer.shippingCity,
            state: customer.shippingState,
            zip: customer.shippingZip,
            country: getCountryCode(customer.shippingCountry),
            addressee: `${customer.firstName ?? ""} ${
              customer.lastName ?? ""
            }`.trim(),
            defaultBilling: false,
            defaultShipping: true,
          },
        },
      ],
    },
    shippingcarrier: (customer.shippingcarrier || "").toLowerCase(),
  };

  const response = await axios.post(`${BASE_URL}/record/v1/customer`, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  return response.data;
}
