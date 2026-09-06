import type { ShipSettings } from "./types.js";

export const defaultSettings: ShipSettings = {
  shipFrom: {
    name: "Avocado Farm",
    street1: "123 Orchard Rd",
    city: "Fallbrook",
    state: "CA",
    zip: "92028",
    country: "US",
    phone: "5555555555",
    email: "orders@example.com",
  },
  boxes: [
    { id: "small", name: "Small box (6 avocados)", lengthIn: 10, widthIn: 8, heightIn: 6, tareLb: 0.6 },
    { id: "medium", name: "Medium box (12 avocados)", lengthIn: 12, widthIn: 10, heightIn: 8, tareLb: 0.9 },
    { id: "large", name: "Large box (24 avocados)", lengthIn: 16, widthIn: 12, heightIn: 10, tareLb: 1.4 },
  ],
  services: [
    { id: "usps_priority", name: "USPS Priority Mail", carrier: "usps", shippoToken: "usps_priority", pirateShipName: "USPS Priority Mail" },
    { id: "usps_ground", name: "USPS Ground Advantage", carrier: "usps", shippoToken: "usps_ground_advantage", pirateShipName: "USPS Ground Advantage" },
    { id: "ups_ground", name: "UPS Ground", carrier: "ups", shippoToken: "ups_ground", pirateShipName: "UPS Ground" },
    { id: "ups_2day", name: "UPS 2nd Day Air", carrier: "ups", shippoToken: "ups_second_day_air", pirateShipName: "UPS 2nd Day Air" },
  ],
  rules: [
    { id: "r-wholesale", name: "Wholesale → large box, UPS Ground", when: { channel: "wholesale" }, boxId: "large", serviceId: "ups_ground" },
    { id: "r-24", name: "24-pack → large box", when: { skus: ["AVO-24"] }, boxId: "large", serviceId: "usps_priority" },
    { id: "r-12", name: "12-pack → medium box", when: { skus: ["AVO-12"] }, boxId: "medium", serviceId: "usps_priority" },
    { id: "r-6", name: "6-pack → small box", when: { skus: ["AVO-6"] }, boxId: "small", serviceId: "usps_priority" },
    { id: "r-heavy", name: "Over 12 lb → UPS Ground", when: { minWeightLb: 12 }, boxId: "large", serviceId: "ups_ground" },
  ],
  defaultBoxId: "medium",
  defaultServiceId: "usps_priority",
  shipDays: [1, 3],
  hotStates: ["AZ", "NV", "TX", "FL"],
  wholesaleSkuPrefix: "WS-",
};
