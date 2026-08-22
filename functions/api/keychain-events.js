import { corsHeaders, ensureKeychainAnalyticsSchema, isAdmin, json } from "../_keychain.js";

const EVENTS = ["page_view", "photo_uploaded", "design_started", "cart_added", "checkout_started", "order_submitted"];

export function onRequestOptions({ request }) {
  const headers = corsHeaders(request);
  if (!headers) return json({ error: "Origin not allowed." }, 403);
  return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Max-Age": "86400" } });
}

export async function onRequestPost({ request, env }) {
  const headers = corsHeaders(request);
  if (!headers) return json({ error: "Origin not allowed." }, 403);
  if (!env.LEADS_DB) return json({ error: "Analytics storage is not configured." }, 503, headers);
  try {
    await ensureKeychainAnalyticsSchema(env.LEADS_DB);
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 8192) return json({ error: "Event payload is too large." }, 413, headers);
    const input = await request.json();
    const eventName = text(input.event, 40), sessionId = text(input.sessionId, 100);
    if (!EVENTS.includes(eventName)) return json({ error: "Unknown analytics event." }, 400, headers);
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(sessionId)) return json({ error: "Invalid analytics session." }, 400, headers);
    const attribution = input.attribution || {};
    await env.LEADS_DB.prepare(
      `INSERT INTO keychain_events
       (id, occurred_at, session_id, event_name, page_path, referrer_host, utm_source, utm_medium,
        utm_campaign, utm_term, utm_content, device_type, country_code, order_reference, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`
    ).bind(
      crypto.randomUUID(), new Date().toISOString(), sessionId, eventName, text(input.pagePath || "/", 240),
      text(attribution.referrerHost, 200), text(attribution.utmSource, 200), text(attribution.utmMedium, 200),
      text(attribution.utmCampaign, 200), text(attribution.utmTerm, 200), text(attribution.utmContent, 200),
      device(input.deviceType), text(request.cf?.country, 2), JSON.stringify(safeMetadata(input.metadata)),
    ).run();
    return json({ ok: true }, 202, headers);
  } catch (error) {
    console.error("Keychain analytics event failed", error);
    return json({ error: "The analytics event could not be recorded." }, 400, headers);
  }
}

export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.LEADS_DB) return json({ error: "Analytics storage is not configured." }, 503);
  await ensureKeychainAnalyticsSchema(env.LEADS_DB);
  const requested = Number(new URL(request.url).searchParams.get("days") || 30);
  const days = [7, 30, 90].includes(requested) ? requested : 30;
  const period = `-${days} days`;
  const statements = [
    env.LEADS_DB.prepare("SELECT event_name, COUNT(*) AS events, COUNT(DISTINCT session_id) AS sessions FROM keychain_events WHERE julianday(occurred_at) >= julianday('now', ?) GROUP BY event_name").bind(period),
    env.LEADS_DB.prepare("SELECT substr(occurred_at, 1, 10) AS day, event_name, COUNT(DISTINCT session_id) AS sessions FROM keychain_events WHERE julianday(occurred_at) >= julianday('now', ?) GROUP BY day, event_name ORDER BY day").bind(period),
    env.LEADS_DB.prepare("SELECT CASE WHEN utm_source <> '' THEN utm_source WHEN referrer_host <> '' THEN referrer_host ELSE 'direct' END AS source, COUNT(DISTINCT session_id) AS sessions FROM keychain_events WHERE event_name = 'page_view' AND julianday(occurred_at) >= julianday('now', ?) GROUP BY source ORDER BY sessions DESC LIMIT 12").bind(period),
    env.LEADS_DB.prepare("SELECT CASE WHEN country_code = '' THEN 'Unknown' ELSE country_code END AS country, COUNT(DISTINCT session_id) AS sessions FROM keychain_events WHERE event_name = 'page_view' AND julianday(occurred_at) >= julianday('now', ?) GROUP BY country ORDER BY sessions DESC LIMIT 12").bind(period),
    env.LEADS_DB.prepare("SELECT occurred_at, session_id, event_name, page_path, utm_source, utm_medium, utm_campaign, device_type, country_code, order_reference FROM keychain_events WHERE julianday(occurred_at) >= julianday('now', ?) ORDER BY occurred_at DESC LIMIT 100").bind(period),
    env.LEADS_DB.prepare("SELECT COUNT(*) AS orders FROM keychain_orders WHERE julianday(created_at) >= julianday('now', ?)").bind(period),
  ];
  const [totals, daily, sources, countries, recent, orders] = await env.LEADS_DB.batch(statements);
  const totalMap = Object.fromEntries(EVENTS.map(name => [name, 0]));
  totals.results.forEach(row => { totalMap[row.event_name] = Number(row.sessions || 0); });
  return json({ ok: true, days, funnel: totalMap, daily: daily.results, sources: sources.results, countries: countries.results, recent: recent.results, storedOrders: Number(orders.results[0]?.orders || 0) });
}

export async function onRequestDelete({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.LEADS_DB) return json({ error: "Analytics storage is not configured." }, 503);
  const sessionId = text(new URL(request.url).searchParams.get("sessionId"), 100);
  if (!/^qa_[a-zA-Z0-9_-]{8,97}$/.test(sessionId)) return json({ error: "Only an exact qa_ test session can be deleted." }, 400);
  await ensureKeychainAnalyticsSchema(env.LEADS_DB);
  const result = await env.LEADS_DB.prepare("DELETE FROM keychain_events WHERE session_id = ?").bind(sessionId).run();
  return json({ ok: true, deleted: Number(result.meta?.changes || 0) });
}

export function onRequest() { return json({ error: "Method not allowed." }, 405); }

function text(value, max) { return String(value || "").trim().slice(0, max); }
function device(value) { return ["mobile", "tablet", "desktop"].includes(value) ? value : "unknown"; }
function safeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  Object.entries(value).slice(0, 12).forEach(([key, item]) => {
    const safeKey = text(key, 40).replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safeKey) return;
    if (typeof item === "number" && Number.isFinite(item)) result[safeKey] = item;
    else if (typeof item === "boolean") result[safeKey] = item;
    else if (typeof item === "string") result[safeKey] = text(item, 100);
  });
  return result;
}
