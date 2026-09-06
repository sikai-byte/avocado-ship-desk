import { stringify } from "csv-stringify/sync";
import { parse } from "csv-parse/sync";
import type { Assignment, Order, ShipSettings } from "../types.js";

/**
 * Pirate Ship bulk-import CSV. Column names follow Pirate Ship's "Ship → Upload a Spreadsheet"
 * template; unknown columns are ignored by their importer and the user can re-map on upload.
 */
export const PIRATE_SHIP_COLUMNS = [
  "Order ID",
  "Name",
  "Company",
  "Address 1",
  "Address 2",
  "City",
  "State",
  "Zipcode",
  "Country",
  "Email",
  "Phone",
  "Weight (lb)",
  "Length",
  "Width",
  "Height",
  "Service",
  "Rubber Stamp 1",
  "Rubber Stamp 2",
] as const;

export function pirateShipRows(orders: Order[], assignments: Map<string, Assignment>, settings: ShipSettings) {
  return orders.map((o) => {
    const a = assignments.get(o.id);
    const box = settings.boxes.find((b) => b.id === a?.boxId);
    const service = settings.services.find((s) => s.id === a?.serviceId);
    const contents = o.items.map((i) => `${i.quantity}x ${i.sku || i.name}`).join(", ");
    return {
      "Order ID": o.number,
      Name: o.shipTo.name,
      Company: o.shipTo.company ?? "",
      "Address 1": o.shipTo.street1,
      "Address 2": o.shipTo.street2 ?? "",
      City: o.shipTo.city,
      State: o.shipTo.state,
      Zipcode: o.shipTo.zip,
      Country: o.shipTo.country,
      Email: o.shipTo.email ?? "",
      Phone: o.shipTo.phone ?? "",
      "Weight (lb)": a?.packageWeightLb ?? o.totalWeightLb,
      Length: box?.lengthIn ?? "",
      Width: box?.widthIn ?? "",
      Height: box?.heightIn ?? "",
      Service: service?.pirateShipName ?? service?.name ?? "",
      "Rubber Stamp 1": `Order ${o.number}`,
      "Rubber Stamp 2": contents.slice(0, 50),
    };
  });
}

export function pirateShipCsv(orders: Order[], assignments: Map<string, Assignment>, settings: ShipSettings): string {
  return stringify(pirateShipRows(orders, assignments, settings), { header: true, columns: [...PIRATE_SHIP_COLUMNS] });
}

export interface TrackingRow {
  orderNumber: string;
  trackingNumber: string;
  carrier: string;
  service?: string;
  costUsd?: number;
}

/**
 * Parses a Pirate Ship "Reports → Shipments" export (or any CSV with order/tracking columns).
 * Header matching is case-insensitive and tolerant of the common variants.
 */
export function parseTrackingCsv(csv: string): TrackingRow[] {
  const records = parse(csv, { columns: true, skip_empty_lines: true, bom: true, trim: true }) as Record<string, string>[];
  const pick = (row: Record<string, string>, names: string[]) => {
    const keys = Object.keys(row);
    for (const n of names) {
      const k = keys.find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, "") === n);
      if (k && row[k] !== undefined && row[k] !== "") return row[k];
    }
    return undefined;
  };
  const rows: TrackingRow[] = [];
  for (const r of records) {
    const orderNumber = pick(r, ["orderid", "ordernumber", "order", "reference", "rubberstamp1"]);
    const trackingNumber = pick(r, ["trackingnumber", "tracking", "tracking"]);
    if (!orderNumber || !trackingNumber) continue;
    const service = pick(r, ["service", "mailclass", "shippingservice"]);
    const carrierRaw = pick(r, ["carrier"]) ?? service ?? "";
    const cost = pick(r, ["cost", "postage", "totalcost", "price", "amount"]);
    rows.push({
      orderNumber: orderNumber.replace(/^Order\s+/i, ""),
      trackingNumber,
      carrier: normalizeCarrier(carrierRaw),
      service,
      costUsd: cost ? Number(cost.replace(/[^0-9.]/g, "")) || undefined : undefined,
    });
  }
  return rows;
}

export function normalizeCarrier(s: string): string {
  const l = s.toLowerCase();
  if (l.includes("usps")) return "usps";
  if (l.includes("ups")) return "ups";
  if (l.includes("fedex")) return "fedex";
  if (l.includes("dhl")) return "dhl";
  return l || "other";
}

export function trackingUrl(carrier: string, tracking: string): string | undefined {
  switch (carrier) {
    case "usps":
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}`;
    case "ups":
      return `https://www.ups.com/track?tracknum=${tracking}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${tracking}`;
    default:
      return undefined;
  }
}
