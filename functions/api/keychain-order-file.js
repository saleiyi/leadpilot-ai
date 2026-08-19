import { isAdmin, json, sha256Hex } from "../_keychain.js";

export async function onRequestGet({ request, env }) {
  if (!env.LEADS_DB || !env.ORDER_FILES) return json({ error: "Order storage is not configured." }, 503);
  const url = new URL(request.url), id = url.searchParams.get("id") || "", token = url.searchParams.get("token") || "";
  if (!id) return json({ error: "Order id is required." }, 400);
  const order = await env.LEADS_DB.prepare("SELECT reference, package_key, download_token_hash, download_expires_at FROM keychain_orders WHERE id = ?").bind(id).first();
  if (!order) return json({ error: "Order file not found." }, 404);
  const tokenActive = token && order.download_expires_at && Date.parse(order.download_expires_at) > Date.now();
  const authorized = isAdmin(request, env) || tokenActive && await sha256Hex(token) === order.download_token_hash;
  if (!authorized) return json({ error: "Unauthorized." }, 401);
  const object = await env.ORDER_FILES.get(order.package_key);
  if (!object) return json({ error: "Order file not found." }, 404);
  const headers = new Headers(); object.writeHttpMetadata(headers);
  headers.set("Content-Type", "application/zip");
  headers.set("Content-Disposition", `attachment; filename="${order.reference}-production-package.zip"`);
  headers.set("Cache-Control", "private, no-store"); headers.set("X-Content-Type-Options", "nosniff");
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
}

export function onRequest() { return json({ error: "Method not allowed." }, 405); }
