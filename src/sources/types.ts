import type { Order } from "../types.js";

export interface FulfillmentInput {
  orderId: string;
  trackingNumber: string;
  carrier: string;
  trackingUrl?: string;
}

export interface OrderSource {
  readonly name: string;
  /** paid orders that have not been fulfilled yet */
  listUnfulfilled(): Promise<Order[]>;
  /** mark the order shipped in the store, which triggers the customer's shipping email */
  markFulfilled(input: FulfillmentInput): Promise<void>;
}
