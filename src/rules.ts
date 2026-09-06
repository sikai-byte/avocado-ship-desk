import type { Assignment, Order, Rule, RuleCondition, ShipSettings } from "./types.js";
import type { Override } from "./store.js";

export function totalQty(order: Order): number {
  return order.items.reduce((n, i) => n + i.quantity, 0);
}

export function matches(cond: RuleCondition, order: Order): boolean {
  if (cond.skus && cond.skus.length > 0) {
    const have = new Set(order.items.map((i) => i.sku));
    if (!cond.skus.every((s) => have.has(s))) return false;
  }
  const qty = totalQty(order);
  if (cond.minQty !== undefined && qty < cond.minQty) return false;
  if (cond.maxQty !== undefined && qty > cond.maxQty) return false;
  if (cond.minWeightLb !== undefined && order.totalWeightLb < cond.minWeightLb) return false;
  if (cond.maxWeightLb !== undefined && order.totalWeightLb > cond.maxWeightLb) return false;
  if (cond.states && cond.states.length > 0 && !cond.states.includes(order.shipTo.state.toUpperCase())) return false;
  if (cond.channel && cond.channel !== order.channel) return false;
  if (
    cond.shippingOptionContains &&
    !(order.shippingOption ?? "").toLowerCase().includes(cond.shippingOptionContains.toLowerCase())
  )
    return false;
  return true;
}

export function firstMatchingRule(rules: Rule[], order: Order): Rule | undefined {
  return rules.find((r) => matches(r.when, order));
}

export function assign(order: Order, settings: ShipSettings, override?: Override): Assignment {
  const rule = firstMatchingRule(settings.rules, order);
  let boxId = rule?.boxId ?? settings.defaultBoxId;
  let serviceId = rule?.serviceId ?? settings.defaultServiceId;
  let manual = false;
  if (override?.boxId) {
    boxId = override.boxId;
    manual = true;
  }
  if (override?.serviceId) {
    serviceId = override.serviceId;
    manual = true;
  }

  const warnings: string[] = [];
  const box = settings.boxes.find((b) => b.id === boxId);
  const service = settings.services.find((s) => s.id === serviceId);
  if (!box) warnings.push(`Unknown box "${boxId}"`);
  if (!service) warnings.push(`Unknown service "${serviceId}"`);
  if (!rule && !override) warnings.push("No rule matched — using defaults");
  if (settings.hotStates.includes(order.shipTo.state.toUpperCase())) warnings.push("Hot-weather state");
  if (order.shipTo.country !== "US") warnings.push("International address");
  if (!order.shipTo.street1 || !order.shipTo.zip) warnings.push("Incomplete address");
  if (order.buyerNote) warnings.push("Buyer note");
  if (order.totalWeightLb <= 0) warnings.push("Missing product weights");

  const packageWeightLb = round2(order.totalWeightLb + (box?.tareLb ?? 0));
  return { orderId: order.id, boxId, serviceId, ruleId: rule?.id, note: rule?.note, manual, warnings, packageWeightLb };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isShipDay(settings: ShipSettings, date = new Date()): boolean {
  const iso = ((date.getDay() + 6) % 7) + 1;
  return settings.shipDays.includes(iso);
}
