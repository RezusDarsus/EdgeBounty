/** Retry only a rate-limit rejection, before the API handler has processed the request. */
export async function requestWithRateLimit(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init);
    if (response.status !== 429 || attempt >= 3) return response;
    const value = response.headers.get('retry-after');
    const seconds = value && /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
    const wait = Number.isFinite(seconds) ? seconds * 1000 : value && Number.isFinite(Date.parse(value)) ? Date.parse(value) - Date.now() : 60_000;
    await new Promise((resolve) => setTimeout(resolve, Math.max(1000, Math.min(wait, 60_000))));
  }
}
