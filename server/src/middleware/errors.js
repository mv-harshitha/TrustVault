import { recordAudit } from "../services/audit.js";

export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export async function errorHandler(error, req, res, _next) {
  if (error?.name === "MulterError") {
    try {
      await recordAudit(req, {
        action: "document.upload",
        outcome: "failure",
        metadata: { reason: error.code === "LIMIT_FILE_SIZE" ? "file_too_large" : "invalid_multipart_upload" }
      });
    } catch (auditError) {
      console.error(`[${req.id}] Failed to record multipart upload failure:`, auditError);
      return res.status(500).json({ error: "Unable to record upload failure" });
    }
    const message = error.code === "LIMIT_FILE_SIZE" ? "File exceeds the 10 MB limit" : "Invalid multipart upload";
    return res.status(400).json({ error: message });
  }
  if (error?.name === "ZodError") {
    return res.status(400).json({ error: "Invalid request", details: error.issues });
  }
  if (error?.status) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error?.code === 11000) {
    return res.status(409).json({ error: "A conflicting record already exists" });
  }
  if (error?.name === "CastError") {
    return res.status(400).json({ error: "Invalid resource identifier" });
  }
  if (error?.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: "Invalid request" });
  }
  console.error(`[${req.id}]`, error);
  return res.status(500).json({ error: "Internal server error" });
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
