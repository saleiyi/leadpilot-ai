import {
  MAX_PACKAGE_BYTES, ORDER_STATUSES, corsHeaders, ensureKeychainAnalyticsSchema, httpError, isAdmin, json, makeReference,
  paymentUrlFromEnv, publicPackageUrl, sendEmail, sha256Hex, validateOrderMetadata,
} from "../_keychain.js";

export function onRequestOptions({ request }) {
  const headers = corsHeaders(request);
  if (!headers) return json({ error: "Origin not allowed." }, 403);
  return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS", "Access-Control-Max-Age": "86400" } });
}

export async function onRequestPost({ request, env, waitUntil }) {
  const headers = corsHeaders(request);
  if (!headers) return json({ error: "Origin not allowed." }, 403);
  if (!env.LEADS_DB || !env.ORDER_FILES) return json({ error: "Order storage is not configured." }, 503, headers);
  let key = "";
  try {
    const form = await request.formData();
    const metadata = validateOrderMetadata(JSON.parse(String(form.get("metadata") || "null")));
    const file = form.get("package");
    if (!(file instanceof File) || !file.size) throw httpError("The production ZIP is required.");
    if (file.size > MAX_PACKAGE_BYTES) throw httpError("The production ZIP exceeds the 25 MB limit.", 413);
    const bytes = await file.arrayBuffer();
    const signature = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
    if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw httpError("The production package is not a valid ZIP file.");

    const id = crypto.randomUUID(), reference = makeReference(), createdAt = new Date().toISOString();
    const downloadExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    const [packageHash, tokenHash] = await Promise.all([sha256Hex(bytes), sha256Hex(token)]);
    key = `orders/${createdAt.slice(0, 10)}/${id}/production-package.zip`;
    const paymentUrl = paymentUrlFromEnv(env, metadata.estimatedPriceUsd);
    const workshopStatus = env.RESEND_API_KEY && env.NOTIFY_EMAIL ? "queued" : "not_configured";
    const customerStatus = env.RESEND_API_KEY && env.CUSTOMER_FROM ? "queued" : "not_configured";

    await env.ORDER_FILES.put(key, bytes, {
      httpMetadata: { contentType: "application/zip", contentDisposition: `attachment; filename="${reference}-production-package.zip"` },
      customMetadata: { reference, customerEmail: metadata.email, sha256: packageHash },
    });
    await env.LEADS_DB.prepare(
      `INSERT INTO keychain_orders
       (id, reference, created_at, updated_at, status, name, email, phone, shipping_json, items_json, quantity,
        estimated_price_usd, notes, source, utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer,
        package_key, package_size, package_sha256, download_token_hash, download_expires_at, payment_url,
        workshop_notification_status, customer_notification_status)
       VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, reference, createdAt, createdAt, metadata.name, metadata.email, metadata.phone,
      JSON.stringify(metadata.shipping), JSON.stringify(metadata.items), metadata.quantity, metadata.estimatedPriceUsd,
      metadata.notes, metadata.source, metadata.marketing.utmSource, metadata.marketing.utmMedium,
      metadata.marketing.utmCampaign, metadata.marketing.utmTerm, metadata.marketing.utmContent, metadata.marketing.referrer,
      key, file.size, packageHash, tokenHash, downloadExpiresAt, paymentUrl, workshopStatus, customerStatus,
    ).run();

    if (/^[a-zA-Z0-9_-]{16,100}$/.test(metadata.marketing.analyticsSessionId)) {
      try {
        await ensureKeychainAnalyticsSchema(env.LEADS_DB);
        await env.LEADS_DB.prepare(
          `INSERT INTO keychain_events
           (id, occurred_at, session_id, event_name, page_path, referrer_host, utm_source, utm_medium,
            utm_campaign, utm_term, utm_content, device_type, country_code, order_reference, metadata_json)
           VALUES (?, ?, ?, 'order_submitted', '/', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(), createdAt, metadata.marketing.analyticsSessionId,
          referrerHost(metadata.marketing.referrer), metadata.marketing.utmSource, metadata.marketing.utmMedium,
          metadata.marketing.utmCampaign, metadata.marketing.utmTerm, metadata.marketing.utmContent,
          metadata.marketing.deviceType, String(request.cf?.country || "").slice(0, 2), reference,
          JSON.stringify({ quantity: metadata.quantity, estimatedPriceUsd: metadata.estimatedPriceUsd }),
        ).run();
      } catch (error) {
        console.error("Order analytics event failed", error);
      }
    }

    const packageUrl = publicPackageUrl(request, id, token);
    if (workshopStatus === "queued" || customerStatus === "queued") {
      waitUntil(sendOrderEmails(env, { id, reference, createdAt, packageUrl, paymentUrl, ...metadata }, workshopStatus, customerStatus));
    }
    return json({ ok: true, reference, status: "new", quantity: metadata.quantity, estimatedPrice: metadata.estimatedPriceUsd === null ? "custom quote" : `$${metadata.estimatedPriceUsd.toFixed(2)}`, packageUrl, paymentUrl, workshopNotification: workshopStatus, customerNotification: customerStatus }, 201, headers);
  } catch (error) {
    if (key && env.ORDER_FILES) await env.ORDER_FILES.delete(key).catch(() => {});
    const status = error.statusCode || 500;
    if (status >= 500) console.error("Keychain order submission failed", error);
    return json({ error: status >= 500 ? "We could not save the order. Please try again." : error.message }, status, headers);
  }
}

