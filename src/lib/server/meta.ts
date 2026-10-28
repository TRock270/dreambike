// The only module that reads MODEL_API_KEY and talks to the Meta API (SPEC.md 6).
// Server only: importing this from a client component fails the build.
// T1 provides the boundary and mock dispatch; the wire functions arrive with
// their tickets (segment T3, identify/instruction T4, edit T5, check T9).
import "server-only";
import { AppError } from "../errors";
import { MOCKS, type MockName } from "../mocks";
import { loadConfig } from "./config";

export const META_BASE = "https://api.meta.ai/v1";

/** Bearer header for one request. The key never leaves this module. */
export function authHeader(): { Authorization: string } {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new AppError("LIVE_DISABLED");
  return { Authorization: `Bearer ${key}` };
}

/**
 * Mock dispatch for local UI work (MOCK=1, never production). Returns a
 * labeled fixture; it never touches the network or the budget ledger.
 */
export function mockResponse<N extends MockName>(name: N): (typeof MOCKS)[N] {
  if (loadConfig().mode !== "mock") throw new AppError("LIVE_DISABLED");
  return MOCKS[name];
}
