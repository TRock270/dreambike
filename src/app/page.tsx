import { ModeBanner } from "@/components/ModeBanner";
import { Workspace } from "@/components/Workspace";
import { loadConfig } from "@/lib/server/config";

// Mode depends on server environment at request time, not at build time.
export const dynamic = "force-dynamic";

export default function Home() {
  const config = loadConfig();
  return (
    <div className="flex min-h-screen flex-col">
      <ModeBanner mode={config.mode} />
      <div className="px-6 py-3 text-[13px] min-[1280px]:hidden bg-warning-soft text-warning-soft-text">
        DreamBike is built for desktop screens at least 1280 px wide.
      </div>
      <header className="flex items-center gap-4 border-b border-hairline bg-surface-1 px-6 py-3">
        <h1 className="text-[20px] leading-[1.35] font-semibold">DreamBike</h1>
        <span className="text-text-muted text-[13px]">No project open</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" disabled className="rounded-full border border-hairline px-4 py-1.5 text-[13px] disabled:opacity-50">Undo</button>
          <button type="button" disabled className="rounded-full border border-hairline px-4 py-1.5 text-[13px] disabled:opacity-50">Redo</button>
          <button type="button" className="rounded-full border border-hairline bg-surface-2 px-4 py-1.5 text-[13px]">Settings</button>
        </div>
      </header>
      <Workspace />
      <nav aria-label="Sheet and estimate" className="flex gap-2 border-t border-hairline bg-surface-1 px-6 py-3">
        <button type="button" className="rounded-full bg-primary px-4 py-1.5 text-[13px] text-on-fill">Build sheet</button>
        <button type="button" className="rounded-full border border-hairline px-4 py-1.5 text-[13px]">Estimate</button>
      </nav>
    </div>
  );
}
