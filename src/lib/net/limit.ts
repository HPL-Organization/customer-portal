// src/lib/net/limit.ts
// Cross-tab aware limiter + coalescing + robust 429/503

type Key = string;
function toKey(input: RequestInfo | URL, init?: RequestInit): Key {
  const u =
    typeof input === "string"
      ? input
      : (input as URL)?.toString
      ? (input as URL).toString()
      : String(input);
  const m = (init?.method ?? "GET").toUpperCase();
  const b = typeof init?.body === "string" ? init.body : "";
  return `${m} ${u} :: ${b}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const CHANNEL = "ns-fetch-gate-v1";
const bc =
  typeof window !== "undefined" && "BroadcastChannel" in window
    ? new BroadcastChannel(CHANNEL)
    : null;

let localLocked = false;
let waitingResolvers: Array<() => void> = [];
let warnedMaxConcurrent = false;

function notifyRelease() {
  if (bc) bc.postMessage({ type: "release" });
  const next = waitingResolvers.shift();
  if (next) next();
}

bc?.addEventListener?.("message", (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg?.type === "release") {
    const next = waitingResolvers.shift();
    if (next) next();
  }
});

async function acquireGate() {
  if (!localLocked) {
    localLocked = true;
    return () => {
      localLocked = false;
      notifyRelease();
    };
  }
  await new Promise<void>((resolve) => waitingResolvers.push(resolve));
  localLocked = true;
  return () => {
    localLocked = false;
    notifyRelease();
  };
}

const inflight = new Map<Key, Promise<Response>>();

function parseRetryAfterSeconds(res: Response): number | null {
  const ra = res.headers.get("retry-after");
  if (!ra) return null;
  const n = Number(ra);
  if (!Number.isNaN(n) && n >= 0) return n;
  return null;
}

function jitter(ms: number) {
  const delta = Math.floor(ms * 0.15);
  return ms + Math.floor(Math.random() * (2 * delta + 1)) - delta;
}

export async function fetchWithLimit(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: {
    retries?: number;
    maxWaitMs?: number;
    baseMs?: number;
    coalesce?: boolean;
    maxConcurrent?: number;
  }
): Promise<Response> {
  const retries = opts?.retries ?? 4;
  const maxWaitMs = opts?.maxWaitMs ?? 6000;
  const baseMs = opts?.baseMs ?? 300;
  const coalesce = opts?.coalesce ?? true;

  if (
    process.env.NODE_ENV !== "production" &&
    typeof opts?.maxConcurrent === "number" &&
    opts.maxConcurrent > 1 &&
    !warnedMaxConcurrent
  ) {
    warnedMaxConcurrent = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[fetchWithLimit] maxConcurrent > 1 is ignored; requests are serialized cross-tab."
    );
  }

  const key = coalesce ? toKey(input, init) : `${Math.random()}`;

  if (coalesce && inflight.has(key)) {
    return inflight.get(key)!;
  }

  const exec = (async () => {
    const release = await acquireGate();
    try {
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await fetch(input as any, init as any);

        if (res.status !== 429 && res.status !== 503) {
          return res;
        }

        if (attempt >= retries) {
          return res;
        }
        attempt++;

        const ra = parseRetryAfterSeconds(res);
        if (ra != null) {
          await sleep(jitter(Math.min(ra * 1000, maxWaitMs)));
          continue;
        }

        const wait = Math.min(baseMs * 2 ** (attempt - 1), maxWaitMs);
        await sleep(jitter(wait));
      }
    } finally {
      release();
    }
  })();

  if (coalesce) {
    inflight.set(key, exec);
    try {
      const r = await exec;
      return r;
    } finally {
      inflight.delete(key);
    }
  } else {
    return exec;
  }
}
