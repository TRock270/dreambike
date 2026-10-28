"use client";

import { useState } from "react";
import { confirmBike, editField, parseYear, type BikeFormState } from "@/lib/bikeForm";
import type { BikeData } from "@/lib/types";

type Props = {
  form: BikeFormState;
  identifyStatus: "pending" | "done" | "error" | "off";
  identifyMessage: string | null;
  onChange: (next: BikeFormState) => void;
};

const FAMILIES: BikeData["family"][] = ["unknown", "sportster", "softail", "dyna", "touring", "street", "other"];
const input = "rounded-full border border-hairline bg-surface-3 px-3 py-1.5 text-[13px]";
type YearKey = "yearFrom" | "yearTo";

/**
 * One editable panel for the bike's identity. The mechanic can type at once;
 * the AI suggestion only fills untouched fields. Unknown is a valid answer.
 * The parent keys this component by photo, so typed text never leaks between photos.
 */
export function BikeConfirm({ form, identifyStatus, identifyMessage, onChange }: Props) {
  const [open, setOpen] = useState(true);
  // What the mechanic typed in each year box; null = not typed, show the current value.
  const [yearText, setYearText] = useState<Record<YearKey, string | null>>({ yearFrom: null, yearTo: null });
  const [error, setError] = useState<string | null>(null);
  const b = form.bike;

  function change(next: BikeFormState) {
    setError(null);
    onChange(next);
  }
  const text = (field: "make" | "model" | "engine" | "style", label: string) => (
    <label className="flex flex-col gap-1 text-[13px]">
      {label}
      <input className={input} value={b[field] ?? ""} maxLength={200} placeholder="Unknown"
        onChange={(e) => change(editField(form, field, e.target.value.trim() === "" ? null : e.target.value))} />
    </label>
  );
  function setYear(field: YearKey, value: string) {
    setYearText((y) => ({ ...y, [field]: value }));
    const parsed = parseYear(value);
    // A half-typed year is "unknown" for now, but the field is the mechanic's from the first keystroke.
    change(editField(form, field, parsed === "invalid" ? null : parsed));
  }
  const yearInvalid = (field: YearKey) => yearText[field] !== null && parseYear(yearText[field]!) === "invalid";
  const yearBox = (field: YearKey, label: string) => (
    <label className="flex flex-col gap-1 text-[13px]">
      {label}
      <input className={`${input} tabular`} inputMode="numeric" placeholder="Unknown" maxLength={4}
        aria-invalid={yearInvalid(field)} aria-describedby={yearInvalid(field) ? "bike-year-error" : undefined}
        value={yearText[field] ?? b[field]?.toString() ?? ""} onChange={(e) => setYear(field, e.target.value)} />
    </label>
  );
  const anyYearInvalid = yearInvalid("yearFrom") || yearInvalid("yearTo");

  return (
    <section aria-labelledby="bike-title" className="rounded-card border border-hairline bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="bike-title" className="text-[15px] font-semibold">Bike</h3>
        <span className={`rounded-chip px-2 py-0.5 text-[12px] ${form.confirmed ? "bg-success-soft text-success-soft-text" : "bg-neutral-soft text-neutral-soft-text"}`}>
          <span aria-hidden="true" className="mr-1">{form.confirmed ? "✓" : "○"}</span>{form.confirmed ? "Confirmed" : "Not confirmed"}
        </span>
      </div>
      <p aria-live="polite" className="mt-1 text-text-muted text-[12px]">
        {identifyStatus === "pending" && "AI suggestion loading… You can type now."}
        {identifyStatus === "done" && form.suggested && form.revision === 0 && "Untouched fields show the AI suggestion. Check every field."}
        {identifyStatus === "error" && `No AI suggestion. ${identifyMessage ?? "Identification failed."} Enter what you know.`}
        {identifyStatus === "off" && "Enter what you know. Unknown is fine."}
      </p>
      <button type="button" aria-expanded={open} aria-controls="bike-fields" onClick={() => setOpen((o) => !o)}
        className="mt-1 text-[13px] underline underline-offset-2">
        {open ? "Hide details" : "Edit details"}
      </button>
      {open && (
        <div id="bike-fields" className="mt-2 grid grid-cols-2 gap-2">
          {text("make", "Make")}
          {text("model", "Model")}
          <label className="flex flex-col gap-1 text-[13px]">
            Family
            <select className={input} value={b.family} onChange={(e) => change(editField(form, "family", e.target.value as BikeData["family"]))}>
              {FAMILIES.map((f) => <option key={f} value={f}>{f === "unknown" ? "Unknown" : f[0]!.toUpperCase() + f.slice(1)}</option>)}
            </select>
          </label>
          {text("engine", "Engine")}
          {yearBox("yearFrom", "Year from")}
          {yearBox("yearTo", "Year to")}
          <label className="flex flex-col gap-1 text-[13px]">
            ABS
            <select className={input} value={b.abs} onChange={(e) => change(editField(form, "abs", e.target.value as BikeData["abs"]))}>
              <option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Front wheel in photo
            <select className={input} value={b.facing} onChange={(e) => change(editField(form, "facing", e.target.value as BikeData["facing"]))}>
              <option value="unknown">Unknown</option><option value="left">Left</option><option value="right">Right</option>
            </select>
          </label>
          <div className="col-span-2">{text("style", "Style")}</div>
        </div>
      )}
      {anyYearInvalid && (
        <p id="bike-year-error" role="alert" className="mt-2 rounded-chip bg-danger-soft px-2 py-1 text-danger-soft-text text-[12px]">
          <span aria-hidden="true" className="mr-1 font-semibold">✕</span>Enter a four-digit year or leave it empty.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-chip bg-danger-soft px-2 py-1 text-danger-soft-text text-[12px]">
          <span aria-hidden="true" className="mr-1 font-semibold">✕</span>{error}
        </p>
      )}
      <button type="button" disabled={anyYearInvalid}
        onClick={() => {
          const next = confirmBike(form);
          if (next) change(next);
          else setError("The bike details are inconsistent. Check that the first year is not after the last year.");
        }}
        className="mt-3 rounded-full bg-primary px-4 py-1.5 text-on-fill text-[13px] disabled:opacity-50">
        {form.confirmed ? "Confirm again" : "Confirm bike"}
      </button>
      {form.confirmed && form.bike.limitations.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-text-secondary text-[12px]">
          {form.bike.limitations.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
    </section>
  );
}
