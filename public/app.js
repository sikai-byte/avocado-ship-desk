const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = { rows: [], settings: null, status: null, view: "board", filter: null, downloaded: false };

/** "Choquette Avocado Box (late September)" -> "Choquette Avocado Box" */
const productKey = (name) => name.replace(/\s*\(.*?\)\s*/g, " ").trim();
const plural = (n, s) => `${n} ${s}${n === 1 ? "" : "s"}`;

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json", ...(opts.headers || {}) }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function notice(msg, isError = false) {
  const el = $("#notice");
  el.hidden = !msg;
  el.textContent = msg || "";
  el.classList.toggle("error", isError);
}

// ---------- navigation ----------
$$("nav button").forEach((b) =>
  b.addEventListener("click", () => {
    state.view = b.dataset.view;
    $$("nav button").forEach((x) => x.classList.toggle("active", x === b));
    $$(".view").forEach((v) => (v.hidden = v.id !== `view-${state.view}`));
    if (state.view === "picklist") loadPickList();
    if (state.view === "history") loadHistory();
    if (state.view === "settings") renderSettings();
  }),
);

// ---------- status ----------
async function loadStatus() {
  state.status = await api("/api/status");
  const s = state.status;
  const days = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  $("#status").innerHTML =
    `<span class="pill ${s.source === "wix" ? "on" : "off"}">Store: ${s.source === "wix" ? "Wix" : "sample data"}</span>` +
    `<span class="pill ${s.shippoEnabled ? "on" : "off"}">Shippo: ${s.shippoEnabled ? "connected" : "off"}</span>` +
    `<span class="pill ${s.shipDay ? "on" : ""}">${s.shipDay ? "Ship day" : "Ship days: " + s.shipDays.map((d) => days[d]).join("/")}</span>`;
  $("#ship-all").hidden = !s.shippoEnabled;
  $("#merged-pdf").hidden = !s.shippoEnabled;
}

// ---------- board ----------
async function loadOrders(refresh = false) {
  if (refresh) {
    $("#refresh").disabled = true;
    $("#refresh").textContent = "Refreshing…";
  }
  if (!state.rows.length) $("#orders tbody").innerHTML = `<tr><td colspan="8" class="help">Loading orders…</td></tr>`;
  try {
    const data = await api(`/api/orders${refresh ? "?refresh=1" : ""}`);
    state.rows = data.rows;
    state.settings = data.settings;
    renderBoard();
  } catch (e) {
    notice(`Could not load orders: ${e.message}`, true);
  } finally {
    $("#refresh").disabled = false;
    $("#refresh").textContent = "Refresh from Wix";
  }
}

function visibleRows() {
  if (!state.filter) return state.rows;
  return state.rows.filter((r) => r.order.items.some((i) => productKey(i.name) === state.filter));
}

