"use server";

import logger from "@/lib/logger";
import to from "await-to-js";
import got, { HTTPError } from "got";
import { getCustomerCache } from "../cache";

const LIVESALEAPP_BASE_URL =
  process.env.LIVESALEAPP_BASE_URL || "https://bademail.onrender.com/v1";

function getBaseUrl() {
  return "https://portal.hplapidary.com"; //"http://localhost:3001";
}

const livesaleappGot = got.extend({
  prefixUrl: LIVESALEAPP_BASE_URL,
  headers: {
    "Content-Type": "application/json",
    ...(process.env.LIVESALEAPP_TOKEN && {
      Authorization: `Bearer ${process.env.LIVESALEAPP_TOKEN}`,
    }),
  },
  responseType: "json",
  hooks: {
    beforeRequest: [
      (options) => {
        const data = {
          url: options.url?.toString(),
          method: options.method,
          headers: options.headers,
          searchParams: options.searchParams,
          json: options.json,
        };
        logger.info("Got request send", data);
      },
    ],
    afterResponse: [
      (response) => {
        const bodyInfo = (() => {
          if (!response.body) {
            return { hasBody: false };
          }

          const bodySize =
            typeof response.body === "string"
              ? response.body.length
              : (() => {
                  try {
                    return JSON.stringify(response.body).length;
                  } catch (error) {
                    logger.warn(
                      "Failed to stringify response body for size calculation",
                      {
                        error:
                          error instanceof Error
                            ? error.message
                            : String(error),
                      }
                    );
                    return Number.MAX_SAFE_INTEGER;
                  }
                })();

          const MAX_BODY_LOG_SIZE = 10 * 1024;
          if (bodySize <= MAX_BODY_LOG_SIZE) {
            return { hasBody: true, body: response.body };
          } else {
            return {
              hasBody: true,
              bodySize: `${Math.round(bodySize / 1024)}KB`,
              bodyTruncated: true,
            };
          }
        })();

        const data = {
          url: response.request.options.url?.toString(),
          method: response.request.options.method,
          statusCode: response.statusCode,
          headers: response.headers,
          ...bodyInfo,
        };
        logger.info("Got response receive", data);
        return response;
      },
    ],
    beforeError: [
      (error) => {
        const data = {
          url: error.request?.options.url?.toString(),
          method: error.request?.options.method,
          code: error.code,
          message: error.message,
          statusCode: error.response?.statusCode,
          headers: error.response?.headers,
          responseBody: error.response?.body,
        };
        logger.error({
          message: "Got request error",
          error: error.message,
          data,
        });
        return error;
      },
    ],
  },
});

export interface LiveEventType {
  internalName: string;
  label: string;
  description: string;
  category: "EVENT_TYPE";
  createdAt: string;
  updatedAt: string;
  imageUrl?: string | null;
}

export interface LiveEvent {
  id: string;
  date: string;
  type: string;
  isEnded: boolean;
  targetRevenue: number;
  zoomMeetingId: number;
  startTime: string;
  endTime: string;
  _count: {
    customers: number;
    products: number;
    lots: number;
    hosts: number;
    producers: number;
    hands: number;
    manualPriceProducts: number;
    ChangeLog: number;
    E2ETesting: number;
    subscriberRegistrants: number;
  };
  totalSale: number;
  averageDiscount: number;
}

