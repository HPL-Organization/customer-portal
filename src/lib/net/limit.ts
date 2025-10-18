//  in-tab concurrency limiter + 429 backoff for NetSuite-bound routes
let active = 0;
const waiters: Array<() => void> = [];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withLimit<T>(fn: () => Promise<T>, max = 1): Promise<T> {
  if (active >= max) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    const next = waiters.shift();
    if (next) next();
  }
}

/**
 * Wraps fetch so calls are serialized and 429s are retried with jittered backoff.
 * - maxConcurrent: how many requests at once (default 1)
 * - retries: how many retries on 429/503 (default 3)
 */
export async function fetchWithLimit(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: { maxConcurrent?: number; retries?: number }
): Promise<Response> {
  const maxConcurrent = opts?.maxConcurrent ?? 1;
  const retries = opts?.retries ?? 3;

  return withLimit<Response>(async () => {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await fetch(input, init);
      if (res.status !== 429 && res.status !== 503) return res;

      if (attempt >= retries) return res;
      attempt++;

      const retryAfter = Number(res.headers.get("retry-after")) || 0;
      const base =
        retryAfter > 0 ? retryAfter * 1000 : 300 * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * 200);
      await sleep(base + jitter);
    }
  }, maxConcurrent);
}