function renderChips() {
  const counts = new Map();
  for (const r of state.rows) {
    if (r.label) continue;
    for (const k of new Set(r.order.items.map((i) => productKey(i.name)))) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const chips = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (state.filter && !counts.has(state.filter)) state.filter = null;
  $("#product-chips").innerHTML =
    `<button class="chip ${state.filter ? "" : "on"}" data-key="">All open orders <b>${state.rows.filter((r) => !r.label).length}</b></button>` +
    chips.map(([k, n]) => `<button class="chip ${state.filter === k ? "on" : ""}" data-key="${esc(k)}">${esc(k)} <b>${n}</b></button>`).join("");
  $$("#product-chips .chip").forEach((c) =>
    c.addEventListener("click", () => {
      state.filter = c.dataset.key || null;
      renderBoard();
    }),
  );
  const shownIds = new Set(visibleRows().map((r) => r.order.id));
  const others = state.rows.filter((r) => !r.label && !r.hold && !shownIds.has(r.order.id)).length;
  const ho = $("#hold-others");
  ho.hidden = !state.filter || others === 0;
  ho.textContent = `Ship only these — hold the other ${others}`;
}

function boxName(id) { return state.settings.boxes.find((b) => b.id === id)?.name ?? id; }
function serviceName(id) { return state.settings.services.find((s) => s.id === id)?.name ?? id; }

function renderBoard() {
  renderChips();
  const rows = visibleRows();
  const ready = state.rows.filter((r) => !r.hold && !r.label);
  const held = state.rows.filter((r) => r.hold && !r.label);
  const flagged = ready.filter((r) => r.assignment.warnings.some((w) => /Incomplete|Missing|Unknown|International/.test(w)));
  const shown = state.filter ? `<b>${rows.length}</b> shown · ` : "";
  $("#summary").innerHTML =
    `${shown}<b>${ready.length}</b> will be in the CSV · <b>${held.length}</b> held` +
    (flagged.length ? ` · <span class="warn"><b>${flagged.length}</b> need attention</span>` : "");
  $("#release-all").hidden = held.length === 0;
  $("#ship-all").textContent = `Buy ${plural(ready.length, "label")} via Shippo instead`;
  const csv = $("#csv");
  csv.textContent = `Download Pirate Ship CSV · ${plural(ready.length, "order")}`;
  csv.classList.toggle("disabled", ready.length === 0);
  csv.setAttribute("aria-disabled", String(ready.length === 0));
  $("#step-2").classList.toggle("done", state.downloaded);
  $("#step-2 .num").textContent = state.downloaded ? "✓" : "2";
  $("#step-3").classList.toggle("active", state.downloaded);

  const boxOpts = (sel) => state.settings.boxes.map((b) => `<option value="${esc(b.id)}" ${b.id === sel ? "selected" : ""}>${esc(b.name)}</option>`).join("");
  const svcOpts = (sel) => state.settings.services.map((s) => `<option value="${esc(s.id)}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");

  $("#orders tbody").innerHTML = rows
    .map((r) => {
      const o = r.order;
      const a = r.assignment;
      const rule = state.settings.rules.find((x) => x.id === a.ruleId);
      const flags = a.warnings
        .map((w) => `<span class="flag ${/Incomplete|Missing|Unknown|International/.test(w) ? "bad" : ""}">${esc(w)}</span>`)
        .join("");
      const why = a.manual ? "set by hand" : rule ? `rule: ${rule.name}` : "default (no rule matched)";
      const shipped = r.label
        ? `<span class="flag info">${esc(r.label.carrier.toUpperCase())} ${esc(r.label.trackingNumber)}</span>`
        : "";
      return `<tr class="${r.hold ? "held" : ""} ${r.label ? "shipped" : ""}" data-id="${esc(o.id)}">
        <td><b>#${esc(o.number)}</b><span class="sub">${new Date(o.createdAt).toLocaleDateString()} · ${esc(o.channel)}</span>${shipped}</td>
        <td>${esc(o.shipTo.name)}${o.shipTo.company ? `<span class="sub">${esc(o.shipTo.company)}</span>` : ""}
            <span class="sub">${esc(o.shipTo.street1)} ${esc(o.shipTo.street2 || "")}</span>
            <span class="sub">${esc(o.shipTo.city)}, ${esc(o.shipTo.state)} ${esc(o.shipTo.zip)} ${o.shipTo.country !== "US" ? esc(o.shipTo.country) : ""}</span>
            ${o.buyerNote ? `<span class="sub">📝 ${esc(o.buyerNote)}</span>` : ""}</td>
        <td>${o.items.map((i) => `<div>${i.quantity} × ${esc(i.name)}${i.sku ? ` <span class="sub mono inline">${esc(i.sku)}</span>` : ""}</div>`).join("")}
            ${o.shippingOption && !/^standard$/i.test(o.shippingOption) ? `<span class="sub">Customer chose: ${esc(o.shippingOption)}</span>` : ""}</td>
        <td><select class="box ${a.manual ? "manual" : ""}" ${r.label ? "disabled" : ""} title="${esc(why)}">${boxOpts(a.boxId)}</select></td>
        <td><select class="service ${a.manual ? "manual" : ""}" ${r.label ? "disabled" : ""} title="${esc(why)}">${svcOpts(a.serviceId)}</select>
            <span class="sub why" title="${esc(why)}">${esc(why)}${a.manual ? ` · <a href="#" class="reset">undo</a>` : ""}</span></td>
        <td>${a.packageWeightLb.toFixed(1)}</td>
        <td>${flags}${a.note ? `<span class="flag info">${esc(a.note)}</span>` : ""}</td>
        <td class="row-actions">
          ${r.label
            ? r.label.labelUrl ? `<a class="btn small" href="${esc(r.label.labelUrl)}" target="_blank">Label</a>` : ""
            : `<button class="hold ${r.hold ? "release" : ""}">${r.hold ? "Release" : "Hold"}</button>
               ${state.status?.shippoEnabled ? `<button class="small buy">Buy label</button>` : ""}`}
        </td>
      </tr>`;
    })
    .join("");

  $$("#orders tbody tr").forEach((tr) => {
    const id = tr.dataset.id;
    $(".box", tr)?.addEventListener("change", (e) => override(id, { boxId: e.target.value }));
    $(".service", tr)?.addEventListener("change", (e) => override(id, { serviceId: e.target.value }));
    $(".hold", tr)?.addEventListener("click", () => {
      const row = state.rows.find((r) => r.order.id === id);
      override(id, { hold: !row.hold });
    });
    $(".reset", tr)?.addEventListener("click", async (e) => {
      e.preventDefault();
      await api(`/api/orders/${id}/override`, { method: "DELETE" });
      loadOrders();
    });
    $(".buy", tr)?.addEventListener("click", () => buyLabels([id]));
  });
}

async function override(id, patch) {
  const row = state.rows.find((r) => r.order.id === id);
  if (row && patch.hold !== undefined) row.hold = patch.hold; // optimistic
  if (row && patch.boxId) row.assignment.boxId = patch.boxId;
  if (row && patch.serviceId) row.assignment.serviceId = patch.serviceId;
  renderBoard();
  try {
    await api(`/api/orders/${id}/override`, { method: "POST", body: JSON.stringify(patch) });
  } catch (e) {
    notice(`Change not saved: ${e.message}`, true);
  }
  loadOrders();
}

async function bulkHold(ids, hold) {
  if (!ids.length) return;
  for (const r of state.rows) if (ids.includes(r.order.id)) r.hold = hold;
  renderBoard();
  try {
    await api("/api/orders/hold", { method: "POST", body: JSON.stringify({ orderIds: ids, hold }) });
    notice(hold ? `${plural(ids.length, "order")} held — they stay out of the CSV until you release them.` : `${plural(ids.length, "order")} released.`);
  } catch (e) {
    notice(`Change not saved: ${e.message}`, true);
  }
  loadOrders();
}

$("#hold-others").addEventListener("click", () => {
  const shown = new Set(visibleRows().map((r) => r.order.id));
  bulkHold(state.rows.filter((r) => !r.label && !r.hold && !shown.has(r.order.id)).map((r) => r.order.id), true);
});
$("#release-all").addEventListener("click", () => bulkHold(state.rows.filter((r) => r.hold && !r.label).map((r) => r.order.id), false));
$("#csv").addEventListener("click", (e) => {
  if ($("#csv").classList.contains("disabled")) return e.preventDefault();
  state.downloaded = true;
  notice("CSV downloaded. In Pirate Ship: Ship → Upload a spreadsheet → drop the file → Buy. Then Reports → Shipments → export, and import it in step 3.");
  renderBoard();
});

async function buyLabels(orderIds) {
  const n = orderIds ? orderIds.length : state.rows.filter((r) => !r.hold && !r.label).length;
  if (!n) return notice("Nothing to ship.");
  if (!confirm(`Buy ${n} label${n === 1 ? "" : "s"} now? Postage will be charged to the Shippo account.`)) return;
  notice("Buying labels…");
  try {
    const res = await api("/api/labels/purchase", { method: "POST", body: JSON.stringify({ orderIds }) });
    let msg = `Bought ${res.purchased} label${res.purchased === 1 ? "" : "s"} for $${res.totalCostUsd.toFixed(2)}.`;
    if (res.errors.length) msg += `\n${res.errors.length} problem(s):\n` + res.errors.map((e) => `  #${e.orderNumber}: ${e.error}`).join("\n");
    notice(msg, res.errors.length > 0 && res.purchased === 0);
    if (res.purchased) {
      const ids = res.records.map((r) => r.orderId).join(",");
      window.open(`/api/labels/merged.pdf?ids=${encodeURIComponent(ids)}`, "_blank");
    }
    loadOrders(true);
  } catch (e) {
    notice(e.message, true);
  }
}

$("#refresh").addEventListener("click", () => loadOrders(true));
$("#ship-all").addEventListener("click", () => buyLabels(undefined));
$("#import-btn").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const csv = await file.text();
  notice("Importing tracking…");
  try {
    const res = await api("/api/import/tracking", { method: "POST", headers: { "Content-Type": "text/csv" }, body: csv });
    let msg = res.imported
      ? `Done — ${plural(res.synced, "Wix order")} marked shipped with tracking; Wix is emailing those customers now.`
      : "No matching orders found in that file. Make sure it's the Pirate Ship shipments report (Reports → Shipments).";
    if (res.imported && res.synced < res.imported) msg += `\n${res.imported - res.synced} tracking number(s) saved but not yet on Wix — retry the import to sync them.`;
    if (res.errors.length) msg += "\n" + res.errors.map((x) => `  #${x.orderNumber}: ${x.error}`).join("\n");
    notice(msg, res.imported === 0);
    state.downloaded = false;
    loadOrders(true);
  } catch (err) {
    notice(err.message, true);
  }
  e.target.value = "";
});

