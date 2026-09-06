import path from "node:path";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export const config = {
  port: Number(env("PORT") ?? 3100),
  dataDir: env("DATA_DIR") ?? path.resolve(process.cwd(), "data"),
  /** "mock" uses bundled sample orders; "wix" talks to the live store */
  orderSource: (env("ORDER_SOURCE") ?? (env("WIX_API_KEY") ? "wix" : "mock")) as "mock" | "wix",
  wix: {
    apiKey: env("WIX_API_KEY"),
    siteId: env("WIX_SITE_ID"),
    accountId: env("WIX_ACCOUNT_ID"),
  },
  shippo: {
    apiKey: env("SHIPPO_API_KEY"),
  },
  /** optional shared secret for the UI/API (sent as ?key= or x-api-key) */
  appKey: env("APP_KEY"),
};

export const shippoEnabled = () => Boolean(config.shippo.apiKey);
export const wixEnabled = () => Boolean(config.wix.apiKey && config.wix.siteId);
