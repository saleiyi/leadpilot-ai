const $ = selector => document.querySelector(selector);
const tokenKey = "tcm-admin-token";
let adminToken = sessionStorage.getItem(tokenKey) || "";
let statuses = [];

function authHeaders(json = false) { return { Authorization: `Bearer ${adminToken}`, ...(json ? { "Content-Type": "application/json" } : {}) }; }
function escapeText(value) { return String(value ?? ""); }
function dt(label, value) { const fragment = document.createDocumentFragment(), term = document.createElement("dt"), detail = document.createElement("dd"); term.textContent = label; detail.textContent = value || "Not provided"; fragment.append(term, detail); return fragment; }
function formatAddress(value) { return [value.address1, value.address2, value.city, value.region, value.postalCode, value.country].filter(Boolean).join(", "); }
function prettyStatus(value) { return String(value).replaceAll("_", " "); }

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json();
  if (response.status === 401) throw new Error("Unauthorized");
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

async function loadOrders() {
  $("#sync").textContent = "Loading…";
  const filter = $("#filter").value, payload = await api(`/api/keychain-orders${filter ? `?status=${encodeURIComponent(filter)}` : ""}`);
  statuses = payload.statuses;
  if ($("#filter").options.length === 1) statuses.forEach(status => $("#filter").add(new Option(prettyStatus(status), status)));
  renderSummary(payload.orders); renderOrders(payload.orders);
  $("#sync").textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

function renderSummary(orders) {
  const groups = ["new", "awaiting_payment", "paid", "in_production", "shipped"];
  $("#summary").replaceChildren(...groups.map(status => { const card = document.createElement("div"); card.className = "metric"; const count = document.createElement("strong"), label = document.createElement("span"); count.textContent = orders.filter(order => order.status === status).length; label.textContent = prettyStatus(status); card.append(count, label); return card; }));
}

function renderOrders(orders) {
  const container = $("#orders"); container.replaceChildren();
  if (!orders.length) { const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "No orders match this filter."; container.append(empty); return; }
  orders.forEach(order => {
    const card = $("#orderTemplate").content.firstElementChild.cloneNode(true);
    card.dataset.id = order.id; card.querySelector(".reference").textContent = order.reference;
    card.querySelector(".date").textContent = new Date(order.created_at).toLocaleString();
    card.querySelector(".status-pill").textContent = prettyStatus(order.status);
    const customer = card.querySelector(".customer"); customer.append(dt("Customer", order.name), dt("Email", order.email), dt("Phone", order.phone));
    const delivery = card.querySelector(".delivery"); delivery.append(dt("Ship to", formatAddress(order.shipping)), dt("Tracking", order.tracking_number));
    const commercial = card.querySelector(".commercial"); commercial.append(dt("Quantity", order.quantity), dt("Estimate", order.estimated_price_usd == null ? "Custom quote" : `$${Number(order.estimated_price_usd).toFixed(2)}`), dt("File", `${(order.package_size / 1048576).toFixed(2)} MB`));
    const itemLines = order.items.map((item, i) => `${i + 1}. ${item.name} × ${item.quantity} · ${item.shape || item.service}`).join("\n");
    card.querySelector(".details-body").textContent = `${itemLines}\n\nNotes: ${order.notes || "None"}\nSource: ${order.source}\nUTM: ${order.utm_source || "direct"} / ${order.utm_medium || "none"} / ${order.utm_campaign || "none"}\nReferrer: ${order.referrer || "None"}\nNotifications: workshop ${order.workshop_notification_status}; customer ${order.customer_notification_status}`;
    const select = card.querySelector(".status-input"); statuses.forEach(status => select.add(new Option(prettyStatus(status), status))); select.value = order.status;
    card.querySelector(".payment-input").value = order.payment_url || ""; card.querySelector(".tracking-input").value = order.tracking_number || ""; card.querySelector(".note-input").value = order.status_note || "";
    card.querySelector(".save").onclick = () => saveOrder(card, order.id); card.querySelector(".download").onclick = () => downloadPackage(order.id, order.reference);
    container.append(card);
  });
}

async function saveOrder(card, id) {
  const button = card.querySelector(".save"), result = card.querySelector(".save-result"); button.disabled = true; result.textContent = "Saving…";
  try {
    const payload = await api("/api/keychain-orders", { method: "PATCH", body: JSON.stringify({ id, status: card.querySelector(".status-input").value, paymentUrl: card.querySelector(".payment-input").value, trackingNumber: card.querySelector(".tracking-input").value, statusNote: card.querySelector(".note-input").value }) });
    result.textContent = payload.customerEmail === "queued" ? "Saved · customer email queued" : "Saved"; card.querySelector(".status-pill").textContent = prettyStatus(payload.order.status);
  } catch (error) { result.textContent = error.message; result.classList.add("error"); } finally { button.disabled = false; }
}

async function downloadPackage(id, reference) {
  const response = await fetch(`/api/keychain-order-file?id=${encodeURIComponent(id)}`, { headers: authHeaders() });
  if (!response.ok) throw new Error("Could not download the package");
  const blob = await response.blob(), link = document.createElement("a"), url = URL.createObjectURL(blob); link.href = url; link.download = `${reference}-production-package.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function unlock(event) {
  event?.preventDefault(); adminToken = $("#token").value || adminToken;
  try { await loadOrders(); sessionStorage.setItem(tokenKey, adminToken); $("#login").hidden = true; $("#dashboard").hidden = false; $("#logout").hidden = false; $("#loginError").textContent = ""; }
  catch (error) { $("#loginError").textContent = error.message === "Unauthorized" ? "The admin token is incorrect." : error.message; }
}

$("#loginForm").addEventListener("submit", unlock); $("#refresh").onclick = loadOrders; $("#filter").onchange = loadOrders;
$("#logout").onclick = () => { sessionStorage.removeItem(tokenKey); location.reload(); };
if (adminToken) { $("#token").value = adminToken; unlock(); }