// ---------- pick list ----------
async function loadPickList() {
  const p = await api("/api/picklist");
  $("#picklist").innerHTML = `
    <div class="picks">
      <div>
        <div class="card"><h3>Pull from cold storage</h3>
          <table><tbody>${p.skuTotals.map((s) => `<tr><td class="mono">${esc(s.sku)}</td><td>${esc(s.name)}</td><td><b>${s.quantity}</b></td></tr>`).join("")}</tbody></table>
        </div>
        <div class="card"><h3>Boxes needed</h3>
          <table><tbody>${p.boxTotals.map((b) => `<tr><td>${esc(b.box)}</td><td><b>${b.count}</b></td></tr>`).join("")}</tbody></table>
        </div>
      </div>
      <div>
        ${p.orders
          .map(
            (o) => `<div class="pick-order">
            <h4>#${esc(o.orderNumber)} — ${esc(o.name)} <span class="sub">${esc(o.destination)}</span></h4>
            <div><b>${esc(o.box)}</b> · ${esc(o.service)}</div>
            <ul>${o.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
            ${o.note ? `<div class="flag info">${esc(o.note)}</div>` : ""}
            ${o.buyerNote ? `<div class="flag">📝 ${esc(o.buyerNote)}</div>` : ""}
            ${o.warnings.map((w) => `<span class="flag">${esc(w)}</span>`).join("")}
          </div>`,
          )
          .join("") || "<p class='help'>No orders ready to ship.</p>"}
      </div>
    </div>`;
}

// ---------- history ----------
async function loadHistory() {
  const labels = await api("/api/labels");
  $("#history tbody").innerHTML =
    labels
      .map(
        (l) => `<tr>
      <td><b>#${esc(l.orderNumber)}</b></td>
      <td>${esc(l.carrier.toUpperCase())}</td>
      <td>${esc(l.service)}</td>
      <td class="mono">${esc(l.trackingNumber)}</td>
      <td>${l.costUsd != null ? "$" + l.costUsd.toFixed(2) : ""}</td>
      <td>${new Date(l.purchasedAt).toLocaleString()}</td>
      <td>${l.syncedToStore ? '<span class="flag info">synced</span>' : '<span class="flag">not synced</span>'}</td>
      <td>${l.labelUrl ? `<a class="btn small" href="${esc(l.labelUrl)}" target="_blank">PDF</a>` : ""}</td>
    </tr>`,
      )
      .join("") || `<tr><td colspan="8" class="help">Nothing shipped yet.</td></tr>`;
}

// ---------- settings ----------
function settingsNotice(msg, isError = false) {
  const el = $("#settings-notice");
  el.hidden = !msg;
  el.textContent = msg || "";
  el.classList.toggle("error", isError);
}

function markDirty(dirty) {
  $("#settings-dirty").hidden = !dirty;
}

function renderSettings(keepDraft = false) {
  const s = keepDraft && state.draft ? state.draft : JSON.parse(JSON.stringify(state.settings));
  state.draft = s;
  const el = $("#settings");
  const shippo = Boolean(state.status?.shippoEnabled);
  const boxOpts = (sel) => s.boxes.map((b) => `<option value="${esc(b.id)}" ${b.id === sel ? "selected" : ""}>${esc(b.name)}</option>`).join("");
  const svcOpts = (sel) => s.services.map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  const field = (label, path, type = "text", extra = "") => `<label>${label}<input type="${type}" data-path="${path}" value="${esc(get(s, path))}" ${extra} /></label>`;
  const opt = (label, path, val, extra = "") => `<label>${label}<input type="number" data-path="${path}" data-opt value="${val ?? ""}" ${extra} /></label>`;
  const hasMore = (w) => Boolean((w.skus && w.skus.length) || (w.states && w.states.length) || w.shippingOptionContains || w.minQty != null || w.maxQty != null || w.minWeightLb != null || w.maxWeightLb != null);

  el.innerHTML = `
    <div class="card"><h3>Rules</h3>
      <p class="help">Checked top to bottom; the first rule that matches an order decides its box, service and shipping weight. Orders that match nothing use the defaults below.</p>
      ${s.rules.map((r, i) => `<div class="rule">
        <div class="rule-main">
          <span class="num">${i + 1}</span>
          <label class="grow">Rule name<input data-path="rules.${i}.name" value="${esc(r.name)}" /></label>
          <label class="grow">When product name contains<input data-path="rules.${i}.when.productContains" data-opt value="${esc(r.when.productContains || "")}" placeholder="e.g. Choquette" /></label>
          <label>Channel<select data-path="rules.${i}.when.channel"><option value="">any</option><option ${r.when.channel === "retail" ? "selected" : ""}>retail</option><option ${r.when.channel === "wholesale" ? "selected" : ""}>wholesale</option></select></label>
          <span class="arrow">→</span>
          <label>Box<select data-path="rules.${i}.boxId">${boxOpts(r.boxId)}</select></label>
          <label>Service<select data-path="rules.${i}.serviceId">${svcOpts(r.serviceId)}</select></label>
          ${opt("Ship weight (lb)", `rules.${i}.packageWeightLb`, r.packageWeightLb, 'step="0.1" min="0" placeholder="auto"')}
          <div class="row-actions">
            <button class="small" data-move="-1" data-i="${i}" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
            <button class="small" data-move="1" data-i="${i}" title="Move down" ${i === s.rules.length - 1 ? "disabled" : ""}>↓</button>
            <button class="small danger" data-del="rules" data-i="${i}" title="Delete rule">Delete</button>
          </div>
        </div>
        <details ${hasMore(r.when) || r.note ? "open" : ""}><summary>More conditions &amp; pick-list note</summary>
          <div class="grid">
            <label>SKUs (all of)<input data-path="rules.${i}.when.skus" data-list value="${esc((r.when.skus || []).join(", "))}" placeholder="AVO-12, GIFT" /></label>
            <label>Ship-to states<input data-path="rules.${i}.when.states" data-list value="${esc((r.when.states || []).join(", "))}" placeholder="CA, AZ" /></label>
            <label>Customer's shipping choice contains<input data-path="rules.${i}.when.shippingOptionContains" data-opt value="${esc(r.when.shippingOptionContains || "")}" placeholder="Express" /></label>
            ${opt("Min items", `rules.${i}.when.minQty`, r.when.minQty)}${opt("Max items", `rules.${i}.when.maxQty`, r.when.maxQty)}
            ${opt("Min item weight (lb)", `rules.${i}.when.minWeightLb`, r.when.minWeightLb, 'step="0.1"')}${opt("Max item weight (lb)", `rules.${i}.when.maxWeightLb`, r.when.maxWeightLb, 'step="0.1"')}
            <label>Pick-list note<input data-path="rules.${i}.note" data-opt value="${esc(r.note || "")}" placeholder="e.g. add ice pack" /></label>
          </div>
        </details>
      </div>`).join("")}
      <button data-add="rules">+ Add rule</button>
    </div>

    <div class="card"><h3>Defaults</h3>
      <p class="help">Used when no rule matches.</p>
      <div class="grid">
        <label>Default box<select data-path="defaultBoxId">${boxOpts(s.defaultBoxId)}</select></label>
        <label>Default service<select data-path="defaultServiceId">${svcOpts(s.defaultServiceId)}</select></label>
        <label>Hot-weather states (flagged)<input data-path="hotStates" data-list value="${esc(s.hotStates.join(", "))}" /></label>
        <label>Ship days (1=Mon … 7=Sun)<input data-path="shipDays" data-list-num value="${s.shipDays.join(", ")}" /></label>
        ${field("Wholesale SKU prefix", "wholesaleSkuPrefix", "text", 'placeholder="WS-"')}
      </div>
    </div>

    <div class="card"><h3>Boxes</h3>
      <div class="grid head-row"><span>Name</span><span>Length (in)</span><span>Width (in)</span><span>Height (in)</span><span>Empty weight (lb)</span><span></span></div>
      ${s.boxes.map((b, i) => `<div class="grid" data-i="${i}">
        <input data-path="boxes.${i}.name" value="${esc(b.name)}" aria-label="Box name" />
        <input type="number" data-path="boxes.${i}.lengthIn" value="${b.lengthIn}" aria-label="Length" />
        <input type="number" data-path="boxes.${i}.widthIn" value="${b.widthIn}" aria-label="Width" />
        <input type="number" data-path="boxes.${i}.heightIn" value="${b.heightIn}" aria-label="Height" />
        <input type="number" step="0.1" data-path="boxes.${i}.tareLb" value="${b.tareLb}" aria-label="Empty weight" />
        <button class="small danger" data-del="boxes" data-i="${i}">Remove</button>
      </div>`).join("")}
      <button data-add="boxes">+ Add box</button>
    </div>

    <div class="card"><h3>Shipping services</h3>
      <p class="help">The Pirate Ship name must match a service in Pirate Ship's spreadsheet import exactly.</p>
      <div class="grid head-row"><span>Name</span><span>Carrier</span><span>Pirate Ship name</span>${shippo ? "<span>Shippo token</span>" : ""}<span></span></div>
      ${s.services.map((x, i) => `<div class="grid">
        <input data-path="services.${i}.name" value="${esc(x.name)}" aria-label="Service name" />
        <select data-path="services.${i}.carrier" aria-label="Carrier">${["usps", "ups", "fedex"].map((c) => `<option ${c === x.carrier ? "selected" : ""}>${c}</option>`).join("")}</select>
        <input data-path="services.${i}.pirateShipName" value="${esc(x.pirateShipName || "")}" aria-label="Pirate Ship name" />
        ${shippo ? `<input data-path="services.${i}.shippoToken" value="${esc(x.shippoToken || "")}" aria-label="Shippo token" />` : ""}
        <button class="small danger" data-del="services" data-i="${i}">Remove</button>
      </div>`).join("")}
      <button data-add="services">+ Add service</button>
    </div>

    <div class="card"><h3>Ship from</h3>
      <p class="help">Printed as the return address on labels.</p>
      <div class="grid">
      ${field("Name", "shipFrom.name")}${field("Street", "shipFrom.street1")}${field("City", "shipFrom.city")}
      ${field("State", "shipFrom.state")}${field("ZIP", "shipFrom.zip")}${field("Phone", "shipFrom.phone")}${field("Email", "shipFrom.email")}
    </div></div>`;

  $$("[data-path]", el).forEach((inp) =>
    inp.addEventListener("input", () => {
      let v = inp.value;
      if (inp.hasAttribute("data-list")) v = v.split(",").map((x) => x.trim()).filter(Boolean);
      else if (inp.hasAttribute("data-list-num")) v = v.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n));
      else if (inp.type === "number") v = v === "" ? undefined : Number(v);
      else if (inp.hasAttribute("data-opt") || inp.tagName === "SELECT") v = v === "" ? undefined : v;
      set(state.draft, inp.dataset.path, v);
      markDirty(true);
    }),
  );
  const rerender = () => { markDirty(true); renderSettings(true); };
  $$("[data-del]", el).forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.del, item = state.draft[k][+b.dataset.i];
    if (k !== "rules" && !confirm(`Remove "${item.name}"? Rules that use it will fall back to the default.`)) return;
    state.draft[k].splice(+b.dataset.i, 1); rerender();
  }));
  $$("[data-move]", el).forEach((b) => b.addEventListener("click", () => {
    const i = +b.dataset.i, j = i + +b.dataset.move, r = state.draft.rules;
    if (j < 0 || j >= r.length) return;
    [r[i], r[j]] = [r[j], r[i]];
    rerender();
  }));
  $$("[data-add]", el).forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.add, id = `${k.slice(0, -1)}-${Date.now().toString(36)}`;
    if (k === "boxes") state.draft.boxes.push({ id, name: "New box", lengthIn: 10, widthIn: 8, heightIn: 6, tareLb: 0.5 });
    if (k === "services") state.draft.services.push({ id, name: "New service", carrier: "usps", shippoToken: "", pirateShipName: "" });
    if (k === "rules") state.draft.rules.push({ id, name: "New rule", when: {}, boxId: state.draft.defaultBoxId, serviceId: state.draft.defaultServiceId });
    rerender();
    const added = $$(`[data-path^="${k}."]`, el).pop();
    added?.scrollIntoView({ block: "center" });
  }));
}

