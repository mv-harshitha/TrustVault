import { Router } from "express";
import AuditEvent from "../models/AuditEvent.js";
import Document from "../models/Document.js";
import { asyncHandler, httpError } from "../middleware/errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", requireRole("admin"), asyncHandler(async (req, res) => {
  const events = await AuditEvent.find({ company: req.membership.company._id })
    .sort({ createdAt: -1 }).limit(100).populate("actor", "name email");
  res.json({ events });
}));

router.get("/documents/:id", asyncHandler(async (req, res) => {
  const document = await Document.findOne({ _id: req.params.id, company: req.membership.company._id });
  if (!document) throw httpError(404, "Document not found");
  if (req.membership.role !== "admin" && String(document.owner) !== String(req.user._id)) {
    throw httpError(403, "Only the owner or an administrator can view this audit trail");
  }
  const events = await AuditEvent.find({ company: req.membership.company._id, document: document._id })
    .sort({ createdAt: -1 }).limit(100).populate("actor", "name email");
  res.json({ events });
}));

export default router;
