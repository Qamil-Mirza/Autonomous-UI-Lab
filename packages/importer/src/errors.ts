/** Every way an import can fail, each with a message the designer can act on. */
export type ImportErrorCode =
  | "ARCHIVE_TOO_LARGE"
  | "ARCHIVE_MALFORMED"
  | "ARCHIVE_UNSUPPORTED"
  | "ARCHIVE_UNSAFE_PATH"
  | "ARCHIVE_SYMLINK"
  | "ARCHIVE_TOO_MANY_FILES"
  | "ARCHIVE_TOO_LARGE_EXTRACTED"
  | "ARCHIVE_DUPLICATE_PATH"
  | "NO_APP_ROOT"
  | "AMBIGUOUS_APP_ROOT"
  | "INVALID_PACKAGE_JSON"
  | "UNSUPPORTED_FRAMEWORK"
  | "MISSING_VITE_CONFIG"
  | "MISSING_INDEX_HTML"
  | "RUNTIME_UNAVAILABLE"
  | "INSTALL_FAILED"
  | "BUILD_FAILED"
  | "PREVIEW_FAILED"
  | "CANCELLED"
  | "TIMEOUT"
  | "INVALID_TASK"
  | "INVALID_STATE"
  | "NOT_FOUND"
  | "PATCH_REJECTED";

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
    /** What the designer can do about it. */
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export const errorInfo = (err: unknown): { code: ImportErrorCode | "INTERNAL"; message: string; hint?: string } =>
  err instanceof ImportError
    ? { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) }
    : { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) };
