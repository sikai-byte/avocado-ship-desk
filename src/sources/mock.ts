import type { Order } from "../types.js";
import type { FulfillmentInput, OrderSource } from "./types.js";

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

function mk(
  n: number,
  shipTo: Order["shipTo"],
  items: Array<[sku: string, name: string, qty: number, weightLb: number]>,
  extra: Partial<Order> = {},
): Order {
  const lineItems = items.map(([sku, name, quantity, weightLb], i) => ({ id: `li-${n}-${i}`, sku, name, quantity, weightLb }));
  return {
    id: `mock-${n}`,
    number: String(10000 + n),
    createdAt: daysAgo(n / 3),
    shipTo,
    items: lineItems,
    totalWeightLb: lineItems.reduce((s, i) => s + i.weightLb * i.quantity, 0),
    channel: "retail",
    ...extra,
  };
}

const sample: Order[] = [
  mk(1, { name: "Maria Lopez", street1: "88 Palm Ave", city: "San Diego", state: "CA", zip: "92101", country: "US", email: "maria@example.com" }, [["AVO-6", "6 Hass avocados", 1, 2.4]]),
  mk(2, { name: "Devon Carter", street1: "410 W 5th St", street2: "Apt 12B", city: "Austin", state: "TX", zip: "78701", country: "US", phone: "5125550101" }, [["AVO-12", "12 Hass avocados", 1, 4.8]], { shippingOption: "Standard Shipping" }),
  mk(3, { name: "Priya Natarajan", street1: "1500 Lake Shore Dr", city: "Chicago", state: "IL", zip: "60610", country: "US" }, [["AVO-24", "24 Hass avocados", 1, 9.6]], { buyerNote: "Please leave at side door" }),
  mk(4, { name: "Sam Okafor", street1: "22 Elm St", city: "Portland", state: "OR", zip: "97205", country: "US" }, [["AVO-6", "6 Hass avocados", 2, 2.4], ["OIL-250", "Avocado oil 250ml", 1, 0.7]]),
  mk(5, { name: "Green Fork Bistro", company: "Green Fork Bistro", street1: "900 Market St", city: "San Francisco", state: "CA", zip: "94102", country: "US", phone: "4155550199" }, [["WS-CASE", "Wholesale case (48)", 1, 19.5]], { channel: "wholesale", shippingOption: "Wholesale Freight" }),
  mk(6, { name: "Hannah Weiss", street1: "77 Sunset Blvd", city: "Phoenix", state: "AZ", zip: "85004", country: "US" }, [["AVO-12", "12 Hass avocados", 1, 4.8]]),
  mk(7, { name: "Luis Ortega", street1: "", city: "Miami", state: "FL", zip: "", country: "US" }, [["AVO-6", "6 Hass avocados", 1, 2.4]]),
  mk(8, { name: "Aiko Tanaka", street1: "5 Harbour View", city: "Vancouver", state: "BC", zip: "V6B 1A1", country: "CA" }, [["GIFT-BOX", "Gift box", 1, 3.1]]),
];

export class MockOrderSource implements OrderSource {
  readonly name = "mock";
  private fulfilled = new Set<string>();

  async listUnfulfilled(): Promise<Order[]> {
    return sample.filter((o) => !this.fulfilled.has(o.id));
  }

  async markFulfilled(input: FulfillmentInput): Promise<void> {
    this.fulfilled.add(input.orderId);
  }
}
