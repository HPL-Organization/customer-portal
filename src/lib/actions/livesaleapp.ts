"use server";

import logger from "@/lib/logger";
import to from "await-to-js";
import got, { HTTPError } from "got";

const LIVESALEAPP_BASE_URL =
  process.env.LIVESALEAPP_BASE_URL || "https://bademail.onrender.com/v1";

// Create a got instance with default authorization header
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
        // Check body size to determine if we should log it
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
                    // Handle circular references or other stringify errors
                    logger.warn(
                      "Failed to stringify response body for size calculation",
                      {
                        error:
                          error instanceof Error
                            ? error.message
                            : String(error),
                      }
                    );
                    return Number.MAX_SAFE_INTEGER; // Treat as very large to skip logging
                  }
                })();

          // Log body if under 10KB threshold
          const MAX_BODY_LOG_SIZE = 10 * 1024; // 10KB
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
}

export interface LiveEvent {
  id: string;
  date: string;
  type: string; // This is the eventTypeId that matches internalName
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
  // {
  //   "internalName": "test_type",
  //   "label": "Test Type",
  //   "description": "",
  //   "category": "EVENT_TYPE",
  //   "createdAt": "2024-10-21T07:34:54.408Z",
  //   "updatedAt": "2025-03-29T16:56:55.790Z"
  // },
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
    label: "Wednesday Rough Rock Event", // Machine Night
    description: "This is a rough rock event that occurs on Wednesday", //This is a special event!
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

export async function fetchLiveEvents(page: number = 1) {
  const [error, resp] = await to(
    livesaleappGot
      .get("live-event", {
        searchParams: {
          page: page.toString(),
          distinctType: "true",
          take: "20",
        },
      })
      .json<LiveEventsResponse>()
  );

  if (error) {
    logger.error("LiveSaleApp API error", { error });
    return {
      success: false,
      message: "Failed to fetch live events. Please try again later.",
    };
  }

  return {
    success: true,
    events: resp?.results || [],
  } satisfies LiveEventsResult;
}

export async function getEventTypes(): Promise<LiveEventType[]> {
  return liveEventTypes;
}

export async function getEventTypeByInternalName(
  internalName: string
): Promise<LiveEventType | undefined> {
  return liveEventTypes.find((type) => type.internalName === internalName);
}

export async function isEventCurrentlyLive(event: LiveEvent): Promise<boolean> {
  if (event.isEnded) {
    return false;
  }
  const now = new Date();
  const startTime = new Date(event.startTime);
  const endTime = new Date(event.endTime);

  const HALF_HOUR_MS = 1 * 60 * 60 * 1000; // 1 hour
  const thresholdStartTime = new Date(startTime.getTime() - HALF_HOUR_MS);
  const thresholdEndTime = new Date(endTime.getTime() + HALF_HOUR_MS);

  return now >= thresholdStartTime && now <= thresholdEndTime;
}

interface JoinLiveSessionArgs {
  email: string;
  firstName: string;
  lastName: string;
}

interface JoinLiveSessionResult {
  success: boolean;
  joinUrl?: string;
  message: string;
}

interface LiveEventsResponse {
  results?: LiveEvent[];
}

interface LiveEventsResult {
  success: boolean;
  events?: LiveEvent[];
  message?: string;
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
  const { email, firstName, lastName } = args;

  // First, try to get existing zoom join url
  logger.info("Getting zoom join URL", { eventId, email });

  let joinUrlData;
  const [getUrlError, getUrlResponse] = await to(
    livesaleappGot
      .post(`live-event/${eventId}/get-zoom-join-url`, {
        json: { email },
      })
      .json<ZoomJoinUrlResponse>()
  );

  if (getUrlError) {
    // got throws HTTPError for non-2xx responses
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

  // Check if the response indicates no join URL found
  if ((joinUrlData as ZoomJoinUrlResponse).code === "ZOOM_JOIN_URL_NOT_FOUND") {
    logger.info("No existing join URL found, creating new one", {
      eventId,
      email,
      firstName,
      lastName,
    });

    // Call the zoom-join-by-email API to create a new join URL
    const [createError, createJoinData] = await to(
      livesaleappGot
        .post(`live-event/${eventId}/zoom-join-by-email`, {
          json: {
            email,
            firstName: firstName || "",
            lastName: lastName || "",
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
