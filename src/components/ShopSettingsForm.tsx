"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PreflightError, normalizeLogo } from "@/lib/browser/preflight";
import { getStoredImage, isQuotaError, loadSettings, putLogo, putShopSettings, removeLogo, setProjectSettings, type DreamDb } from "@/lib/db";
import { formatEuroCents, parseEuroInput } from "@/lib/project";
import { EXAMPLE_LABEL, EXAMPLE_SETTINGS, grossToNet, REAL_SETTINGS_DEFAULT } from "@/lib/quote";
import { SLOTS } from "@/lib/slots";
import type { Project, ShopSettings, SlotId } from "@/lib/types";

type Props = {
  /** The open database, or null when local storage is unavailable. */
  h: DreamDb | null;
  /** Why nothing can be saved (read-only or unavailable storage), else null. */
  readOnlyReason: string | null;
  /** The open project, or null: then only the real shop record can be edited. */
  project: Project | null;
  /** The stored settings of the record in use. Null while Workspace is still loading them. */
  saved: ShopSettings | null;
  /** Why the stored settings could not be read (corrupt record), else null. Saving then replaces the record. */
  loadError?: string | null;
  /** Reads the stored settings again. */
  onRetry?: () => void;
  /** The project now points at another record. Workspace updates its session. */
  onProjectChanged: (project: Project) => void;
  /** The stored settings changed (save, logo). Workspace keeps them for the estimate. */
  onSettingsChanged: (owner: { projectId: string | null; settingsId: "default" | "example" }, settings: ShopSettings) => void;
  onClose: () => void;
};

const field = "rounded-full border border-hairline bg-surface-3 px-3 py-1.5 text-[13px] disabled:opacity-50";
const area = "rounded-inner border border-hairline bg-surface-3 px-3 py-2 text-[13px] disabled:opacity-50";
const buttonLine = "rounded-full border border-hairline px-4 py-1.5 text-[13px] disabled:opacity-50";
const buttonPrimary = "rounded-full bg-primary px-4 py-1.5 text-on-fill text-[13px] disabled:opacity-50";

const REAL_NAME = REAL_SETTINGS_DEFAULT.shopName;
const MAX_MINUTES = 10080;
const MAX_DOMAINS = 10;
const MAX_RULES = 12;
// Every slot except custom has a minutes field ("custom" stays unset by design, SPEC 11).
const MINUTE_SLOTS = SLOTS.filter((s) => s.id !== "custom");

/** The form keeps everything as text, so half-typed values are not lost. */
type Draft = {
  shopName: string; confirmed: boolean; rate: string; aenderung: string; einzel: string; official: string;
  minutes: Record<string, string>; domains: string; rules: string; notes: string;
};

/** Cents as typed euros the parser accepts, e.g. 123456 becomes "1234,56". */
const centsText = (c: number | null) => (c === null ? "" : `${Math.floor(c / 100)},${String(c % 100).padStart(2, "0")}`);

function draftFrom(s: ShopSettings): Draft {
  const minutes: Record<string, string> = {};
  for (const slot of MINUTE_SLOTS) {
    const found = s.laborBySlot.find((l) => l.slot === slot.id);
    minutes[slot.id] = found ? String(found.minutes) : "";
  }
  return {
    shopName: s.shopName, confirmed: s.shopConfirmed, rate: centsText(s.hourlyRateNetCents),
    aenderung: centsText(s.aenderungsabnahmeNetCents), einzel: centsText(s.einzelabnahmeNetCents),
    official: centsText(s.officialFeeCents), minutes, domains: s.preferredShopDomains.join("\n"),
    rules: s.shopRules.join("\n"), notes: s.quoteNotes,
  };
}

type Problems = Partial<Record<"shopName" | "confirmed" | "rate" | "aenderung" | "einzel" | "official" | "domains" | "rules" | "notes", string>> & {
  minutes: Record<string, string>;
};

