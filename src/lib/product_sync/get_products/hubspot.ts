import axios from "axios";

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN!;

export const hubspotAxios = axios.create({
  baseURL: "https://api.hubapi.com",
  headers: {
    Authorization: `Bearer ${HUBSPOT_TOKEN}`,
    "Content-Type": "application/json",
  },
});
