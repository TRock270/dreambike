import { ModeBanner } from "@/components/ModeBanner";
import { Workspace } from "@/components/Workspace";
import { loadConfig } from "@/lib/server/config";

// Mode depends on server environment at request time, not at build time.
export const dynamic = "force-dynamic";

// Server component: reads the config and renders the banner. The header with Undo and Redo
// needs browser state, so it lives in the client AppShell that Workspace renders.
export default function Home() {
  const config = loadConfig();
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* shrink-0: the banner and the notice never scroll away or get squeezed. */}
      <div className="shrink-0">
        <ModeBanner mode={config.mode} />
      </div>
      <div className="shrink-0 px-6 py-3 text-[13px] min-[1280px]:hidden bg-warning-soft text-warning-soft-text">
        DreamBike is built for desktop screens at least 1280 px wide.
      </div>
      {/* Only this one flag reaches the client; no other config does. */}
      <Workspace referenceEnabled={config.features.reference} />
    </div>
  );
}
