import type { FitData } from "@/lib/types";
import { FIT_PRECHECK_NOTE } from "@/lib/project";
import { EvidenceLinks } from "./EvidenceLinks";

// "unknown" is always said out loud; it is never shown as fine.
const APPROVAL: Record<FitData["approval"], string> = {
  abe: "ABE", e_mark: "E-mark", teilegutachten: "Teilegutachten", none: "No approval", unknown: "unknown",
};
const COVERAGE: Record<FitData["documentCoverage"], string> = {
  covered: "Covers this bike", not_covered: "Does not cover this bike", unknown: "unknown",
};
const INSPECTION: Record<FitData["inspection"], string> = {
  none: "No inspection", aenderungsabnahme: "Änderungsabnahme", einzelabnahme: "Einzelabnahme", unknown: "unknown",
};
const EINTRAGUNG: Record<FitData["eintragung"], string> = { required: "Required", not_required: "Not required", unknown: "unknown" };
const CARRY: Record<FitData["carryDocuments"], string> = { required: "Carry the documents", not_required: "Not required", unknown: "unknown" };

function List({ label, items }: { label: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <dt className="text-text-secondary">{label}</dt>
      <dd><ul className="list-disc pl-4">{items.map((t, i) => <li key={i}>{t}</li>)}</ul></dd>
    </>
  );
}

/** Paperwork and fit details of one checked item. Always followed by the fixed pre-check note. */
export function PaperworkSummary({ fit }: { fit: FitData }) {
  const unknownClass = (v: string) => (v === "unknown" ? "text-warning-soft-text" : "");
  const rows: [string, string][] = [
    ["Approval", APPROVAL[fit.approval]], ["Document coverage", COVERAGE[fit.documentCoverage]],
    ["Inspection", INSPECTION[fit.inspection]], ["Eintragung", EINTRAGUNG[fit.eintragung]],
    ["Documents to carry", CARRY[fit.carryDocuments]],
  ];
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-text-secondary">{label}</dt>
            <dd className={unknownClass(value)}>{value === "unknown" && <span aria-hidden="true" className="mr-1">?</span>}{value}</dd>
          </div>
        ))}
        <List label="Reasons" items={fit.reasons} />
        <List label="Conditions" items={fit.conditions} />
        <List label="Things to measure" items={fit.toMeasure} />
        <List label="Extra parts" items={fit.extraParts} />
      </dl>
      <EvidenceLinks sources={fit.sources} />
      <p className="text-text-muted">{FIT_PRECHECK_NOTE}</p>
    </div>
  );
}
