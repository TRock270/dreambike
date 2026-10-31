import { ModeBanner } from "@/components/ModeBanner";
import type { PartSearchFlags } from "@/components/ProductFields";
import { Workspace } from "@/components/Workspace";
import { loadConfig } from "@/lib/server/config";

// Mode depends on server environment at request time, not at build time.
export const dynamic = "force-dynamic";

// Server component: reads the config and renders the banner. The header with Undo and Redo
// needs browser state, so it lives in the client AppShell that Workspace renders.
export default function Home() {
  const config = loadConfig();
  // Which "Find in your shops" features this server offers. Booleans only: the shop list itself never leaves the server.
  // Query search is a grounded (paid) search with no proven cost bound, so any deployment refuses it (same test as the route).
  const deployed = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV);
  const live = config.mode === "live";
  const shops = config.shopDomains !== null;
  const mock = config.mode === "mock";
  const partSearch: PartSearchFlags = {
    query: mock || (live && config.features.search && (config.searchQueryReserve ?? 0) >= 1 && shops && !deployed),
    url: mock || (live && shops),
    // Mock mode: the photo route returns a labeled placeholder, so the flag follows the mode there.
    photo: mock || (live && shops && config.features.reference),
  };
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* shrink-0: the banner and the notice never scroll away or get squeezed. */}
      <div className="shrink-0">
        <ModeBanner mode={config.mode} />
      </div>
      <div className="shrink-0 px-6 py-3 text-[13px] min-[1280px]:hidden bg-warning-soft text-warning-soft-text">
        DreamBike is built for desktop screens at least 1280 px wide.
      </div>
      {/* Only these values reach the client: the reference flag, the mode (already public through the banner) and three part-search booleans. No other config does. */}
      <Workspace referenceEnabled={config.features.reference} appMode={config.mode} partSearch={partSearch} />
    </div>
  );
}
