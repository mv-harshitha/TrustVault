import AuditEvent from "../models/AuditEvent.js";

export async function recordAudit(req, event) {
  const route = req.route?.path;
  const safeRequestMetadata = {
    method: req.method,
    ...(typeof route === "string" ? { route: `${req.baseUrl}${route}`.slice(0, 300) } : {})
  };
  await AuditEvent.create({
    actor: event.actor ?? req.user?._id ?? null,
    company: event.company ?? req.membership?.company?._id ?? null,
    action: event.action,
    document: event.document ?? null,
    outcome: event.outcome,
    description: event.description,
    metadata: { ...safeRequestMetadata, ...(event.metadata || {}) },
    requestId: req.id || null
  });
}
