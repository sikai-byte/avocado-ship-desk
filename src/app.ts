import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Assignment, LabelRecord, Order, ShipSettings } from "./types.js";
import { assign, isShipDay } from "./rules.js";
import { store } from "./store.js";
import { buildPickList } from "./picklist.js";
import { parseTrackingCsv, pirateShipCsv, trackingUrl } from "./labels/pirateship.js";
import { mergeLabelPdfs, purchaseLabels, ShippoClient } from "./labels/shippo.js";
import type { OrderSource } from "./sources/types.js";

export interface AppDeps {
  source: OrderSource;
  shippo?: ShippoClient;
  appKey?: string;
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
}

const settingsSchema = z.object({
  shipFrom: z.object({
    name: z.string(),
    company: z.string().optional(),
    street1: z.string(),
    street2: z.string().optional(),
    city: z.string(),
    state: z.string(),
    zip: z.string(),
    country: z.string(),
    phone: z.string().optional(),
    email: z.string().optional(),
  }),
  boxes: z.array(z.object({ id: z.string().min(1), name: z.string(), lengthIn: z.number(), widthIn: z.number(), heightIn: z.number(), tareLb: z.number() })),
  services: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      carrier: z.enum(["usps", "ups", "fedex"]),
      shippoToken: z.string().optional(),
      pirateShipName: z.string().optional(),
    }),
  ),
  rules: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      when: z.object({
        skus: z.array(z.string()).optional(),
        productContains: z.string().optional(),
        minQty: z.number().optional(),
        maxQty: z.number().optional(),
        minWeightLb: z.number().optional(),
        maxWeightLb: z.number().optional(),
        states: z.array(z.string()).optional(),
        channel: z.enum(["retail", "wholesale"]).optional(),
        shippingOptionContains: z.string().optional(),
      }),
      boxId: z.string(),
      serviceId: z.string(),
      note: z.string().optional(),
      packageWeightLb: z.number().positive().optional(),
    }),
  ),
  defaultBoxId: z.string(),
  defaultServiceId: z.string(),
  shipDays: z.array(z.number().int().min(1).max(7)),
  hotStates: z.array(z.string()),
  wholesaleSkuPrefix: z.string().optional(),
});

const overrideSchema = z.object({
  boxId: z.string().optional().nullable(),
  serviceId: z.string().optional().nullable(),
  hold: z.boolean().optional().nullable(),
});

const idsSchema = z.object({ orderIds: z.array(z.string()).optional() });

export interface BoardRow {
  order: Order;
  assignment: Assignment;
  hold: boolean;
  label?: LabelRecord;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(express.text({ type: ["text/csv", "text/plain"], limit: "5mb" }));

  if (deps.appKey) {
    app.use("/api", (req, res, next) => {
      const key = req.header("x-api-key") ?? (typeof req.query.key === "string" ? req.query.key : undefined);
      if (key !== deps.appKey) return res.status(401).json({ error: "Unauthorized" });
      next();
    });
  }

  let cache: { at: number; orders: Order[] } | undefined;
  const ttl = deps.cacheTtlMs ?? 60_000;
  async function loadOrders(force = false): Promise<Order[]> {
    if (!force && cache && Date.now() - cache.at < ttl) return cache.orders;
    const orders = await deps.source.listUnfulfilled();
    cache = { at: Date.now(), orders };
    return orders;
  }

  function board(orders: Order[]): BoardRow[] {
    const settings = store.getSettings();
    const overrides = store.getOverrides();
    return orders.map((order) => {
      const ov = overrides[order.id];
      return { order, assignment: assign(order, settings, ov), hold: Boolean(ov?.hold), label: store.labelFor(order.id) };
    });
  }

  /** orders that are ready to label: not held, no label yet, optionally restricted to ids */
  function shippable(rows: BoardRow[], ids?: string[]) {
    const idSet = ids ? new Set(ids) : undefined;
    return rows.filter((r) => !r.hold && !r.label && (!idSet || idSet.has(r.order.id)));
  }

  const assignmentsOf = (rows: BoardRow[]) => new Map(rows.map((r) => [r.order.id, r.assignment]));

  app.get("/api/status", (_req, res) => {
    const settings = store.getSettings();
    res.json({
      source: deps.source.name,
      shippoEnabled: Boolean(deps.shippo),
      shipDay: isShipDay(settings),
      shipDays: settings.shipDays,
      labelsPurchased: store.getLabels().length,
    });
  });