function get(o, p) { return p.split(".").reduce((a, k) => (a == null ? a : a[k]), o) ?? ""; }
function set(o, p, v) {
  const ks = p.split(".");
  const last = ks.pop();
  const t = ks.reduce((a, k) => (a[k] ??= {}), o);
  if (v === undefined) delete t[last]; else t[last] = v;
}

async function saveSettings() {
  const btns = [$("#settings-save"), $("#settings-save-2")];
  btns.forEach((b) => { b.disabled = true; b.textContent = "Saving…"; });
  try {
    const saved = await api("/api/settings", { method: "PUT", body: JSON.stringify(state.draft) });
    state.settings = saved;
    markDirty(false);
    settingsNotice("Saved. Open orders have been re-assigned with these rules.");
    loadOrders();
    renderSettings();
  } catch (e) {
    settingsNotice(`Not saved — ${e.message}. Your edits are still here; fix and save again.`, true);
  } finally {
    btns.forEach((b) => { b.disabled = false; });
    $("#settings-save").textContent = "Save";
    $("#settings-save-2").textContent = "Save changes";
  }
}
$("#settings-save").addEventListener("click", saveSettings);
$("#settings-save-2").addEventListener("click", saveSettings);
window.addEventListener("beforeunload", (e) => { if (!$("#settings-dirty").hidden) e.preventDefault(); });

// ---------- boot ----------
(async () => {
  await loadStatus();
  await loadOrders();
})();
