import { describe, expect, it } from "vitest";
import { parseTrackingCsv, pirateShipCsv } from "./pirateship.js";
import { assign } from "../rules.js";
import { defaultSettings } from "../defaults.js";
import { MockOrderSource } from "../sources/mock.js";

describe("pirate ship csv", () => {
  it("exports one row per order with box dims and service", async () => {
    const orders = await new MockOrderSource().listUnfulfilled();
    const assignments = new Map(orders.map((o) => [o.id, assign(o, defaultSettings)]));
    const csv = pirateShipCsv(orders, assignments, defaultSettings);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(orders.length + 1);
    expect(lines[0]).toContain("Order ID,Name,Company,Address 1");
    const row = lines[1];
    expect(row).toContain("10001");
    expect(row).toContain("USPS Priority Mail");
    expect(row).toContain(",10,8,6,");
  });

  it("parses a pirate ship shipments report", () => {
    const csv = `Order ID,Recipient,Tracking Number,Service,Cost\n10001,Maria Lopez,9400111899223,USPS Priority Mail,$8.12\nOrder 10002,Devon,1Z999,UPS Ground,12.40\n`;
    const rows = parseTrackingCsv(csv);
    expect(rows).toEqual([
      { orderNumber: "10001", trackingNumber: "9400111899223", carrier: "usps", service: "USPS Priority Mail", costUsd: 8.12 },
      { orderNumber: "10002", trackingNumber: "1Z999", carrier: "ups", service: "UPS Ground", costUsd: 12.4 },
    ]);
  });

  it("skips rows without a tracking number", () => {
    expect(parseTrackingCsv("Order ID,Tracking Number\n1,\n")).toEqual([]);
  });
});