/** Blank means unset (null), never 0. */
function euroField(text: string): { cents: number | null; error?: string } {
  if (text.trim() === "") return { cents: null };
  const r = parseEuroInput(text);
  return r.ok ? { cents: r.cents } : { cents: null, error: r.message };
}

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Turns the draft into settings, or says what is wrong. `base` keeps what the form does not edit. */
function buildSettings(d: Draft, base: ShopSettings): { settings: ShopSettings | null; problems: Problems } {
  const problems: Problems = { minutes: {} };
  const name = d.shopName.trim();
  if (name === "") problems.shopName = "Enter the shop name.";
  else if (name.length > 200) problems.shopName = "The shop name can have at most 200 characters.";
  const real = !base.demoRates;
  if (real && d.confirmed && name === REAL_NAME) problems.confirmed = "Enter your real shop name before you confirm it.";

  const rate = euroField(d.rate); if (rate.error) problems.rate = rate.error;
  const aen = euroField(d.aenderung); if (aen.error) problems.aenderung = aen.error;
  const ein = euroField(d.einzel); if (ein.error) problems.einzel = ein.error;
  const off = euroField(d.official); if (off.error) problems.official = off.error;

  const laborBySlot: { slot: SlotId; minutes: number }[] = [];
  for (const slot of MINUTE_SLOTS) {
    const t = (d.minutes[slot.id] ?? "").trim();
    if (t === "") continue; // empty means unset
    if (!/^\d+$/.test(t) || Number(t) > MAX_MINUTES) problems.minutes[slot.id] = `Whole minutes from 0 to ${MAX_MINUTES}, or leave empty.`;
    else laborBySlot.push({ slot: slot.id, minutes: Number(t) });
  }

  // Lowercase host names, one per line or separated by commas or spaces; duplicates collapse.
  const hosts = [...new Set(d.domains.split(/[\s,;]+/).map((t) => t.trim().toLowerCase()).filter((t) => t !== ""))];
  if (hosts.length > MAX_DOMAINS) problems.domains = `At most ${MAX_DOMAINS} shop domains.`;
  else if (hosts.some((t) => !HOST.test(t) || t.length > 253)) {
    problems.domains = "Use host names only, like example.com: no https://, path or spaces.";
  }
  const rules = d.rules.split("\n").map((t) => t.trim()).filter((t) => t !== "");
  if (rules.length > MAX_RULES) problems.rules = `At most ${MAX_RULES} rules, one per line.`;
  else if (rules.some((t) => t.length > 2000)) problems.rules = "One rule can have at most 2000 characters.";
  if (d.notes.length > 2000) problems.notes = "The notes can have at most 2000 characters.";

  const bad = Object.keys(problems).some((k) => k !== "minutes" && problems[k as keyof Problems]) || Object.keys(problems.minutes).length > 0;
  if (bad) return { settings: null, problems };
  return {
    problems,
    settings: {
      ...base, shopName: name, shopConfirmed: real ? d.confirmed : base.shopConfirmed,
      hourlyRateNetCents: rate.cents, aenderungsabnahmeNetCents: aen.cents, einzelabnahmeNetCents: ein.cents,
      officialFeeCents: off.cents, laborBySlot, preferredShopDomains: hosts, shopRules: rules, quoteNotes: d.notes,
    },
  };
}

