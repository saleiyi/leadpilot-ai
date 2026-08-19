export function onRequestGet() {
  return Response.json({
    ok: true,
    mode: "edge-demo",
    model: "cloudflare-rules",
    business: "LeadPilot AI",
    storage: "d1",
  });
}

export function onRequest() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
