// Stable error codes, safe user text, retry flags, and HTTP mapping (SPEC.md 5).
import type { ErrorCodeId } from "./types";

type ErrorInfo = { status: number; message: string; retryable: boolean };

export const ERRORS: Record<ErrorCodeId, ErrorInfo> = {
  INVALID_REQUEST: { status: 400, message: "The request was not valid.", retryable: false },
  INVALID_IMAGE: { status: 400, message: "The image could not be read.", retryable: false },
  UNSUPPORTED_FORMAT: { status: 415, message: "This file format is not supported.", retryable: false },
  TOO_LARGE: { status: 413, message: "The file is too large.", retryable: false },
  NO_RESULT: { status: 422, message: "The model returned no result.", retryable: true },
  MASK_PLACEMENT_UNKNOWN: { status: 422, message: "The part outline could not be placed on the photo.", retryable: false },
  UPSTREAM_TIMEOUT: { status: 504, message: "The AI service took too long. It may still be billed.", retryable: true },
  UPSTREAM_REJECTED: { status: 502, message: "The AI service rejected the request.", retryable: false },
  UPSTREAM_UNAVAILABLE: { status: 502, message: "The AI service is unavailable right now.", retryable: true },
  SCHEMA_INVALID: { status: 502, message: "The AI answer had an unexpected shape.", retryable: true },
  BUDGET_EXCEEDED: { status: 429, message: "Daily budget reached. Try again tomorrow, or explore the demo project. The demo uses cached results and makes no AI calls.", retryable: false },
  RATE_LIMITED: { status: 429, message: "The AI service is busy. Try again in a moment.", retryable: true },
  LIVE_DISABLED: { status: 503, message: "Live AI is off. The cached demo still works.", retryable: false },
  ACCOUNTING_UNAVAILABLE: { status: 503, message: "Live AI is temporarily unavailable. Your project is saved locally; the cached demo still works.", retryable: true },
  REQUEST_IN_PROGRESS: { status: 409, message: "This request is already running.", retryable: false },
  RESULT_NOT_CACHED: { status: 409, message: "This request already finished; start a new attempt.", retryable: false },
  FEATURE_DISABLED: { status: 503, message: "This feature is turned off.", retryable: false },
  FETCH_BLOCKED: { status: 403, message: "That address cannot be fetched. Enter the product details and source link manually.", retryable: false },
  STORAGE_FULL: { status: 507, message: "Browser storage is full. Delete a project to continue saving.", retryable: false },
  FORBIDDEN: { status: 403, message: "This request is not allowed.", retryable: false },
};

/** The exact HEIC message from SPEC 7. */
export const HEIC_MESSAGE =
  "HEIC is not supported in this demo. On your Mac, open the photo in Preview and export it as JPEG, then upload that file.";

export class AppError extends Error {
  constructor(public code: ErrorCodeId, message?: string, public retryAfterSeconds: number | null = null) {
    super(message ?? ERRORS[code].message);
  }
}
