const $ = selector => document.querySelector(selector);
const tokenKey = "tcm-admin-token";
const labels = { page_view: "访问网站", photo_uploaded: "上传图片", design_started: "进入设计", cart_added: "加入购物车", checkout_started: "开始结算", order_submitted: "提交订单" };
let adminToken = sessionStorage.getItem(tokenKey) || "";

async function api() {
  const response = await fetch(`/api/keychain-events?days=${$("#days").value}`, { headers: { Authorization: `Bearer ${adminToken}` } });
  const payload = await response.json();
  if (response.status === 401) throw new Error("Unauthorized");
  if (!response.ok) throw new Error(payload.error || "读取失败");
  return payload;
}
function metric(value, label, note = "") { const card = document.createElement("div"), strong = document.createElement("strong"), span = document.createElement("span"), small = document.createElement("small"); card.className = "metric"; strong.textContent = value; span.textContent = label; small.textContent = note; card.append(strong, span, small); return card; }
function rate(part, whole) { return whole ? `${(part / whole * 100).toFixed(1)}%` : "0%"; }
async function load() {
  $("#sync").textContent = "读取中…"; const data = await api(), f = data.funnel, visits = f.page_view || 0;
  $("#summary").replaceChildren(metric(visits, "匿名访问会话"), metric(f.photo_uploaded || 0, "上传图片", rate(f.photo_uploaded, visits)), metric(f.design_started || 0, "进入设计", rate(f.design_started, visits)), metric(f.cart_added || 0, "加入购物车", rate(f.cart_added, visits)), metric(f.order_submitted || 0, "提交订单", rate(f.order_submitted, visits)), metric(data.storedOrders || 0, "数据库订单"));
  renderFunnel(f); renderDaily(data.daily); renderRanks("#sources", data.sources, "source"); renderRanks("#countries", data.countries, "country"); renderRecent(data.recent); $("#sync").textContent = `更新于 ${new Date().toLocaleTimeString()}`;
}
function renderFunnel(funnel) {
  const root = $("#funnel"), maximum = Math.max(1, funnel.page_view || 0); root.replaceChildren();
  Object.keys(labels).forEach(name => { const row = document.createElement("div"), label = document.createElement("label"), track = document.createElement("div"), fill = document.createElement("div"), count = document.createElement("strong"); row.className = "funnel-row"; label.textContent = labels[name]; track.className = "funnel-track"; fill.className = "funnel-fill"; fill.style.width = `${Math.max(0, (funnel[name] || 0) / maximum * 100)}%`; count.textContent = funnel[name] || 0; track.append(fill); row.append(label, track, count); root.append(row); });
}
function renderDaily(rows) {
  const root = $("#daily"), totals = new Map(); rows.filter(row => row.event_name === "page_view").forEach(row => totals.set(row.day, Number(row.sessions))); root.replaceChildren();
  if (!totals.size) { root.append(empty("尚无每日访问数据")); return; } const maximum = Math.max(...totals.values(), 1);
  [...totals.entries()].slice(-14).forEach(([day, value]) => { const row = document.createElement("div"), date = document.createElement("span"), track = document.createElement("div"), fill = document.createElement("div"), count = document.createElement("strong"); row.className = "daily-row"; date.textContent = day.slice(5); track.className = "daily-track"; fill.className = "daily-fill"; fill.style.width = `${value / maximum * 100}%`; count.textContent = value; track.append(fill); row.append(date, track, count); root.append(row); });
}
function renderRanks(selector, rows, key) {
  const root = $(selector); root.replaceChildren(); if (!rows.length) { root.append(empty("尚无数据")); return; } const maximum = Math.max(...rows.map(row => Number(row.sessions)), 1);
  rows.forEach(item => { const row = document.createElement("div"), name = document.createElement("span"), track = document.createElement("div"), fill = document.createElement("div"), count = document.createElement("strong"); row.className = "rank-row"; name.textContent = item[key] || "Unknown"; track.className = "rank-track"; fill.className = "rank-fill"; fill.style.width = `${Number(item.sessions) / maximum * 100}%`; count.textContent = item.sessions; track.append(fill); row.append(name, track, count); root.append(row); });
}
function renderRecent(rows) {
  const body = $("#recent"); body.replaceChildren(); rows.slice(0, 50).forEach(item => { const tr = document.createElement("tr"); [new Date(item.occurred_at).toLocaleString(), labels[item.event_name] || item.event_name, item.utm_source || "direct", item.device_type || "unknown", item.country_code || "—", String(item.session_id).slice(0, 8)].forEach((value, index) => { const td = document.createElement("td"); if (index === 1) { const badge = document.createElement("span"); badge.className = "event-pill"; badge.textContent = value; td.append(badge); } else td.textContent = value; tr.append(td); }); body.append(tr); });
}
function empty(message) { const node = document.createElement("div"); node.className = "no-data"; node.textContent = message; return node; }
async function unlock(event) { event?.preventDefault(); adminToken = $("#token").value || adminToken; try { await load(); sessionStorage.setItem(tokenKey, adminToken); $("#login").hidden = true; $("#dashboard").hidden = false; $("#logout").hidden = false; $("#loginError").textContent = ""; } catch (error) { $("#loginError").textContent = error.message === "Unauthorized" ? "管理员令牌不正确" : error.message; } }
$("#loginForm").addEventListener("submit", unlock); $("#refresh").onclick = load; $("#days").onchange = load; $("#logout").onclick = () => { sessionStorage.removeItem(tokenKey); location.reload(); }; if (adminToken) { $("#token").value = adminToken; unlock(); }
