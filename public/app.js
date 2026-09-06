const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = { rows: [], settings: null, status: null, view: "board" };

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
}

// ---------- board ----------
async function loadOrders(refresh = false) {
  try {
    const data = await api(`/api/orders${refresh ? "?refresh=1" : ""}`);
    state.rows = data.rows;
    state.settings = data.settings;
    renderBoard();
  } catch (e) {
    notice(`Could not load orders: ${e.message}`, true);
  }
}

function boxName(id) { return state.settings.boxes.find((b) => b.id === id)?.name ?? id; }
function serviceName(id) { return state.settings.services.find((s) => s.id === id)?.name ?? id; }

function renderBoard() {
  const ready = state.rows.filter((r) => !r.hold && !r.label);
  const held = state.rows.filter((r) => r.hold && !r.label);
  const flagged = ready.filter((r) => r.assignment.warnings.length);
  const weight = ready.reduce((s, r) => s + r.assignment.packageWeightLb, 0);
  $("#summary").innerHTML =
    `<b>${ready.length}</b> ready to ship · <b>${held.length}</b> held · <b>${flagged.length}</b> flagged · ${weight.toFixed(1)} lb total`;
  $("#ship-all").textContent = `Buy ${ready.length} label${ready.length === 1 ? "" : "s"} via Shippo`;
  $("#csv").textContent = `1. Download Pirate Ship CSV (${ready.length})`;

  const boxOpts = (sel) => state.settings.boxes.map((b) => `<option value="${esc(b.id)}" ${b.id === sel ? "selected" : ""}>${esc(b.name)}</option>`).join("");
  const svcOpts = (sel) => state.settings.services.map((s) => `<option value="${esc(s.id)}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");

  $("#orders tbody").innerHTML = state.rows
    .map((r) => {
      const o = r.order;
      const a = r.assignment;
      const rule = state.settings.rules.find((x) => x.id === a.ruleId);
      const flags = a.warnings
        .map((w) => `<span class="flag ${/Incomplete|Missing|Unknown|International/.test(w) ? "bad" : ""}">${esc(w)}</span>`)
        .join("");
      const ruleTag = a.manual
        ? `<span class="flag info">manual</span>`
        : rule
          ? `<span class="flag info" title="${esc(rule.name)}">rule</span>`
          : "";
      const shipped = r.label
        ? `<span class="flag info">${esc(r.label.carrier.toUpperCase())} ${esc(r.label.trackingNumber)}</span>`
        : "";
      return `<tr class="${r.hold ? "held" : ""} ${r.label ? "shipped" : ""}" data-id="${esc(o.id)}">
        <td><b>#${esc(o.number)}</b><span class="sub">${new Date(o.createdAt).toLocaleDateString()} · ${esc(o.channel)}</span>${shipped}</td>
        <td>${esc(o.shipTo.name)}${o.shipTo.company ? `<span class="sub">${esc(o.shipTo.company)}</span>` : ""}
            <span class="sub">${esc(o.shipTo.street1)} ${esc(o.shipTo.street2 || "")}</span>
            <span class="sub">${esc(o.shipTo.city)}, ${esc(o.shipTo.state)} ${esc(o.shipTo.zip)} ${o.shipTo.country !== "US" ? esc(o.shipTo.country) : ""}</span>
            ${o.buyerNote ? `<span class="sub">📝 ${esc(o.buyerNote)}</span>` : ""}</td>
        <td>${o.items.map((i) => `${i.quantity} × ${esc(i.name)} <span class="sub mono">${esc(i.sku)}</span>`).join("")}
            ${o.shippingOption ? `<span class="sub">Chose: ${esc(o.shippingOption)}</span>` : ""}</td>
        <td>${a.packageWeightLb.toFixed(2)}<span class="sub">items ${o.totalWeightLb.toFixed(2)}</span></td>
        <td><select class="box ${a.manual ? "manual" : ""}" ${r.label ? "disabled" : ""}>${boxOpts(a.boxId)}</select></td>
        <td><select class="service ${a.manual ? "manual" : ""}" ${r.label ? "disabled" : ""}>${svcOpts(a.serviceId)}</select>${ruleTag}</td>
        <td>${flags}${a.note ? `<span class="flag info">${esc(a.note)}</span>` : ""}</td>
        <td class="row-actions">
          ${r.label
            ? r.label.labelUrl ? `<a class="btn small" href="${esc(r.label.labelUrl)}" target="_blank">Label</a>` : ""
            : `<button class="small hold">${r.hold ? "Release" : "Hold"}</button>
               ${a.manual ? `<button class="small reset" title="Back to rule result">Reset</button>` : ""}
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
    $(".reset", tr)?.addEventListener("click", async () => {
      await api(`/api/orders/${id}/override`, { method: "DELETE" });
      loadOrders();
    });
    $(".buy", tr)?.addEventListener("click", () => buyLabels([id]));
  });
}

async function override(id, patch) {
  await api(`/api/orders/${id}/override`, { method: "POST", body: JSON.stringify(patch) });
  loadOrders();
}

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
    let msg = `Imported ${res.imported} tracking number${res.imported === 1 ? "" : "s"}; ${res.synced} marked shipped in the store.`;
    if (res.errors.length) msg += "\n" + res.errors.map((x) => `  #${x.orderNumber}: ${x.error}`).join("\n");
    notice(msg, res.imported === 0);
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
function renderSettings() {
  const s = JSON.parse(JSON.stringify(state.settings));
  state.draft = s;
  const el = $("#settings");
  const boxOpts = (sel) => s.boxes.map((b) => `<option value="${esc(b.id)}" ${b.id === sel ? "selected" : ""}>${esc(b.name)}</option>`).join("");
  const svcOpts = (sel) => s.services.map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  const field = (label, path, type = "text") => `<label>${label}<input type="${type}" data-path="${path}" value="${esc(get(s, path))}" /></label>`;

  el.innerHTML = `
    <div class="card"><h3>Ship from</h3><div class="grid">
      ${field("Name", "shipFrom.name")}${field("Street", "shipFrom.street1")}${field("City", "shipFrom.city")}
      ${field("State", "shipFrom.state")}${field("ZIP", "shipFrom.zip")}${field("Phone", "shipFrom.phone")}${field("Email", "shipFrom.email")}
    </div></div>

    <div class="card"><h3>Boxes</h3>
      <div id="boxes">${s.boxes.map((b, i) => `<div class="grid" data-i="${i}">
        ${field("ID", `boxes.${i}.id`)}${field("Name", `boxes.${i}.name`)}${field("L (in)", `boxes.${i}.lengthIn`, "number")}
        ${field("W (in)", `boxes.${i}.widthIn`, "number")}${field("H (in)", `boxes.${i}.heightIn`, "number")}${field("Empty wt (lb)", `boxes.${i}.tareLb`, "number")}
        <label>&nbsp;<button class="small" data-del="boxes" data-i="${i}">Remove</button></label>
      </div>`).join("")}</div>
      <button class="small" data-add="boxes">Add box</button>
    </div>

    <div class="card"><h3>Shipping services</h3>
      ${s.services.map((x, i) => `<div class="grid">
        ${field("ID", `services.${i}.id`)}${field("Name", `services.${i}.name`)}
        <label>Carrier<select data-path="services.${i}.carrier">${["usps", "ups", "fedex"].map((c) => `<option ${c === x.carrier ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        ${field("Shippo token", `services.${i}.shippoToken`)}${field("Pirate Ship name", `services.${i}.pirateShipName`)}
        <label>&nbsp;<button class="small" data-del="services" data-i="${i}">Remove</button></label>
      </div>`).join("")}
      <button class="small" data-add="services">Add service</button>
    </div>

    <div class="card"><h3>Rules (first match wins)</h3>
      <div class="rule-row cond"><span></span><span>Name</span><span>Conditions</span><span>Box</span><span>Service</span><span>Pick-list note</span><span></span></div>
      ${s.rules.map((r, i) => `<div class="rule-row">
        <span class="mono">${i + 1}</span>
        <input class="name" data-path="rules.${i}.name" value="${esc(r.name)}" />
        <div class="grid" style="grid-template-columns:repeat(4,1fr)">
          <label>Product name contains<input data-path="rules.${i}.when.productContains" value="${esc(r.when.productContains || "")}" /></label>
          <label>SKUs (all of)<input data-path="rules.${i}.when.skus" data-list value="${esc((r.when.skus || []).join(", "))}" /></label>
          <label>States<input data-path="rules.${i}.when.states" data-list value="${esc((r.when.states || []).join(", "))}" /></label>
          <label>Channel<select data-path="rules.${i}.when.channel"><option value="">any</option><option ${r.when.channel === "retail" ? "selected" : ""}>retail</option><option ${r.when.channel === "wholesale" ? "selected" : ""}>wholesale</option></select></label>
          <label>Ship option contains<input data-path="rules.${i}.when.shippingOptionContains" value="${esc(r.when.shippingOptionContains || "")}" /></label>
          <label>Min qty<input type="number" data-path="rules.${i}.when.minQty" data-opt value="${r.when.minQty ?? ""}" /></label>
          <label>Max qty<input type="number" data-path="rules.${i}.when.maxQty" data-opt value="${r.when.maxQty ?? ""}" /></label>
          <label>Min wt (lb)<input type="number" step="0.1" data-path="rules.${i}.when.minWeightLb" data-opt value="${r.when.minWeightLb ?? ""}" /></label>
          <label>Max wt (lb)<input type="number" step="0.1" data-path="rules.${i}.when.maxWeightLb" data-opt value="${r.when.maxWeightLb ?? ""}" /></label>
          <label>Ship weight (lb)<input type="number" step="0.1" data-path="rules.${i}.packageWeightLb" data-opt value="${r.packageWeightLb ?? ""}" title="Fixed package weight when Wix products have no weight" /></label>
        </div>
        <select data-path="rules.${i}.boxId">${boxOpts(r.boxId)}</select>
        <select data-path="rules.${i}.serviceId">${svcOpts(r.serviceId)}</select>
        <input data-path="rules.${i}.note" value="${esc(r.note || "")}" placeholder="e.g. add ice pack" />
        <div class="row-actions">
          <button class="small" data-move="-1" data-i="${i}" title="Move up">↑</button>
          <button class="small" data-move="1" data-i="${i}" title="Move down">↓</button>
          <button class="small" data-del="rules" data-i="${i}">✕</button>
        </div>
      </div>`).join("")}
      <p><button class="small" data-add="rules">Add rule</button></p>
    </div>

    <div class="card"><h3>Defaults</h3><div class="grid">
      <label>Default box<select data-path="defaultBoxId">${boxOpts(s.defaultBoxId)}</select></label>
      <label>Default service<select data-path="defaultServiceId">${svcOpts(s.defaultServiceId)}</select></label>
      <label>Ship days (1=Mon…7=Sun)<input data-path="shipDays" data-list-num value="${s.shipDays.join(", ")}" /></label>
      <label>Hot-weather states<input data-path="hotStates" data-list value="${esc(s.hotStates.join(", "))}" /></label>
      ${field("Wholesale SKU prefix", "wholesaleSkuPrefix")}
    </div></div>`;

  $$("[data-path]", el).forEach((inp) =>
    inp.addEventListener("input", () => {
      let v = inp.value;
      if (inp.hasAttribute("data-list")) v = v.split(",").map((x) => x.trim()).filter(Boolean);
      else if (inp.hasAttribute("data-list-num")) v = v.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n));
      else if (inp.type === "number") v = v === "" ? undefined : Number(v);
      else if (inp.hasAttribute("data-opt") || inp.tagName === "SELECT") v = v === "" ? undefined : v;
      set(state.draft, inp.dataset.path, v);
    }),
  );
  $$("[data-del]", el).forEach((b) => b.addEventListener("click", () => { state.draft[b.dataset.del].splice(+b.dataset.i, 1); state.settings = state.draft; renderSettings(); }));
  $$("[data-move]", el).forEach((b) => b.addEventListener("click", () => {
    const i = +b.dataset.i, j = i + +b.dataset.move, r = state.draft.rules;
    if (j < 0 || j >= r.length) return;
    [r[i], r[j]] = [r[j], r[i]];
    state.settings = state.draft; renderSettings();
  }));
  $$("[data-add]", el).forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.add, id = `${k.slice(0, -1)}-${Date.now().toString(36)}`;
    if (k === "boxes") state.draft.boxes.push({ id, name: "New box", lengthIn: 10, widthIn: 8, heightIn: 6, tareLb: 0.5 });
    if (k === "services") state.draft.services.push({ id, name: "New service", carrier: "usps", shippoToken: "", pirateShipName: "" });
    if (k === "rules") state.draft.rules.push({ id, name: "New rule", when: {}, boxId: state.draft.defaultBoxId, serviceId: state.draft.defaultServiceId });
    state.settings = state.draft; renderSettings();
  }));
}

function get(o, p) { return p.split(".").reduce((a, k) => (a == null ? a : a[k]), o) ?? ""; }
function set(o, p, v) {
  const ks = p.split(".");
  const last = ks.pop();
  const t = ks.reduce((a, k) => (a[k] ??= {}), o);
  if (v === undefined) delete t[last]; else t[last] = v;
}

$("#settings-save").addEventListener("click", async () => {
  try {
    const saved = await api("/api/settings", { method: "PUT", body: JSON.stringify(state.draft) });
    state.settings = saved;
    alert("Saved. Orders will be re-assigned with the new rules.");
    loadOrders();
    renderSettings();
  } catch (e) {
    alert(`Not saved: ${e.message}`);
  }
});

// ---------- boot ----------
(async () => {
  await loadStatus();
  await loadOrders();
})();