function ErrorText({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return (
    <span id={id} className="text-danger-soft-text text-[12px]">
      <span aria-hidden="true" className="mr-1 font-semibold">✕</span>{text}
    </span>
  );
}

/** Net amount input with a helper that converts a gross amount (with 19% VAT) to net. */
function MoneyField({ label, value, onChange, error, disabled, withGross, hint }: {
  label: string; value: string; onChange: (v: string) => void; error?: string; disabled: boolean; withGross: boolean; hint?: string;
}) {
  const id = useId();
  const [gross, setGross] = useState("");
  const g = gross.trim() === "" ? null : parseEuroInput(gross);
  const net = g && g.ok ? grossToNet(g.cents) : null;
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-[13px]">
        {label}
        <input className={`${field} tabular w-[200px]`} inputMode="decimal" value={value} disabled={disabled} placeholder="Not set, e.g. 100,00"
          onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} />
      </label>
      <ErrorText id={`${id}-err`} text={error} />
      {hint && <span className="text-text-muted text-[12px]">{hint}</span>}
      {withGross && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <label className="flex items-center gap-2">
            <span className="text-text-secondary">Only know the gross amount?</span>
            <input className={`${field} tabular w-[140px] py-1`} inputMode="decimal" value={gross} disabled={disabled} aria-label={`${label}: gross amount with 19% VAT`}
              placeholder="gross, e.g. 119,00" onChange={(e) => setGross(e.target.value)} />
          </label>
          {g && !g.ok && <span className="text-danger-soft-text"><span aria-hidden="true">✕ </span>{g.message}</span>}
          {net !== null && (
            <>
              <span role="status" className="tabular">= {formatEuroCents(net)} net</span>
              <button type="button" disabled={disabled} className={`${buttonLine} px-3 py-0.5`}
                onClick={() => { onChange(centsText(net)); setGross(""); }}>Use net amount</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The owned logo: preview, upload and remove. Each action saves at once through db.ts. */
function LogoField({ h, settingsId, settings, disabled, onSettingsChanged }: {
  h: DreamDb | null; settingsId: string; settings: ShopSettings; disabled: boolean; onSettingsChanged: (s: ShopSettings) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inFlight = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoId = settings.logoImageId;

  // Read the stored logo and show it through an object URL; the cleanup frees it (the browser keeps it otherwise).
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    if (!h || !logoId) { queueMicrotask(() => { if (alive) setUrl(null); }); return; }
    getStoredImage(h, logoId).then((img) => {
      if (!alive) return;
      if (img) { made = URL.createObjectURL(img.blob); setUrl(made); } else setUrl(null);
    }).catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [h, logoId]);

  async function run(work: () => Promise<ShopSettings>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      onSettingsChanged(await work());
    } catch (e) {
      setProblem(
        e instanceof PreflightError ? e.message
          : isQuotaError(e) ? "Browser storage is full, so the logo is not saved. Delete a saved project, then try again."
          : e instanceof Error ? e.message : "The logo could not be saved.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
      if (fileRef.current) fileRef.current.value = ""; // the same file can be picked again
    }
  }

  function upload(file: File) {
    if (!h) return;
    void run(async () => {
      const logo = await normalizeLogo(file);
      return putLogo(h, logo.blob, { id: crypto.randomUUID(), width: logo.width, height: logo.height, now: Date.now() }, settingsId);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold">Logo</span>
      <div className="flex items-center gap-3">
        <div className="flex h-[64px] w-[96px] items-center justify-center rounded-inner border border-hairline bg-recess">
          {/* An object URL of the owner's own logo: the Next image optimizer cannot read it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url ? <img src={url} alt={`${settings.shopName} logo`} className="max-h-full max-w-full object-contain" />
            : <span className="text-text-muted text-[12px]">No logo</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label className={`${buttonLine} cursor-pointer text-center focus-within:outline focus-within:outline-2 ${disabled || busy ? "opacity-50" : ""}`}>
            {busy ? "Saving logo…" : logoId ? "Replace logo" : "Upload logo"}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={disabled || busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
          </label>
          {logoId && (
            <button type="button" disabled={disabled || busy || !h} className={buttonLine}
              onClick={() => { if (h) void run(() => removeLogo(h, settingsId)); }}>Remove logo</button>
          )}
        </div>
      </div>
      <p className="text-text-muted text-[12px]">PNG, JPEG or WebP. It is shrunk to 512 px and stays on this device. No SVG. Use only a logo your shop owns.</p>
      {problem && (
        <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">✕</span>{problem}
        </p>
      )}
    </div>
  );
}

/** What the mechanic still has to enter before a real estimate can be complete. */
function missingReal(s: ShopSettings): string[] {
  const out: string[] = [];
  if (s.shopName === REAL_NAME || s.shopName.trim() === "") out.push("shop name");
  if (!s.shopConfirmed) out.push("shop identity confirmation");
  if (s.hourlyRateNetCents === null) out.push("hourly rate");
  return out;
}

function Body({ h, readOnlyReason, project, saved, savedId, loadError, onRetry, onProjectChanged, onSettingsChanged, onClose }: Props & { saved: ShopSettings; savedId: "default" | "example" }) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(saved));
  const [switchTo, setSwitchTo] = useState<"default" | "example" | null>(null);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string; full: boolean }>({ kind: "idle" });
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const inFlight = useRef(false); // blocks a second click before React has re-rendered the disabled button
  const switchFlight = useRef(false);
  // Do the shop rules of the other record differ from this one? null = not known (not read yet, or unreadable).
  const [rulesDiffer, setRulesDiffer] = useState<{ to: string; differ: boolean } | null>(null);
  useEffect(() => {
    if (!h || !switchTo) return;
    let alive = true;
    loadSettings(h, switchTo)
      .then((rec) => { if (alive) setRulesDiffer({ to: switchTo, differ: JSON.stringify(rec.settings.shopRules) !== JSON.stringify(saved.shopRules) }); })
      .catch(() => { if (alive) setRulesDiffer(null); });
    return () => { alive = false; };
  }, [h, switchTo, saved.shopRules]);

  const example = saved.demoRates;
  const replacing = !!loadError && state.kind !== "saved"; // the defaults are shown in place of an unreadable record
  const locked = readOnlyReason !== null || h === null;
  // A corrupt stored record counts as unsaved: the shown defaults are not what is stored.
  const dirty = replacing || JSON.stringify(draft) !== JSON.stringify(draftFrom(saved));
  const { settings: built, problems } = buildSettings(draft, saved);
  const set = (patch: Partial<Draft>) => { setDraft((d) => ({ ...d, ...patch })); setState({ kind: "idle" }); };
  const missing = example ? [] : missingReal(saved);

  async function save() {
    if (!h || locked || !built || inFlight.current) return;
    inFlight.current = true;
    setState({ kind: "saving" });
    try {
      await putShopSettings(h, savedId, built, Date.now());
      // The db keeps the stored logo id; the form never edits it.
      const stored = { ...built, logoImageId: saved.logoImageId };
      onSettingsChanged({ projectId: project?.id ?? null, settingsId: savedId }, stored);
      // Show the normalized values that were stored (e.g. "95" becomes "95,00"), so "dirty" is false again.
      setDraft(draftFrom(stored));
      setState({ kind: "saved" });
    } catch (e) {
      const full = isQuotaError(e);
      setState({
        kind: "error", full,
        message: full ? "Browser storage is full, so the settings are not saved. Delete a saved project, then save again."
          : e instanceof Error ? e.message : "The settings could not be saved.",
      });
    } finally {
      inFlight.current = false;
    }
  }

  async function confirmSwitch() {
    if (!h || !project || !switchTo || switchFlight.current) return;
    switchFlight.current = true;
    setSwitching(true);
    setSwitchError(null);
    try {
      onProjectChanged(await setProjectSettings(h, project.id, switchTo));
      setSwitchTo(null);
    } catch (e) {
      setSwitchError(e instanceof Error ? e.message : "The shop could not be changed.");
    } finally {
      switchFlight.current = false;
      setSwitching(false);
    }
  }

  const minuteIssues = Object.keys(problems.minutes).length;
  const err = (k: string) => `shop-${k}-err`;

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-4">
      {readOnlyReason && (
        <p role="status" className="rounded-chip bg-neutral-soft px-3 py-2 text-neutral-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">ⓘ</span>{readOnlyReason}
        </p>
      )}
      {loadError && state.kind !== "saved" && (
        <div role="alert" className="flex flex-col gap-2 rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
          <p><span aria-hidden="true" className="mr-1 font-semibold">✕</span>The stored settings could not be read: {loadError} The default values are shown. Saving replaces the unreadable record.</p>
          {onRetry && <button type="button" onClick={onRetry} className={`${buttonLine} self-start text-text`}>Try reading again</button>}
        </div>
      )}

      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" disabled={locked || switching}>
        <legend className="mb-1 p-0 text-[15px] font-semibold">Shop for this project</legend>
        {project ? (
          <>
            {(["default", "example"] as const).map((id) => (
              <label key={id} className="flex items-center gap-2 text-[13px]">
                <input type="radio" name="shop-record" checked={project.settingsId === id}
                  onChange={() => { if (project.settingsId !== id) { setSwitchTo(id); setSwitchError(null); } }} />
                {id === "default" ? "Your shop" : EXAMPLE_LABEL}
              </label>
            ))}
            {switchTo && (
              <div role="group" aria-label="Confirm the shop change" className="flex flex-col gap-2 rounded-chip bg-warning-soft p-3 text-warning-soft-text text-[13px]">
                <p>
                  <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>
                  Switching to {switchTo === "default" ? "your shop" : "the example shop"}{rulesDiffer && rulesDiffer.to === switchTo
                    ? rulesDiffer.differ
                      ? ": its shop rules differ, so existing fit checks become stale and need a new check."
                      : ": its shop rules are the same, so existing fit checks stay current."
                    : ". If the shop rules differ, existing fit checks become stale and need a new check."}
                  {" "}The photo and the sheet stay as they are.
                  {dirty && " Unsaved changes in this form will be lost."}
                </p>
                {switchError && <p role="alert"><span aria-hidden="true" className="mr-1 font-semibold">✕</span>{switchError}</p>}
                <div className="flex gap-2">
                  <button type="button" disabled={switching} onClick={() => void confirmSwitch()} className={buttonPrimary}>
                    {switching ? "Switching…" : "Switch shop"}
                  </button>
                  <button type="button" disabled={switching} onClick={() => setSwitchTo(null)}
                    className="rounded-full border border-hairline bg-surface-3 px-4 py-1.5 text-text text-[13px] disabled:opacity-50">Keep current shop</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-text-muted text-[13px]">No project is open, so this edits your shop. Open a project to choose its shop.</p>
        )}
      </fieldset>

      <h3 className="text-[15px] font-semibold">
        {example ? "Example shop values" : "Your shop values"}
      </h3>
      {example && (
        <p role="note" className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>{EXAMPLE_LABEL}. These values are made up and never become your real shop settings.
        </p>
      )}
      {!example && missing.length > 0 && (
        <p role="status" className="rounded-chip bg-neutral-soft px-3 py-2 text-neutral-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">ⓘ</span>
          Enter your real shop identity: still missing {missing.join(", ")}. Without them every estimate stays an incomplete draft.
        </p>
      )}

      {h === null ? null : (
        <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={locked}>
          <label className="flex flex-col gap-1 text-[13px]">
            Shop name
            <input className={field} value={draft.shopName} maxLength={200} onChange={(e) => set({ shopName: e.target.value })}
              aria-invalid={!!problems.shopName} aria-describedby={problems.shopName ? err("name") : undefined} />
          </label>
          <ErrorText id={err("name")} text={problems.shopName} />
          {!example && (
            <>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={draft.confirmed} onChange={(e) => set({ confirmed: e.target.checked })}
                  aria-describedby={problems.confirmed ? err("confirm") : undefined} />
                I confirm this is the real identity of my shop
              </label>
              <ErrorText id={err("confirm")} text={problems.confirmed} />
            </>
          )}

          <LogoField h={h} settingsId={savedId} settings={saved} disabled={locked}
            onSettingsChanged={(s) => onSettingsChanged({ projectId: project?.id ?? null, settingsId: savedId }, s)} />

          <div className="flex flex-col gap-3">
            <h3 className="text-[15px] font-semibold">Rates and allowances (net, without VAT)</h3>
            <MoneyField label="Hourly rate (EUR net)" value={draft.rate} onChange={(v) => set({ rate: v })} error={problems.rate} disabled={locked} withGross />
            <MoneyField label="Änderungsabnahme (EUR net)" value={draft.aenderung} onChange={(v) => set({ aenderung: v })} error={problems.aenderung} disabled={locked} withGross
              hint="Estimated allowance for a modification inspection." />
            <MoneyField label="Einzelabnahme (EUR net)" value={draft.einzel} onChange={(v) => set({ einzel: v })} error={problems.einzel} disabled={locked} withGross
              hint="Estimated allowance for an individual approval." />
            <MoneyField label="Official fee, Zulassungsstelle (EUR)" value={draft.official} onChange={(v) => set({ official: v })} error={problems.official} disabled={locked} withGross={false}
              hint="Official fee, no VAT: it is added to the net total and VAT is not charged on it." />
            <p className="text-[13px]">VAT <span className="tabular rounded-chip bg-neutral-soft px-2 py-0.5 text-neutral-soft-text">19 %</span> <span className="text-text-muted">fixed, cannot be changed</span></p>
          </div>

          <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
            <legend className="mb-1 p-0 text-[15px] font-semibold">Labor minutes per part</legend>
            <p className="text-text-muted text-[12px]">
              The starting point for a part without its own minutes. Empty means not set, and the estimate then shows the labor as missing.
              {example && " These are illustrative minutes."}
            </p>
            {minuteIssues > 0 && <p role="alert" className="text-danger-soft-text text-[12px]"><span aria-hidden="true" className="mr-1 font-semibold">✕</span>Fix the {minuteIssues} marked minutes field{minuteIssues === 1 ? "" : "s"}.</p>}
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {MINUTE_SLOTS.map((slot) => {
                const issue = problems.minutes[slot.id];
                return (
                  <div key={slot.id} className="flex flex-col gap-0.5">
                    <label className="flex items-center justify-between gap-2 text-[13px]">
                      {slot.label}
                      <input className={`${field} tabular w-[84px] py-1`} inputMode="numeric" value={draft.minutes[slot.id] ?? ""} placeholder="Not set"
                        aria-label={`${slot.label} labor minutes`} aria-invalid={!!issue} aria-describedby={issue ? err(`min-${slot.id}`) : undefined}
                        onChange={(e) => set({ minutes: { ...draft.minutes, [slot.id]: e.target.value } })} />
                    </label>
                    <ErrorText id={err(`min-${slot.id}`)} text={issue} />
                  </div>
                );
              })}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1 text-[13px]">
            Preferred shop domains (ranking only, at most {MAX_DOMAINS})
            <textarea className={`${area} tabular`} rows={3} value={draft.domains} placeholder="one host per line, e.g. example.com" onChange={(e) => set({ domains: e.target.value })}
              aria-invalid={!!problems.domains} aria-describedby={`${err("domains")} shop-domains-hint`} />
          </label>
          <span id="shop-domains-hint" className="text-text-muted text-[12px]">Only used to rank search results. They never allow more sites than the server allows.</span>
          <ErrorText id={err("domains")} text={problems.domains} />

          <label className="flex flex-col gap-1 text-[13px]">
            Shop rules (plain text, one per line, at most {MAX_RULES})
            <textarea className={area} rows={4} value={draft.rules} onChange={(e) => set({ rules: e.target.value })}
              aria-invalid={!!problems.rules} aria-describedby={problems.rules ? err("rules") : undefined} />
          </label>
          <ErrorText id={err("rules")} text={problems.rules} />

          <label className="flex flex-col gap-1 text-[13px]">
            Quote notes
            <textarea className={area} rows={3} value={draft.notes} onChange={(e) => set({ notes: e.target.value })}
              aria-invalid={!!problems.notes} aria-describedby={problems.notes ? err("notes") : undefined} />
          </label>
          <ErrorText id={err("notes")} text={problems.notes} />
        </fieldset>
      )}

      {state.kind === "error" && (
        <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">✕</span>{state.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={locked || !dirty || !built || state.kind === "saving"} className={buttonPrimary}>
          {state.kind === "saving" ? "Saving…" : "Save settings"}
        </button>
        <button type="button" onClick={onClose} disabled={state.kind === "saving"} className={buttonLine}>Back to editor</button>
        <span role="status" aria-live="polite" className="text-[13px]">
          {state.kind === "saved" && !dirty && <span className="text-success-soft-text"><span aria-hidden="true">✓ </span>Saved locally</span>}
          {dirty && state.kind !== "saving" && <span className="text-warning-soft-text"><span aria-hidden="true">⚠ </span>Unsaved changes{!built ? ": fix the marked fields first" : ""}</span>}
        </span>
      </div>
    </form>
  );
}

/**
 * Settings panel: choose the project's shop record and edit the chosen one.
 * Values are typed as text; nothing is stored until "Save settings". Money is integer cents via parseEuroInput.
 */
export function ShopSettingsForm(props: Props) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []); // keyboard users land on the panel when it opens
  const id = props.project?.settingsId === "example" ? "example" : "default";
  // Never show "Loading" for good: unreadable or unavailable storage shows the defaults with the reason.
  const fallback = id === "default" ? REAL_SETTINGS_DEFAULT : EXAMPLE_SETTINGS;
  const shown = props.saved ?? (props.loadError || props.h === null ? fallback : null);
  return (
    <div className="flex flex-col gap-3">
      <h2 ref={titleRef} tabIndex={-1} className="text-[20px] leading-[1.35]">Settings</h2>
      {shown === null ? (
        <p role="status" className="text-text-muted text-[13px]">Loading the shop settings…</p>
      ) : (
        // The key restarts the form (a fresh draft) when another project or shop record is shown.
        <Body key={`${props.project?.id ?? "none"}:${id}`} {...props} saved={shown} savedId={id} />
      )}
    </div>
  );
}
