import { describe, expect, it } from "vitest";
import { WixOrderSource } from "./wix.js";

const wixOrder = {
  id: "abc",
  number: "10042",
  createdDate: "2026-09-01T10:00:00Z",
  weightUnit: "LB" as const,
  buyerNote: "ring bell",
  buyerInfo: { email: "buyer@example.com" },
  lineItems: [
    { id: "li1", quantity: 2, productName: { original: "6 avocados" }, physicalProperties: { weight: 2.4, sku: "AVO-6" } },
    { id: "li2", quantity: 1, productName: { original: "Case" }, physicalProperties: { weight: 19.5, sku: "WS-CASE" } },
  ],
  shippingInfo: {
    title: "Standard",
    logistics: {
      shippingDestination: {
        address: { addressLine1: "1 Main St", addressLine2: "Unit 4", city: "Austin", subdivision: "US-TX", postalCode: "78701", country: "US" },
        contactDetails: { firstName: "Devon", lastName: "Carter", phone: "512", company: "Acme" },
      },
    },
  },
};

describe("wix order mapping", () => {
  const src = new WixOrderSource({ apiKey: "k", siteId: "s", wholesaleSkuPrefix: "WS-" });

  it("maps a Wix order to the internal shape", () => {
    const o = src.toOrder(wixOrder);
    expect(o.number).toBe("10042");
    expect(o.shipTo).toMatchObject({ name: "Devon Carter", company: "Acme", street1: "1 Main St", street2: "Unit 4", state: "TX", zip: "78701" });
    expect(o.totalWeightLb).toBe(24.3);
    expect(o.channel).toBe("wholesale");
    expect(o.shippingOption).toBe("Standard");
  });

  it("converts kg to lb", () => {
    const o = src.toOrder({ ...wixOrder, weightUnit: "KG", lineItems: [{ id: "a", quantity: 1, physicalProperties: { weight: 1, sku: "X" } }] });
    expect(o.items[0].weightLb).toBe(2.2);
  });

  it("lists unfulfilled orders and follows cursors", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) });
      const page = calls.length;
      return new Response(
        JSON.stringify({ orders: [{ ...wixOrder, id: `o${page}` }], metadata: page === 1 ? { cursors: { next: "c2" }, hasNext: true } : { hasNext: false } }),
        { status: 200 },
      );
    }) as typeof fetch;
    const s = new WixOrderSource({ apiKey: "k", siteId: "s", fetchImpl });
    const orders = await s.listUnfulfilled();
    expect(orders.map((o) => o.id)).toEqual(["o1", "o2"]);
    expect(calls[0].url).toBe("https://www.wixapis.com/ecom/v1/orders/search");
    expect(calls[0].body).toContain('"fulfillmentStatus":"NOT_FULFILLED"');
    expect(calls[1].body).toContain('"cursor":"c2"');
  });

  it("creates a fulfillment with tracking", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? String(init.body) : undefined });
      if (String(url).endsWith("/orders/abc")) return new Response(JSON.stringify({ order: wixOrder }), { status: 200 });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const s = new WixOrderSource({ apiKey: "k", siteId: "s", fetchImpl });
    await s.markFulfilled({ orderId: "abc", trackingNumber: "9400", carrier: "usps" });
    expect(calls[1].url).toBe("https://www.wixapis.com/ecom/v1/fulfillments/orders/abc/create-fulfillment");
    const body = JSON.parse(calls[1].body!);
    expect(body.fulfillment.lineItems).toEqual([{ id: "li1", quantity: 2 }, { id: "li2", quantity: 1 }]);
    expect(body.fulfillment.trackingInfo).toEqual({ trackingNumber: "9400", shippingProvider: "usps" });
  });
});
