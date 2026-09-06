import { describe, expect, it } from "vitest";
import { assign, firstMatchingRule, isShipDay } from "./rules.js";
import { defaultSettings } from "./defaults.js";
import type { Order } from "./types.js";

const order = (over: Partial<Order> = {}): Order => ({
  id: "o1",
  number: "1001",
  createdAt: new Date().toISOString(),
  shipTo: { name: "A", street1: "1 St", city: "X", state: "CA", zip: "90001", country: "US" },
  items: [{ id: "li1", sku: "AVO-12", name: "12 avocados", quantity: 1, weightLb: 4.8 }],
  totalWeightLb: 4.8,
  channel: "retail",
  ...over,
});

describe("rules", () => {
  it("picks the first matching rule top to bottom", () => {
    const r = firstMatchingRule(defaultSettings.rules, order());
    expect(r?.id).toBe("r-12");
  });

  it("wholesale wins over sku rules because it is listed first", () => {
    const a = assign(order({ channel: "wholesale" }), defaultSettings);
    expect(a.ruleId).toBe("r-wholesale");
    expect(a.serviceId).toBe("ups_ground");
  });

  it("matches on product name substring when items have no SKU", () => {
    const rules = [{ id: "r-choq", name: "Choquette", when: { productContains: "choquette" }, boxId: "large", serviceId: "usps_priority" }];
    const o = order({ items: [{ id: "x", sku: "", name: "Choquette Avocado Box (late September)", quantity: 1, weightLb: 0 }] });
    expect(firstMatchingRule(rules, o)?.id).toBe("r-choq");
    expect(firstMatchingRule(rules, order())).toBeUndefined();
  });

  it("uses the rule's fixed package weight when items have no weight", () => {
    const settings = { ...defaultSettings, rules: [{ id: "r", name: "r", when: { productContains: "box" }, boxId: "medium", serviceId: "usps_priority", packageWeightLb: 6 }] };
    const a = assign(order({ items: [{ id: "x", sku: "", name: "Avocado Box", quantity: 1, weightLb: 0 }], totalWeightLb: 0 }), settings);
    expect(a.packageWeightLb).toBe(6);
    expect(a.warnings).not.toContain("Missing product weights");
  });

  it("falls back to defaults with a warning when nothing matches", () => {
    const a = assign(order({ items: [{ id: "x", sku: "OIL-250", name: "Oil", quantity: 1, weightLb: 0.7 }], totalWeightLb: 0.7 }), defaultSettings);
    expect(a.boxId).toBe(defaultSettings.defaultBoxId);
    expect(a.warnings).toContain("No rule matched — using defaults");
  });

  it("adds box tare to package weight", () => {
    const a = assign(order(), defaultSettings);
    expect(a.packageWeightLb).toBe(4.8 + 0.9);
  });

  it("applies manual overrides and flags them", () => {
    const a = assign(order(), defaultSettings, { boxId: "large" });
    expect(a.boxId).toBe("large");
    expect(a.serviceId).toBe("usps_priority");
    expect(a.manual).toBe(true);
  });

  it("flags hot states, bad addresses and international", () => {
    const a = assign(order({ shipTo: { name: "B", street1: "", city: "Phoenix", state: "AZ", zip: "", country: "US" } }), defaultSettings);
    expect(a.warnings).toEqual(expect.arrayContaining(["Hot-weather state", "Incomplete address"]));
    const b = assign(order({ shipTo: { name: "C", street1: "1", city: "V", state: "BC", zip: "V6B", country: "CA" } }), defaultSettings);
    expect(b.warnings).toContain("International address");
  });

  it("knows ship days", () => {
    const monday = new Date("2026-09-07T12:00:00Z");
    const tuesday = new Date("2026-09-08T12:00:00Z");
    expect(isShipDay(defaultSettings, monday)).toBe(true);
    expect(isShipDay(defaultSettings, tuesday)).toBe(false);
  });
});
