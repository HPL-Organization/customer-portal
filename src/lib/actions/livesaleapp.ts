"use server";

const LIVESALEAPP_BASE_URL = "https://bademail.onrender.com/v1";

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
    label: "Wednesday Rough Rock Event",
    description: "This is a rough rock event that occurs on Wednesday",
    category: "EVENT_TYPE",
    createdAt: "2024-09-06T08:17:40.141Z",
    updatedAt: "2024-09-06T08:17:40.141Z",
  },
];

export async function fetchLiveEvents(page: number = 1): Promise<LiveEvent[]> {
  try {
    const token = process.env.LIVESALEAPP_TOKEN;

    if (!token) {
      throw new Error("LiveSaleApp token not configured");
    }

    const response = await fetch(
      `${LIVESALEAPP_BASE_URL}/live-event?page=${page}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        cache: "no-store", // Ensure fresh data
      }
    );

    if (!response.ok) {
      throw new Error(`LiveSaleApp API error: ${response.status}`);
    }

    const resp = await response.json();
    return resp?.results || [];
  } catch (error) {
    console.error("LiveSaleApp API error:", error);
    throw error;
  }
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
  const now = new Date();
  const startTime = new Date(event.startTime);
  const endTime = new Date(event.endTime);

  // Add 12-hour threshold to both start and end times
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
  const thresholdStartTime = new Date(startTime.getTime() - TWELVE_HOURS_MS);
  const thresholdEndTime = new Date(endTime.getTime() + TWELVE_HOURS_MS);

  return now >= thresholdStartTime && now <= thresholdEndTime;
}

interface JoinLiveSessionArgs {
  email: string;
  firstName: string;
  lastName: string;
}

export async function joinLiveSession(
  eventId: string,
  args: JoinLiveSessionArgs
) {
  try {
    const token = process.env.LIVESALEAPP_TOKEN;

    if (!token) {
      throw new Error("LiveSaleApp token not configured");
    }
    const { email, firstName, lastName } = args;

    // First, try to get existing zoom join url
    console.log(`Getting zoom join URL for event: ${eventId}, email: ${email}`);

    const getJoinUrlResponse = await fetch(
      `${LIVESALEAPP_BASE_URL}/live-event/${eventId}/get-zoom-join-url`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      }
    );

    const joinUrlData = await getJoinUrlResponse.json();

    if (getJoinUrlResponse.ok) {
      console.log("Got existing zoom join URL:", joinUrlData);

      if (joinUrlData.data?.joinUrl) {
        return {
          success: true,
          joinUrl: joinUrlData.data.joinUrl,
          message: "Successfully retrieved existing join URL",
        };
      }
    }

    // Check if the response indicates no join URL found
    if (joinUrlData.code === "ZOOM_JOIN_URL_NOT_FOUND") {
      console.log("No existing join URL found, creating new one...");

      // Call the zoom-join-by-email API to create a new join URL
      const createJoinResponse = await fetch(
        `${LIVESALEAPP_BASE_URL}/live-event/${eventId}/zoom-join-by-email`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            firstName: firstName || "",
            lastName: lastName || "",
          }),
        }
      );

      if (!createJoinResponse.ok) {
        throw new Error(
          `Failed to create zoom join URL: ${createJoinResponse.status}`
        );
      }

      const createJoinData = await createJoinResponse.json();
      console.log("Created new zoom join URL:", createJoinData);

      if (createJoinData.data?.joinUrl) {
        return {
          success: true,
          joinUrl: createJoinData.data.joinUrl,
          message: "Successfully created new join URL",
        };
      }
    }

    throw new Error("Failed to get or create zoom join URL");
  } catch (error) {
    console.error("Join session error:", error);
    throw error;
  }
}
