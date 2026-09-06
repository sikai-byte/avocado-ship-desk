import { PDFDocument } from "pdf-lib";
import type { Address, Assignment, Box, LabelRecord, Order, Service, ShipSettings } from "../types.js";

/**
 * Shippo REST API (https://docs.goshippo.com). Test keys (shippo_test_...) produce free sample labels.
 */
const BASE = "https://api.goshippo.com";

interface ShippoRate {
  object_id: string;
  amount: string;
  currency: string;
  provider: string;
  servicelevel: { token: string; name: string };
  estimated_days?: number;
}

interface ShippoShipment {
  object_id: string;
  status: string;
  rates: ShippoRate[];
  messages?: Array<{ text: string }>;
}

interface ShippoTransaction {
  object_id: string;
  status: "SUCCESS" | "ERROR" | "QUEUED" | "WAITING";
  tracking_number?: string;
  tracking_url_provider?: string;
  label_url?: string;
  rate?: string | ShippoRate;
  messages?: Array<{ text: string }>;
}

export interface ShippoOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  labelFileType?: "PDF" | "PDF_4x6" | "PNG";
}

export class ShippoClient {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly opts: ShippoOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(BASE + path, {
      method: "POST",
      headers: { Authorization: `ShippoToken ${this.opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Shippo ${path} failed: ${res.status} ${(await res.text()).slice(0, 500)}`);
    return (await res.json()) as T;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(BASE + path, { headers: { Authorization: `ShippoToken ${this.opts.apiKey}` } });
    if (!res.ok) throw new Error(`Shippo ${path} failed: ${res.status} ${(await res.text()).slice(0, 500)}`);
    return (await res.json()) as T;
  }

  static address(a: Address) {
    return {
      name: a.name,
      company: a.company,
      street1: a.street1,
      street2: a.street2,
      city: a.city,
      state: a.state,
      zip: a.zip,
      country: a.country,
      phone: a.phone,
      email: a.email,
    };
  }

  async createShipment(from: Address, to: Address, box: Box, weightLb: number): Promise<ShippoShipment> {
    return this.post<ShippoShipment>("/shipments/", {
      address_from: ShippoClient.address(from),
      address_to: ShippoClient.address(to),
      parcels: [
        {
          length: String(box.lengthIn),
          width: String(box.widthIn),
          height: String(box.heightIn),
          distance_unit: "in",
          weight: String(weightLb),
          mass_unit: "lb",
        },
      ],
      async: false,
    });
  }

  async buyLabel(rateId: string): Promise<ShippoTransaction> {
    let tx = await this.post<ShippoTransaction>("/transactions/", {
      rate: rateId,
      label_file_type: this.opts.labelFileType ?? "PDF_4x6",
      async: false,
    });
    for (let i = 0; i < 10 && (tx.status === "QUEUED" || tx.status === "WAITING"); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      tx = await this.get<ShippoTransaction>(`/transactions/${tx.object_id}`);
    }
    return tx;
  }
}

export function pickRate(rates: ShippoRate[], service: Service): ShippoRate | undefined {
  const exact = rates.find((r) => r.servicelevel.token === service.shippoToken);
  if (exact) return exact;
  // fall back to the cheapest rate from the same carrier
  return rates
    .filter((r) => r.provider.toLowerCase() === service.carrier)
    .sort((a, b) => Number(a.amount) - Number(b.amount))[0];
}

export interface PurchaseResult {
  records: LabelRecord[];
  errors: Array<{ orderId: string; orderNumber: string; error: string }>;
}

export async function purchaseLabels(
  client: ShippoClient,
  orders: Order[],
  assignments: Map<string, Assignment>,
  settings: ShipSettings,
): Promise<PurchaseResult> {
  const result: PurchaseResult = { records: [], errors: [] };
  for (const order of orders) {
    const a = assignments.get(order.id);
    const box = settings.boxes.find((b) => b.id === a?.boxId);
    const service = settings.services.find((s) => s.id === a?.serviceId);
    if (!a || !box || !service) {
      result.errors.push({ orderId: order.id, orderNumber: order.number, error: "Missing box or service" });
      continue;
    }
    try {
      const shipment = await client.createShipment(settings.shipFrom, order.shipTo, box, a.packageWeightLb);
      const rate = pickRate(shipment.rates ?? [], service);
      if (!rate) {
        const msg = shipment.messages?.map((m) => m.text).join("; ");
        throw new Error(`No ${service.name} rate available${msg ? `: ${msg}` : ""}`);
      }
      const tx = await client.buyLabel(rate.object_id);
      if (tx.status !== "SUCCESS" || !tx.tracking_number) {
        throw new Error(tx.messages?.map((m) => m.text).join("; ") || `Transaction ${tx.status}`);
      }
      result.records.push({
        orderId: order.id,
        orderNumber: order.number,
        carrier: rate.provider.toLowerCase(),
        service: rate.servicelevel.name,
        trackingNumber: tx.tracking_number,
        labelUrl: tx.label_url,
        costUsd: Number(rate.amount),
        purchasedAt: new Date().toISOString(),
        syncedToStore: false,
        provider: "shippo",
      });
    } catch (e) {
      result.errors.push({ orderId: order.id, orderNumber: order.number, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

/** Downloads every label PDF and merges them into one document, in the given order. */
export async function mergeLabelPdfs(urls: string[], fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const url of urls) {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Failed to download label ${url}: ${res.status}`);
    const src = await PDFDocument.load(await res.arrayBuffer());
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return merged.save();
}