  app.get("/api/orders", async (req, res) => {
    try {
      const rows = board(await loadOrders(req.query.refresh === "1"));
      res.json({ rows, settings: store.getSettings() });
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/orders/:id/override", (req, res) => {
    const parsed = overrideSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const p = parsed.data;
    store.setOverride(req.params.id, {
      boxId: p.boxId ?? undefined,
      serviceId: p.serviceId ?? undefined,
      hold: p.hold ?? undefined,
    });
    res.json({ ok: true, override: store.getOverrides()[req.params.id] ?? null });
  });

  app.delete("/api/orders/:id/override", (req, res) => {
    store.clearOverride(req.params.id);
    res.json({ ok: true });
  });

  app.get("/api/picklist", async (_req, res) => {
    const rows = shippable(board(await loadOrders()));
    res.json(buildPickList(rows.map((r) => r.order), assignmentsOf(rows), store.getSettings()));
  });

  app.get("/api/export/pirateship.csv", async (req, res) => {
    const ids = typeof req.query.ids === "string" && req.query.ids ? req.query.ids.split(",") : undefined;
    const rows = shippable(board(await loadOrders()), ids);
    const csv = pirateShipCsv(rows.map((r) => r.order), assignmentsOf(rows), store.getSettings());
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="pirateship-${date}.csv"`);
    res.send(csv);
  });

  app.post("/api/import/tracking", async (req, res) => {
    const csv = typeof req.body === "string" ? req.body : (req.body?.csv as string | undefined);
    if (!csv) return res.status(400).json({ error: "Send the CSV as text/csv body or {csv}" });
    let parsedRows;
    try {
      parsedRows = parseTrackingCsv(csv);
    } catch (e) {
      return res.status(400).json({ error: `Could not parse CSV: ${e instanceof Error ? e.message : e}` });
    }
    const orders = await loadOrders(true);
    const byNumber = new Map(orders.map((o) => [o.number, o]));
    const records: LabelRecord[] = [];
    const errors: Array<{ orderNumber: string; error: string }> = [];
    for (const row of parsedRows) {
      const order = byNumber.get(row.orderNumber);
      if (!order) {
        errors.push({ orderNumber: row.orderNumber, error: "No open order with this number" });
        continue;
      }
      const record: LabelRecord = {
        orderId: order.id,
        orderNumber: order.number,
        carrier: row.carrier,
        service: row.service ?? row.carrier,
        trackingNumber: row.trackingNumber,
        costUsd: row.costUsd,
        purchasedAt: new Date().toISOString(),
        syncedToStore: false,
        provider: "pirateship",
      };
      try {
        await deps.source.markFulfilled({
          orderId: order.id,
          trackingNumber: row.trackingNumber,
          carrier: row.carrier,
          trackingUrl: trackingUrl(row.carrier, row.trackingNumber),
        });
        record.syncedToStore = true;
      } catch (e) {
        errors.push({ orderNumber: order.number, error: `Store sync failed: ${e instanceof Error ? e.message : e}` });
      }
      records.push(record);
    }
    store.addLabels(records);
    cache = undefined;
    res.json({ imported: records.length, synced: records.filter((r) => r.syncedToStore).length, errors });
  });

  app.post("/api/labels/purchase", async (req, res) => {
    if (!deps.shippo) return res.status(400).json({ error: "Shippo is not configured (set SHIPPO_API_KEY)" });
    const parsed = idsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const rows = shippable(board(await loadOrders()), parsed.data.orderIds);
    const blocked = rows.filter((r) => r.assignment.warnings.some((w) => w === "Incomplete address" || w === "Missing product weights"));
    const ready = rows.filter((r) => !blocked.includes(r));
    const settings = store.getSettings();
    const result = await purchaseLabels(deps.shippo, ready.map((r) => r.order), assignmentsOf(ready), settings);
    for (const b of blocked) {
      result.errors.push({ orderId: b.order.id, orderNumber: b.order.number, error: b.assignment.warnings.join(", ") });
    }
    for (const rec of result.records) {
      try {
        await deps.source.markFulfilled({
          orderId: rec.orderId,
          trackingNumber: rec.trackingNumber,
          carrier: rec.carrier,
          trackingUrl: trackingUrl(rec.carrier, rec.trackingNumber),
        });
        rec.syncedToStore = true;
      } catch (e) {
        result.errors.push({ orderId: rec.orderId, orderNumber: rec.orderNumber, error: `Store sync failed: ${e instanceof Error ? e.message : e}` });
      }
    }
    store.addLabels(result.records);
    cache = undefined;
    const total = result.records.reduce((s, r) => s + (r.costUsd ?? 0), 0);
    res.json({ purchased: result.records.length, totalCostUsd: Math.round(total * 100) / 100, records: result.records, errors: result.errors });
  });

  app.get("/api/labels", (_req, res) => {
    res.json(store.getLabels().sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt)));
  });

  app.get("/api/labels/merged.pdf", async (req, res) => {
    const ids = typeof req.query.ids === "string" && req.query.ids ? new Set(req.query.ids.split(",")) : undefined;
    const date = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);
    const labels = store
      .getLabels()
      .filter((l) => l.labelUrl && (ids ? ids.has(l.orderId) : l.purchasedAt.startsWith(date)))
      .sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
    if (labels.length === 0) return res.status(404).json({ error: "No labels with PDFs for that selection" });
    try {
      const pdf = await mergeLabelPdfs(labels.map((l) => l.labelUrl!), deps.fetchImpl);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="labels-${date}.pdf"`);
      res.send(Buffer.from(pdf));
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/settings", (_req, res) => res.json(store.getSettings()));

  app.put("/api/settings", (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const s = parsed.data as ShipSettings;
    const boxIds = new Set(s.boxes.map((b) => b.id));
    const serviceIds = new Set(s.services.map((x) => x.id));
    const bad = s.rules.find((r) => !boxIds.has(r.boxId) || !serviceIds.has(r.serviceId));
    if (bad) return res.status(400).json({ error: `Rule "${bad.name}" references an unknown box or service` });
    if (!boxIds.has(s.defaultBoxId) || !serviceIds.has(s.defaultServiceId))
      return res.status(400).json({ error: "Default box/service must exist" });
    store.saveSettings(s);
    res.json(s);
  });

  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
  app.use(express.static(publicDir));

  return app;
}
