import type { Address, LineItem, Order } from "../types.js";
import type { FulfillmentInput, OrderSource } from "./types.js";

/**
 * Wix eCommerce Orders + Fulfillments REST API.
 * Docs: https://dev.wix.com/docs/rest/business-solutions/e-commerce/orders
 * Auth: a Wix API key (Settings → API Keys) with eCommerce permissions plus the site ID.
 */

const BASE = "https://www.wixapis.com";

interface WixAddress {
  addressLine1?: string;
  addressLine?: string;
  addressLine2?: string;
  city?: string;
  subdivision?: string;
  postalCode?: string;
  country?: string;
}

interface WixContact {
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
}

interface WixOrder {
  id: string;
  number: string;
  createdDate: string;
  buyerNote?: string;
  weightUnit?: "KG" | "LB";
  buyerInfo?: { email?: string };
  channelInfo?: { type?: string };
  lineItems: Array<{
    id: string;
    quantity: number;
    productName?: { original?: string };
    physicalProperties?: { weight?: number; sku?: string };
    catalogReference?: { catalogItemId?: string };
  }>;
  shippingInfo?: {
    title?: string;
    logistics?: {
      shippingDestination?: { address?: WixAddress; contactDetails?: WixContact };
      pickupDetails?: unknown;
    };
  };
}

export interface WixOptions {
  apiKey: string;
  siteId: string;
  accountId?: string;
  /** SKUs starting with this prefix are treated as wholesale orders */
  wholesaleSkuPrefix?: string;
  fetchImpl?: typeof fetch;
}

export class WixOrderSource implements OrderSource {
  readonly name = "wix";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: WixOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: this.opts.apiKey,
      "wix-site-id": this.opts.siteId,
      "Content-Type": "application/json",
    };
    if (this.opts.accountId) h["wix-account-id"] = this.opts.accountId;
    return h;
  }

  private async call<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(BASE + path, {
      method: body === undefined ? "GET" : "POST",
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Wix ${path} failed: ${res.status} ${text.slice(0, 500)}`);
    }
    return (await res.json()) as T;
  }

  async listUnfulfilled(): Promise<Order[]> {
    const orders: Order[] = [];
    let cursor: string | undefined;
    do {
      const body = {
        search: {
          filter: { status: "APPROVED", paymentStatus: "PAID", fulfillmentStatus: "NOT_FULFILLED" },
          sort: [{ fieldName: "createdDate", order: "ASC" }],
          cursorPaging: cursor ? { cursor, limit: 100 } : { limit: 100 },
        },
      };
      const data = await this.call<{ orders: WixOrder[]; pagingMetadata?: { cursors?: { next?: string } } }>(
        "/ecom/v1/orders/search",
        body,
      );
      for (const o of data.orders ?? []) {
        // skip local-pickup orders; nothing to label
        if (o.shippingInfo?.logistics?.pickupDetails) continue;
        orders.push(this.toOrder(o));
      }
      cursor = data.pagingMetadata?.cursors?.next;
    } while (cursor);
    return orders;
  }

  toOrder(o: WixOrder): Order {
    const dest = o.shippingInfo?.logistics?.shippingDestination;
    const a = dest?.address ?? {};
    const c = dest?.contactDetails ?? {};
    const kgToLb = o.weightUnit === "KG" ? 2.20462 : 1;
    const items: LineItem[] = o.lineItems.map((li) => ({
      id: li.id,
      sku: li.physicalProperties?.sku ?? li.catalogReference?.catalogItemId ?? "",
      name: li.productName?.original ?? "Item",
      quantity: li.quantity,
      weightLb: Math.round((li.physicalProperties?.weight ?? 0) * kgToLb * 100) / 100,
    }));
    const prefix = this.opts.wholesaleSkuPrefix;
    const wholesale = Boolean(prefix) && items.some((i) => i.sku.startsWith(prefix!));
    const shipTo: Address = {
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || "Customer",
      company: c.company,
      street1: a.addressLine1 ?? a.addressLine ?? "",
      street2: a.addressLine2,
      city: a.city ?? "",
      state: (a.subdivision ?? "").replace(/^[A-Z]{2}-/, ""),
      zip: a.postalCode ?? "",
      country: a.country ?? "US",
      phone: c.phone,
      email: o.buyerInfo?.email,
    };
    return {
      id: o.id,
      number: o.number,
      createdAt: o.createdDate,
      buyerNote: o.buyerNote,
      shipTo,
      items,
      shippingOption: o.shippingInfo?.title,
      totalWeightLb: Math.round(items.reduce((s, i) => s + i.weightLb * i.quantity, 0) * 100) / 100,
      channel: wholesale ? "wholesale" : "retail",
    };
  }

  async markFulfilled(input: FulfillmentInput): Promise<void> {
    const order = await this.call<{ order: WixOrder }>(`/ecom/v1/orders/${input.orderId}`).catch(() => undefined);
    const lineItems = order?.order.lineItems.map((li) => ({ id: li.id, quantity: li.quantity })) ?? [];
    await this.call(`/ecom/v1/fulfillments/orders/${input.orderId}/create-fulfillment`, {
      fulfillment: {
        lineItems,
        trackingInfo: {
          trackingNumber: input.trackingNumber,
          shippingProvider: input.carrier,
          ...(input.trackingUrl ? { trackingLink: input.trackingUrl } : {}),
        },
      },
    });
  }
}
