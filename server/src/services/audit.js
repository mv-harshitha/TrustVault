import AuditEvent from "../models/AuditEvent.js";

export async function recordAudit(req, event) {
  await AuditEvent.create({
    actor: event.actor ?? req.user?._id ?? null,
    company: event.company ?? req.membership?.company?._id ?? null,
    action: event.action,
    document: event.document ?? null,
    outcome: event.outcome,
    description: event.description,
    metadata: event.metadata || {},
    requestId: req.id || null
  });
}
