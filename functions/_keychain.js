export const ORDER_STATUSES = ["new", "contacted", "awaiting_payment", "paid", "in_production", "shipped", "cancelled"];
export const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;
export const GITHUB_PAGES_ORIGIN = "https://saleiyi.github.io";

export function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  const requestOrigin = new URL(request.url).origin;
  if (origin !== requestOrigin && origin !== GITHUB_PAGES_ORIGIN) return null;
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

export function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { ...headers, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export function isAdmin(request, env) {
  const expected = String(env.ADMIN_API_TOKEN || "");
  const supplied = request.headers.get("Authorization") || "";
  return expected.length >= 24 && supplied === `Bearer ${expected}`;
}

export async function ensureKeychainAnalyticsSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS keychain_events (
      id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_name TEXT NOT NULL,
      page_path TEXT NOT NULL DEFAULT '',
      referrer_host TEXT NOT NULL DEFAULT '',
      utm_source TEXT NOT NULL DEFAULT '',
      utm_medium TEXT NOT NULL DEFAULT '',
      utm_campaign TEXT NOT NULL DEFAULT '',
      utm_term TEXT NOT NULL DEFAULT '',
      utm_content TEXT NOT NULL DEFAULT '',
      device_type TEXT NOT NULL DEFAULT 'unknown',
      country_code TEXT NOT NULL DEFAULT '',
      order_reference TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}'
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_keychain_events_time ON keychain_events(occurred_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_keychain_events_funnel ON keychain_events(event_name, occurred_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_keychain_events_session ON keychain_events(session_id, occurred_at DESC)"),
  ]);
}

export function clean(value, max = 500) {
  const result = String(value || "").trim();
  if (result.length > max) throw httpError(`A field exceeds the ${max}-character limit.`);
  return result;
}

export function validateOrderMetadata(value) {
  if (!value || typeof value !== "object") throw httpError("Order metadata is required.");
  const customer = value.customer || {};
  const shipping = value.shipping || {};
  const items = Array.isArray(value.items) ? value.items : [];
  const name = clean(customer.name, 120);
  const email = clean(customer.email, 254).toLowerCase();
  if (!name) throw httpError("Customer name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError("A valid customer email is required.");
  if (!items.length || items.length > 20) throw httpError("One to twenty designs are required.");
  const quantity = Number(value.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw httpError("Quantity must be between 1 and 100.");
  const normalizedShipping = {
    country: clean(shipping.country, 100), address1: clean(shipping.address1, 200), address2: clean(shipping.address2, 200),
    city: clean(shipping.city, 120), region: clean(shipping.region, 120), postalCode: clean(shipping.postalCode, 40),
  };
  for (const field of ["country", "address1", "city", "region", "postalCode"]) {
    if (!normalizedShipping[field]) throw httpError("A complete shipping address is required.");
  }
  const normalizedItems = items.map(item => ({
    name: clean(item?.name, 200), service: clean(item?.service, 40), quantity: Math.max(1, Math.min(100, Number(item?.quantity) || 1)),
    shape: clean(item?.shape, 60), requestedLongSideCm: clean(item?.requestedLongSideCm, 20),
    finishedAcrylicWidthCm: clean(item?.finishedAcrylicWidthCm, 20), finishedAcrylicHeightCm: clean(item?.finishedAcrylicHeightCm, 20),
  }));
  const priceValue = Number.parseFloat(value.estimatedPriceUsd);
  const marketing = value.marketing || {};
  return {
    localReference: clean(value.localReference, 80),
    name, email, phone: clean(customer.phone, 60), shipping: normalizedShipping, items: normalizedItems, quantity,
    estimatedPriceUsd: Number.isFinite(priceValue) && priceValue >= 0 ? priceValue : null,
    notes: clean(value.notes, 3000), source: clean(value.source || "tiny-county-makers", 120),
    marketing: {
      utmSource: clean(marketing.utmSource, 200), utmMedium: clean(marketing.utmMedium, 200),
      utmCampaign: clean(marketing.utmCampaign, 200), utmTerm: clean(marketing.utmTerm, 200),
      utmContent: clean(marketing.utmContent, 200), referrer: clean(marketing.referrer, 500),
      analyticsSessionId: clean(marketing.analyticsSessionId, 100), deviceType: clean(marketing.deviceType, 20),
    },
  };
}

export function makeReference(date = new Date()) {
  const day = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `TCM-${day}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function sha256Hex(value) {
  const bytes = value instanceof ArrayBuffer ? value : new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function paymentUrlFromEnv(env, amount) {
  const handle = clean(env.PAYPAL_ME_HANDLE, 100).replace(/^@/, "");
  if (!handle || !Number.isFinite(amount)) return "";
  return `https://paypal.me/${encodeURIComponent(handle)}/${amount.toFixed(2)}USD`;
}

export async function sendEmail(env, { to, replyTo, subject, text }) {
  if (!env.RESEND_API_KEY) throw new Error("Resend is not configured.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.NOTIFY_FROM || "Tiny County Makers <onboarding@resend.dev>", to: [to], reply_to: replyTo || undefined, subject, text }),
  });
  if (!response.ok) throw new Error(`Resend returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
}

export function httpError(message, statusCode = 400) {
  const error = new Error(message); error.statusCode = statusCode; return error;
}

export function publicPackageUrl(request, id, token) {
  const url = new URL("/api/keychain-order-file", request.url);
  url.searchParams.set("id", id); url.searchParams.set("token", token); return url.toString();
}
