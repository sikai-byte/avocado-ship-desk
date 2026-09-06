export interface Address {
  name: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
}

export interface LineItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  /** per-unit weight in pounds, as configured on the Wix product */
  weightLb: number;
}

export interface Order {
  id: string;
  number: string;
  createdAt: string;
  buyerNote?: string;
  shipTo: Address;
  items: LineItem[];
  /** shipping method the customer chose at checkout, if any */
  shippingOption?: string;
  totalWeightLb: number;
  channel: "retail" | "wholesale";
}

export interface Box {
  id: string;
  name: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  /** empty box + packaging weight in pounds */
  tareLb: number;
}

export type Carrier = "usps" | "ups" | "fedex";

export interface Service {
  id: string;
  name: string;
  carrier: Carrier;
  /** Shippo servicelevel token, e.g. usps_priority */
  shippoToken?: string;
  /** Pirate Ship "Service" column value, e.g. "USPS Priority Mail" */
  pirateShipName?: string;
}

export interface RuleCondition {
  /** all listed SKUs must be present in the order */
  skus?: string[];
  /** case-insensitive substring of any item's product name */
  productContains?: string;
  /** total quantity across all items */
  minQty?: number;
  maxQty?: number;
  /** total item weight (lbs), excluding box tare */
  minWeightLb?: number;
  maxWeightLb?: number;
  /** destination states (2-letter) */
  states?: string[];
  channel?: "retail" | "wholesale";
  shippingOptionContains?: string;
}

export interface Rule {
  id: string;
  name: string;
  when: RuleCondition;
  boxId: string;
  serviceId: string;
  /** e.g. "add ice pack" — shows on pick list */
  note?: string;
  /** fixed total package weight (lbs) used when Wix products carry no weight */
  packageWeightLb?: number;
}

export interface ShipSettings {
  shipFrom: Address;
  boxes: Box[];
  services: Service[];
  rules: Rule[];
  defaultBoxId: string;
  defaultServiceId: string;
  /** ISO weekday numbers (1=Mon..7=Sun) that are ship days */
  shipDays: number[];
  /** states considered too hot to ship without ice, flagged on the board */
  hotStates: string[];
  /** Wix SKUs starting with this prefix are treated as wholesale orders */
  wholesaleSkuPrefix?: string;
}

export interface Assignment {
  orderId: string;
  boxId: string;
  serviceId: string;
  ruleId?: string;
  note?: string;
  /** true when the user overrode the rule result */
  manual: boolean;
  warnings: string[];
  /** total package weight in lbs (items + tare) */
  packageWeightLb: number;
}

export interface LabelRecord {
  orderId: string;
  orderNumber: string;
  carrier: string;
  service: string;
  trackingNumber: string;
  labelUrl?: string;
  costUsd?: number;
  purchasedAt: string;
  /** whether tracking was written back to Wix */
  syncedToStore: boolean;
  provider: "shippo" | "pirateship" | "manual";
}
