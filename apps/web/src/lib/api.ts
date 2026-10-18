import { requestWithRateLimit } from './request';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

let token: string | null = null;
let restored = false;
export function setToken(t: string | null) {
  token = t;
  restored = true;
  try {
    if (t) localStorage.setItem('eb_token', t);
    else localStorage.removeItem('eb_token');
  } catch {
    /* storage unavailable: session stays in memory */
  }
}
export function loadToken(): string | null {
  restored = true;
  try {
    token = localStorage.getItem('eb_token');
  } catch {
    token = null;
  }
  return token;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  // child effects run before the session provider's effect: restore the stored token on first use
  if (!restored && typeof window !== 'undefined') loadToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let body: BodyInit | undefined = init.raw;
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await requestWithRateLimit(`${API_URL}${path}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.error ?? 'error', json?.message ?? res.statusText, json?.details);
  return json as T;
}

/** Authenticated binary download (download tokens are also bound to the session wallet). */
export async function downloadFile(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = `${API_URL}${url}`;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function previewUrl(path: string) {
  return `${API_URL}${path}`;
}