const liveEventTypes: LiveEventType[] = [
  {
    internalName: "cut_and_chat_live_event",
    label: "Cut and Chat Event",
    description: "This is a live event for Cut and Chat",
    category: "EVENT_TYPE",
    createdAt: "2024-10-11T01:20:15.971Z",
    updatedAt: "2024-10-11T01:33:08.014Z",
  },
  {
    internalName: "friday_rough_rock_event",
    label: "Friday Rough Rock Event",
    description: "This is a rough rock event that occurs on Fridays",
    category: "EVENT_TYPE",
    createdAt: "2024-09-06T08:17:40.141Z",
    updatedAt: "2024-09-06T08:17:40.141Z",
  },
  {
    internalName: "mineral_live_event",
    label: "Mineral Live Event",
    description: "This is a Mineral Live Event hosted on Saturday",
    category: "EVENT_TYPE",
    createdAt: "2024-10-18T05:04:17.432Z",
    updatedAt: "2024-10-22T11:28:24.446Z",
  },
  {
    internalName: "monday_live_event",
    label: "Monday Live Event",
    description: "This is Monday live event",
    category: "EVENT_TYPE",
    createdAt: "2025-04-23T04:02:54.686Z",
    updatedAt: "2025-04-23T04:02:54.686Z",
  },
  {
    internalName: "saturday_slab_event",
    label: "Saturday Slab Event",
    description: "This is a slab event that occurs on saturday",
    category: "EVENT_TYPE",
    createdAt: "2024-09-06T08:17:40.141Z",
    updatedAt: "2024-10-22T11:28:20.502Z",
  },
  {
    internalName: "sphere_collectors_event",
    label: "Sphere Collectors Event",
    description: "This is a sphere collectors event",
    category: "EVENT_TYPE",
    createdAt: "2024-09-06T08:17:40.141Z",
    updatedAt: "2024-09-06T08:17:40.141Z",
  },
  {
    internalName: "thursday_afternoon_live_event",
    label: "Thursday Afternoon Event",
    description: "This is Thursday afternoon event",
    category: "EVENT_TYPE",
    createdAt: "2025-08-20T03:42:59.592Z",
    updatedAt: "2025-08-20T03:42:59.592Z",
  },
  {
    internalName: "wednesday_rough_rock_event",
    label: "Wednesday Rough Rock Event",
    description: "This is a rough rock event that occurs on Wednesday",
    category: "EVENT_TYPE",
    createdAt: "2024-09-06T08:17:40.141Z",
    updatedAt: "2024-09-06T08:17:40.141Z",
  },
  {
    internalName: "machine_event",
    label: "Machine Event",
    description: "Machine Event for Day and Night use",
    category: "EVENT_TYPE",
    createdAt: "2025-11-11T14:29:04.569Z",
    updatedAt: "2025-11-11T14:29:04.569Z",
  },
  {
    internalName: "tumbling_event",
    label: "Tumble Event",
    description: "This is a Tumble Event",
    category: "EVENT_TYPE",
    createdAt: "2025-11-11T14:29:04.569Z",
    updatedAt: "2025-11-11T14:29:04.569Z",
  },
];

const LIVE_EVENT_TYPE_OVERRIDES: Record<
  string,
  Partial<Pick<LiveEventType, "label" | "description">>
> = {
  wednesday_rough_rock_event: {
    label: "Wednesday Rough Rock Event",
    description: "This is a rough rock event that occurs on Wednesday",
  },
};

const IGNORED_TYPES = new Set<string>(["test_type"]);

function typeToLabel(type: string): string {
  return type
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function buildDescriptionFromLabel(label: string): string {
  return `This is ${label}`;
}

const fallbackLiveEventTypes: LiveEventType[] = [
  {
    internalName: "cut_and_chat_live_event",
    label: "Cut And Chat Live Event",
    description: "This is Cut And Chat Live Event",
    category: "EVENT_TYPE",
    createdAt: "",
    updatedAt: "",
  },
];

type EventsRouteResponse = {
  success: boolean;
  eventTypes?: LiveEventType[];
  events?: any[];
  message?: string;
};

interface LiveEventsResult {
  success: boolean;
  events?: LiveEvent[];
  message?: string;
}

export async function fetchLiveEvents(page: number = 1) {
  const baseUrl = getBaseUrl();

  const [error, json] = await to(
    fetch(`${baseUrl}/api/supabase/events/get`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    }).then((res) => res.json() as Promise<EventsRouteResponse>)
  );

  if (error || !json?.success || !json.events) {
    logger.error("Supabase route error fetching events", {
      error,
      json,
    });
    return {
      success: false,
      message: "Failed to fetch live events. Please try again later.",
    } satisfies LiveEventsResult;
  }

  const defaultCounts: LiveEvent["_count"] = {
    customers: 0,
    products: 0,
    lots: 0,
    hosts: 0,
    producers: 0,
    hands: 0,
    manualPriceProducts: 0,
    ChangeLog: 0,
    E2ETesting: 0,
    subscriberRegistrants: 0,
  };

  const events: LiveEvent[] = (json.events as any[])
    .filter((ev) => ev && ev.type && !IGNORED_TYPES.has(ev.type))
    .map((ev) => ({
      id: ev.id,
      type: ev.type,
      date: ev.date,
      startTime: ev.startTime,
      endTime: ev.endTime,
      isEnded: ev.isEnded,
      targetRevenue: ev.targetRevenue ?? 0,
      zoomMeetingId: ev.zoomMeetingId ?? 0,
      totalSale: ev.totalSale ?? 0,
      averageDiscount: ev.averageDiscount ?? 0,
      _count: ev.counts ?? defaultCounts,
    }));

  return {
    success: true,
    events,
  } satisfies LiveEventsResult;
}

