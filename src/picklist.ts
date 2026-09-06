import type { Assignment, Order, ShipSettings } from "./types.js";

export interface PickListEntry {
  orderNumber: string;
  name: string;
  destination: string;
  box: string;
  service: string;
  items: string[];
  note?: string;
  buyerNote?: string;
  warnings: string[];
}

export interface PickList {
  generatedAt: string;
  orders: PickListEntry[];
  /** total units per SKU so he can pull everything from cold storage in one trip */
  skuTotals: Array<{ sku: string; name: string; quantity: number }>;
  boxTotals: Array<{ box: string; count: number }>;
}

export function buildPickList(orders: Order[], assignments: Map<string, Assignment>, settings: ShipSettings): PickList {
  const skuMap = new Map<string, { name: string; quantity: number }>();
  const boxMap = new Map<string, number>();
  const entries: PickListEntry[] = orders.map((o) => {
    const a = assignments.get(o.id);
    const box = settings.boxes.find((b) => b.id === a?.boxId);
    const service = settings.services.find((s) => s.id === a?.serviceId);
    for (const i of o.items) {
      const cur = skuMap.get(i.sku || i.name) ?? { name: i.name, quantity: 0 };
      cur.quantity += i.quantity;
      skuMap.set(i.sku || i.name, cur);
    }
    const boxName = box?.name ?? "?";
    boxMap.set(boxName, (boxMap.get(boxName) ?? 0) + 1);
    return {
      orderNumber: o.number,
      name: o.shipTo.name,
      destination: `${o.shipTo.city}, ${o.shipTo.state}`,
      box: boxName,
      service: service?.name ?? "?",
      items: o.items.map((i) => `${i.quantity} × ${i.name}`),
      note: a?.note,
      buyerNote: o.buyerNote,
      warnings: a?.warnings ?? [],
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    orders: entries,
    skuTotals: [...skuMap.entries()].map(([sku, v]) => ({ sku, ...v })).sort((a, b) => b.quantity - a.quantity),
    boxTotals: [...boxMap.entries()].map(([box, count]) => ({ box, count })),
  };
}