export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.LEADS_DB) return json({ error: "Order storage is not configured." }, 503);
  const url = new URL(request.url), status = url.searchParams.get("status") || "";
  if (status && !ORDER_STATUSES.includes(status)) return json({ error: "Unknown order status." }, 400);
  const where = status ? "WHERE status = ?" : "";
  const statement = env.LEADS_DB.prepare(
    `SELECT id, reference, created_at, updated_at, status, name, email, phone, shipping_json, items_json,
            quantity, estimated_price_usd, notes, source, utm_source, utm_medium, utm_campaign, utm_term,
            utm_content, referrer, package_size, package_sha256, payment_url, tracking_number, status_note,
            workshop_notification_status, customer_notification_status, last_customer_email_at, download_expires_at
       FROM keychain_orders ${where} ORDER BY created_at DESC LIMIT 200`
  );
  const response = status ? await statement.bind(status).all() : await statement.all();
  return json({ ok: true, orders: response.results.map(serializeOrder), statuses: ORDER_STATUSES });
}

export async function onRequestPatch({ request, env, waitUntil }) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.LEADS_DB) return json({ error: "Order storage is not configured." }, 503);
  try {
    const input = await request.json(), id = String(input.id || "").trim();
    if (!id) throw httpError("Order id is required.");
    const current = await env.LEADS_DB.prepare("SELECT * FROM keychain_orders WHERE id = ?").bind(id).first();
    if (!current) throw httpError("Order not found.", 404);
    const status = input.status === undefined ? current.status : String(input.status);
    if (!ORDER_STATUSES.includes(status)) throw httpError("Unknown order status.");
    const paymentUrl = input.paymentUrl === undefined ? current.payment_url : validatePaymentUrl(input.paymentUrl);
    const trackingNumber = input.trackingNumber === undefined ? current.tracking_number : String(input.trackingNumber || "").trim().slice(0, 200);
    const statusNote = input.statusNote === undefined ? current.status_note : String(input.statusNote || "").trim().slice(0, 1000);
    const updatedAt = new Date().toISOString();
    await env.LEADS_DB.prepare(
      "UPDATE keychain_orders SET status = ?, payment_url = ?, tracking_number = ?, status_note = ?, updated_at = ? WHERE id = ?"
    ).bind(status, paymentUrl, trackingNumber, statusNote, updatedAt, id).run();
    const shouldEmail = Boolean(env.RESEND_API_KEY && env.CUSTOMER_FROM) && ((paymentUrl && paymentUrl !== current.payment_url) || status === "shipped" && current.status !== "shipped");
    if (shouldEmail) waitUntil(sendStatusEmail(env, { ...current, status, payment_url: paymentUrl, tracking_number: trackingNumber, status_note: statusNote }).then(() => env.LEADS_DB.prepare("UPDATE keychain_orders SET customer_notification_status = 'sent', last_customer_email_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run()).catch(async error => { console.error("Customer status email failed", error); await env.LEADS_DB.prepare("UPDATE keychain_orders SET customer_notification_status = 'failed' WHERE id = ?").bind(id).run(); }));
    const saved = await env.LEADS_DB.prepare("SELECT * FROM keychain_orders WHERE id = ?").bind(id).first();
    return json({ ok: true, order: serializeOrder(saved), customerEmail: shouldEmail ? "queued" : "not_sent" });
  } catch (error) {
    return json({ error: error.message }, error.statusCode || 500);
  }
}

export function onRequest() { return json({ error: "Method not allowed." }, 405); }

function serializeOrder(row) {
  return { ...row, shipping: JSON.parse(row.shipping_json || "{}"), items: JSON.parse(row.items_json || "[]"), shipping_json: undefined, items_json: undefined };
}

function validatePaymentUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try { url = new URL(raw); } catch { throw httpError("Enter a valid PayPal URL."); }
  if (url.protocol !== "https:" || !(url.hostname === "paypal.me" || url.hostname.endsWith(".paypal.com") || url.hostname === "paypal.com")) throw httpError("Only secure paypal.com or paypal.me links are accepted.");
  return url.toString();
}

async function sendOrderEmails(env, order, workshopStatus, customerStatus) {
  const tasks = [];
  if (workshopStatus === "queued") tasks.push(sendEmail(env, {
    to: env.NOTIFY_EMAIL, replyTo: order.email,
    subject: `New keychain order ${order.reference} — ${order.name}`,
    text: [
      `Reference: ${order.reference}`, `Received: ${order.createdAt}`, `Status: New / needs contact`,
      `Customer: ${order.name}`, `Email: ${order.email}`, `Phone: ${order.phone || "Not provided"}`,
      `Quantity: ${order.quantity}`, `Estimated price: ${order.estimatedPriceUsd === null ? "Custom quote" : `$${order.estimatedPriceUsd.toFixed(2)}`}`,
      `Ship to: ${Object.values(order.shipping).filter(Boolean).join(", ")}`,
      `Items: ${order.items.map((item, index) => `${index + 1}. ${item.name} × ${item.quantity} (${item.shape || item.service})`).join(" | ")}`,
      `Notes: ${order.notes || "None"}`, `Source: ${order.source}; UTM: ${order.marketing.utmSource || "direct"} / ${order.marketing.utmMedium || "none"} / ${order.marketing.utmCampaign || "none"}`,
      "", `Download private production ZIP: ${order.packageUrl}`, order.paymentUrl ? `PayPal link prepared: ${order.paymentUrl}` : "PayPal link: add one in the order dashboard after review.",
    ].join("\n"),
  }).then(() => updateEmailStatus(env, order.id, "workshop_notification_status", "sent")).catch(error => failEmail(env, order.id, "workshop_notification_status", error)));
  if (customerStatus === "queued") tasks.push(sendEmail(env, {
    to: order.email, replyTo: env.NOTIFY_EMAIL,
    subject: `We received your keychain request ${order.reference}`,
    text: [
      `Hi ${order.name},`, "", `We received your request for ${order.quantity} custom keychain${order.quantity === 1 ? "" : "s"}.`,
      `Reference: ${order.reference}`, `Estimated item price: ${order.estimatedPriceUsd === null ? "We will send a custom quote" : `$${order.estimatedPriceUsd.toFixed(2)}`}`,
      "Your production files were uploaded successfully. Nothing will be produced or charged until the workshop reviews the artwork, confirms shipping, and you approve the proof.",
      order.paymentUrl ? `Optional PayPal payment link: ${order.paymentUrl}` : "We will send payment instructions after review.",
      "", "Tiny County Makers",
    ].join("\n"),
  }).then(() => updateEmailStatus(env, order.id, "customer_notification_status", "sent", true)).catch(error => failEmail(env, order.id, "customer_notification_status", error)));
  await Promise.allSettled(tasks);
}

async function sendStatusEmail(env, order) {
  const lines = [`Hi ${order.name},`, "", `Update for keychain order ${order.reference}: ${order.status.replaceAll("_", " ")}.`];
  if (order.payment_url) lines.push(`PayPal payment link: ${order.payment_url}`);
  if (order.tracking_number) lines.push(`Tracking number: ${order.tracking_number}`);
  if (order.status_note) lines.push(`Workshop note: ${order.status_note}`);
  lines.push("", "Tiny County Makers");
  await sendEmail(env, { to: order.email, replyTo: env.NOTIFY_EMAIL, subject: `Keychain order update ${order.reference}`, text: lines.join("\n") });
}

async function updateEmailStatus(env, id, column, status, timestamp = false) {
  const sql = timestamp ? `UPDATE keychain_orders SET ${column} = ?, last_customer_email_at = ? WHERE id = ?` : `UPDATE keychain_orders SET ${column} = ? WHERE id = ?`;
  const values = timestamp ? [status, new Date().toISOString(), id] : [status, id];
  await env.LEADS_DB.prepare(sql).bind(...values).run();
}

async function failEmail(env, id, column, error) {
  console.error(`${column} failed`, error);
  await updateEmailStatus(env, id, column, "failed");
}

function referrerHost(value) {
  try { return new URL(value).hostname.slice(0, 200); } catch { return ""; }
}