export async function getEventTypes(): Promise<LiveEventType[]> {
  const baseUrl = getBaseUrl();

  const [error, json] = await to(
    fetch(`${baseUrl}/api/supabase/events/get`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    }).then((res) => res.json() as Promise<EventsRouteResponse>)
  );

  if (error || !json?.success || !json.eventTypes) {
    logger.error("Supabase route error building event types", {
      error,
      json,
    });
    return fallbackLiveEventTypes;
  }

  const filtered = json.eventTypes.filter(
    (t) => !IGNORED_TYPES.has(t.internalName)
  );

  if (!filtered.length) {
    return fallbackLiveEventTypes;
  }

  return filtered.map((t) => {
    const override = LIVE_EVENT_TYPE_OVERRIDES[t.internalName];

    let baseLabel = t.label;
    if (!baseLabel || baseLabel.includes("_")) {
      baseLabel = typeToLabel(t.internalName);
    }

    let label = override?.label ?? baseLabel;

    if (t.internalName === "saturday_slab_event" && !override?.label) {
      label = "Saturday Live Event";
    }

    const description =
      override?.description ??
      t.description ??
      buildDescriptionFromLabel(label);

    return {
      ...t,
      label,
      description,
      category: "EVENT_TYPE",
    };
  });
}

export async function getEventTypeByInternalName(
  internalName: string
): Promise<LiveEventType | undefined> {
  const types = await getEventTypes();
  const fromSupabase = types.find((type) => type.internalName === internalName);
  if (fromSupabase) return fromSupabase;
  return liveEventTypes.find((type) => type.internalName === internalName);
}

export async function isEventCurrentlyLive(event: LiveEvent): Promise<boolean> {
  logger.info("Checking if event is currently live", { event });
  const now = new Date();
  const startTime = new Date(event.startTime);
  const endTime = new Date(event.endTime);

  const HALF_HOUR_MS = 1 * 60 * 60 * 1000;
  const thresholdStartTime = new Date(startTime.getTime() - HALF_HOUR_MS);
  const thresholdEndTime = new Date(endTime.getTime() + HALF_HOUR_MS);

  return true; //now >= thresholdStartTime && now <= thresholdEndTime;
}

interface JoinLiveSessionArgs {
  email: string;
  firstName: string;
  lastName: string;
  middleName?: string;
}

interface JoinLiveSessionResult {
  success: boolean;
  joinUrl?: string;
  message: string;
}

interface ZoomJoinUrlResponse {
  data?: {
    joinUrl?: string;
  };
  code?: string;
}

export async function joinLiveSession(
  eventId: string,
  args: JoinLiveSessionArgs
): Promise<JoinLiveSessionResult> {
  const { email, firstName, lastName, middleName } = args;

  logger.info("Getting zoom join URL", { eventId, email });

  let joinUrlData;

  const customerCache = getCustomerCache();
  await customerCache.invalidateCustomerByEmail(email);
  const [getUrlError, getUrlResponse] = await to(
    livesaleappGot
      .post(`live-event/${eventId}/get-zoom-join-url`, {
        json: { email },
      })
      .json<ZoomJoinUrlResponse>()
  );

  if (getUrlError) {
    if (getUrlError instanceof HTTPError && getUrlError.response) {
      joinUrlData = getUrlError.response.body as ZoomJoinUrlResponse;
    } else {
      logger.error("Unexpected error getting zoom join URL", {
        error: getUrlError,
      });
      return {
        success: false,
        message: "An unexpected error occurred. Please try again later.",
      };
    }
  } else {
    joinUrlData = getUrlResponse;
    logger.info("Retrieved existing zoom join URL", { joinUrlData });

    if (joinUrlData.data?.joinUrl) {
      return {
        success: true,
        joinUrl: joinUrlData.data.joinUrl,
        message: "Successfully retrieved existing join URL",
      };
    }
  }

  if ((joinUrlData as ZoomJoinUrlResponse).code === "ZOOM_JOIN_URL_NOT_FOUND") {
    logger.info("No existing join URL found, creating new one", {
      eventId,
      email,
      firstName,
      lastName,
    });

    const [createError, createJoinData] = await to(
      livesaleappGot
        .post(`live-event/${eventId}/zoom-join-by-email`, {
          json: {
            email,
            firstName: firstName || "",
            lastName: lastName || "",
            middleName: middleName || "",
          },
        })
        .json<ZoomJoinUrlResponse>()
    );

    if (createError) {
      logger.error("Failed to create zoom join URL", {
        error: createError,
        eventId,
        email,
      });
      return {
        success: false,
        message:
          "Unable to join the live event at this time. Please try again later.",
      };
    }

    logger.info("Created new zoom join URL", { createJoinData });

    if (createJoinData?.data?.joinUrl) {
      return {
        success: true,
        joinUrl: createJoinData.data.joinUrl,
        message: "Successfully created new join URL",
      };
    }
  }

  logger.error(
    "Failed to get or create zoom join URL - no valid response received",
    { eventId, email }
  );
  return {
    success: false,
    message: "Unable to join the live event. Please try again later.",
  };
}
