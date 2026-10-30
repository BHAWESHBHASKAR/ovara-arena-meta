// Direct PayPal sandbox REST, used only by the API itself: the seed step and
// the "OVARA off" comparison run. The agent never sees this token; in the
// normal run the MCP server gets a placeholder and OVARA's proxy injects the
// real one.
import { config } from './config.js';

let cached: { token: string; until: number } | undefined;

export function paypalConfigured(): boolean {
  return !!(config.paypalClientId && config.paypalClientSecret) || !!process.env.PAYPAL_ACCESS_TOKEN;
}

export async function paypalToken(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  if (config.paypalClientId && config.paypalClientSecret) {
    const res = await fetch(`${config.paypalApi}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`PayPal token: HTTP ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: j.access_token, until: Date.now() + (j.expires_in - 300) * 1000 };
    return j.access_token;
  }
  const env = process.env.PAYPAL_ACCESS_TOKEN;
  if (env && !env.startsWith('placeholder')) return env;
  throw new Error('no PayPal credentials: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET');
}

export class PayPalError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`PayPal ${status}: ${JSON.stringify(body).slice(0, 400)}`);
  }
}

export async function paypal<T = Record<string, unknown>>(method: string, path: string, body?: unknown, requestId?: string): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await paypalToken()}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  if (requestId) headers['PayPal-Request-Id'] = requestId;
  const res = await fetch(config.paypalApi + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* keep text */
  }
  if (!res.ok) throw new PayPalError(res.status, data);
  return data as T;
}
