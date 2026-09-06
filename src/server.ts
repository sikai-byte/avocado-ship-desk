import { config, shippoEnabled, wixEnabled } from "./config.js";
import { createApp } from "./app.js";
import { MockOrderSource } from "./sources/mock.js";
import { WixOrderSource } from "./sources/wix.js";
import { ShippoClient } from "./labels/shippo.js";
import { store } from "./store.js";
import type { OrderSource } from "./sources/types.js";

let source: OrderSource;
if (config.orderSource === "wix") {
  if (!wixEnabled()) {
    console.error("ORDER_SOURCE=wix requires WIX_API_KEY and WIX_SITE_ID");
    process.exit(1);
  }
  source = new WixOrderSource({
    apiKey: config.wix.apiKey!,
    siteId: config.wix.siteId!,
    accountId: config.wix.accountId,
    wholesaleSkuPrefix: store.getSettings().wholesaleSkuPrefix,
  });
} else {
  source = new MockOrderSource();
}

const shippo = shippoEnabled() ? new ShippoClient({ apiKey: config.shippo.apiKey! }) : undefined;

const app = createApp({ source, shippo, appKey: config.appKey });
app.listen(config.port, () => {
  console.log(`Ship desk on http://localhost:${config.port}  source=${source.name}  shippo=${shippo ? "on" : "off"}`);
});
