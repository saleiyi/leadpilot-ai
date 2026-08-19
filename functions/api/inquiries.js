const GITHUB_PAGES_ORIGIN = "https://saleiyi.github.io";

export function onRequestOptions({ request }) {
  const headers = corsHeaders(request);
  if (!headers) return Response.json({ error: "Origin not allowed." }, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      ...headers,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function onRequestPost({ request, env, waitUntil }) {
  const headers = corsHeaders(request);
  if (!headers) return json({ error: "Origin not allowed." }, 403);
  if (!env.LEADS_DB) return json({ error: "Inquiry storage is not configured." }, 503, headers);

  try {
    const input = await request.json();

    // Honeypot fields are silently accepted so bots cannot tune around them.
    if (String(input.website_url || "").trim()) {
      return json({ ok: true, saved: false }, 202, headers);
    }

    const inquiry = validateInquiry(input);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const notificationStatus = env.RESEND_API_KEY && env.NOTIFY_EMAIL ? "queued" : "not_configured";

    await env.LEADS_DB.prepare(
      `INSERT INTO inquiries
       (id, created_at, name, email, company, service, budget, timeline, message, source, status, notification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
    ).bind(
      id,
      createdAt,
      inquiry.name,
      inquiry.email,
      inquiry.company,
      inquiry.service,
      inquiry.budget,
      inquiry.timeline,
      inquiry.message,
      inquiry.source,
      notificationStatus,
    ).run();

    if (notificationStatus === "queued") {
      waitUntil(sendNotification(env, { id, createdAt, ...inquiry }));
    }

    return json({
      ok: true,
      saved: true,
      reference: id.slice(0, 8).toUpperCase(),
      notification: notificationStatus,
    }, 201, headers);
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error("Inquiry submission failed", error);
    return json(
      { error: status >= 500 ? "We could not save your inquiry. Please try again." : error.message },
      status,
      headers,
    );
  }
}

export function onRequest() {
  return Response.json({ error: "Method not allowed." }, { status: 405 });
}

function validateInquiry(input) {
  if (!input || typeof input !== "object") badRequest("Please submit a valid inquiry.");
  const clean = {};
  const limits = {
    name: 120,
    email: 254,
    company: 160,
    service: 120,
    budget: 80,
    timeline: 80,
    message: 5000,
    source: 120,
  };

  for (const [field, limit] of Object.entries(limits)) {
    clean[field] = String(input[field] || "").trim();
    if (clean[field].length > limit) badRequest(`${field} is too long.`);
  }

  if (!clean.name) badRequest("Name is required.");
  if (!clean.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) badRequest("A valid email is required.");
  if (!clean.service) badRequest("Please choose a service.");
  if (clean.message.length < 20) badRequest("Please share at least 20 characters about your workflow.");
  if (![true, "true", "on", "yes", "1"].includes(input.consent)) badRequest("Please accept the privacy notice.");
  if (!clean.source) clean.source = "website";
  return clean;
}

async function sendNotification(env, inquiry) {
  let status = "failed";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.NOTIFY_FROM || "LeadPilot AI <onboarding@resend.dev>",
        to: [env.NOTIFY_EMAIL],
        reply_to: inquiry.email,
        subject: `New LeadPilot inquiry: ${inquiry.service} — ${inquiry.name}`,
        text: [
          `Reference: ${inquiry.id.slice(0, 8).toUpperCase()}`,
          `Received: ${inquiry.createdAt}`,
          `Name: ${inquiry.name}`,
          `Email: ${inquiry.email}`,
          `Company: ${inquiry.company || "Not provided"}`,
          `Service: ${inquiry.service}`,
          `Budget: ${inquiry.budget || "Not provided"}`,
          `Timeline: ${inquiry.timeline || "Not provided"}`,
          "",
          inquiry.message,
        ].join("\n"),
      }),
    });
    if (!response.ok) throw new Error(`Resend returned ${response.status}`);
    status = "sent";
  } catch (error) {
    console.error("Inquiry notification failed", error);
  }

  await env.LEADS_DB.prepare(
    "UPDATE inquiries SET notification_status = ? WHERE id = ?",
  ).bind(status, inquiry.id).run();
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  const requestOrigin = new URL(request.url).origin;
  if (origin !== requestOrigin && origin !== GITHUB_PAGES_ORIGIN) return null;
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      ...headers,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}
