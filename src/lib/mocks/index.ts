// Labeled mock responses for MOCK=1 UI work. Every mock says it is a mock in
// visible text so it can never pass for a real model result or a real check.
import { LEGAL_SEED } from "../project";
import type { BikeData, FitData, InstructionData, ProductData, SearchRequestData, SearchResponseData } from "../types";

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

/** The mock fit result for one item; carries one seeded legal link so the source UI can be checked offline. */
export function mockFitFor(itemId: string, accessedAt: string): FitData {
  const seed = LEGAL_SEED.sources[1];
  return {
    ...fit, itemId,
    sources: seed ? [{ url: seed.url, title: `Mock source (not researched): ${seed.title}`, accessedAt,
      supports: `${MOCK_LABEL}. A seeded law link, not evidence for this part.` }] : [],
  };
}

/** Labeled mock search answer: example hosts only, no price, nothing fetched and nothing from a model. */
export function mockSearchResponse(request: SearchRequestData, searchedAt: string): SearchResponseData {
  const make = (n: number): ProductData => ({
    id: crypto.randomUUID(), name: `${MOCK_LABEL}: sample part ${n}`, brand: null, partNumber: null,
    url: `https://shop.example/mock-product-${n}`, imageUrl: null, priceText: null, priceEurCents: null,
    taxBasis: "unknown", approval: "unknown", approvalText: null, fulfillmentRegion: "unknown",
    source: { url: `https://shop.example/mock-product-${n}`, title: `${MOCK_LABEL}: example page`, accessedAt: searchedAt,
      supports: `${MOCK_LABEL}. Nothing was searched or read.` },
    linkState: "unchecked",
  });
  return {
    products: request.mode === "query" ? [make(1), make(2)] : [make(1)], searchedAt,
    warnings: [`${MOCK_LABEL}. No shop was searched; enter the real product by hand.`],
  };
}

export const MOCKS = { identify: { bike }, instruction: { instruction }, fit } as const;
export type MockName = keyof typeof MOCKS;
