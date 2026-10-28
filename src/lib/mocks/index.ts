// Labeled mock responses for MOCK=1 UI work. Every mock says it is a mock in
// visible text so it can never pass for a real model result or a real check.
import type { BikeData, FitData, InstructionData } from "../types";

export const MOCK_LABEL = "Mock data — not from an AI model";

const bike: BikeData = {
  make: null, model: null, family: "unknown", engine: null, yearFrom: null, yearTo: null,
  abs: "unknown", style: null, facing: "unknown", confidence: 0,
  limitations: [`${MOCK_LABEL}. Enter the real bike details.`],
};

const instruction: InstructionData = {
  title: "Mock: tank paint",
  editPrompt: "Mock instruction: repaint the fuel tank in the upper middle of the image. Keep everything else in the photo unchanged.",
  spec: [{ key: "finish", value: "mock" }],
  intent: "paint",
  warnings: [MOCK_LABEL],
};

const fit: FitData = {
  itemId: "00000000-0000-4000-8000-000000000001",
  status: "verify", approval: "unknown", documentCoverage: "unknown", inspection: "unknown",
  eintragung: "unknown", carryDocuments: "unknown",
  reasons: [`${MOCK_LABEL}. No fit or paperwork research was done.`],
  toMeasure: [], extraParts: [], conditions: [], sources: [], confidence: 0,
};

export const MOCKS = { identify: { bike }, instruction: { instruction }, fit } as const;
export type MockName = keyof typeof MOCKS;
