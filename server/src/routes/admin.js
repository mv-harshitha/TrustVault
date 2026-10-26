import { Router } from "express";
import Membership from "../models/Membership.js";
import Document from "../models/Document.js";
import AuditEvent from "../models/AuditEvent.js";
import { asyncHandler, httpError } from "../middleware/errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { recordAudit } from "../services/audit.js";
import { adminUserUpdateSchema } from "../validators/index.js";

const router = Router();
router.use(requireAuth);
router.use(requireRole("admin"));

router.get("/stats", asyncHandler(async (req, res) => {
  const companyId = req.membership.company._id;
  const [userCount, documentCount, storageAgg, recentEvents] = await Promise.all([
    Membership.countDocuments({ company: companyId }),
    Document.countDocuments({ company: companyId }),
    Document.aggregate([
      { $match: { company: companyId } },
      { $group: { _id: null, totalBytes: { $sum: "$size" } } }
    ]),
    AuditEvent.find({ company: companyId }).sort({ createdAt: -1 }).limit(8).populate("actor", "name email")
  ]);
  res.json({
    users: userCount,
    documents: documentCount,
    storageBytes: storageAgg[0]?.totalBytes || 0,
    recentActivity: recentEvents
  });
}));

router.get("/users", asyncHandler(async (req, res) => {
  const companyId = req.membership.company._id;
  const search = String(req.query.search || "").trim().toLowerCase();
  const roleFilter = String(req.query.role || "").trim();
  const memberships = await Membership.find({ company: companyId }).populate("user", "name email disabled avatar createdAt").sort({ createdAt: 1 });
  const members = memberships
    .filter(({ user, role }) => {
      if (!user) return false;
      if (roleFilter && role !== roleFilter) return false;
      if (!search) return true;
      return user.name.toLowerCase().includes(search) || user.email.toLowerCase().includes(search);
    })
    .map(({ user, role, createdAt }) => ({
      id: user._id,
      name: user.name,
      email: user.email,
      role,
      disabled: Boolean(user.disabled),
      avatar: user.avatar || "",
      joinedAt: createdAt
    }));
  res.json({ members });
}));

router.patch("/users/:userId", asyncHandler(async (req, res) => {
  const input = adminUserUpdateSchema.parse(req.body);
  const companyId = req.membership.company._id;
  const membership = await Membership.findOne({ user: req.params.userId, company: companyId }).populate("user");
  if (!membership) throw httpError(404, "Workspace member not found");
  if (String(req.params.userId) === String(req.user._id) && input.disabled) throw httpError(400, "You cannot disable your own account");
  if (membership.role === "admin" && input.role && input.role !== "admin") {
    const adminCount = await Membership.countDocuments({ company: companyId, role: "admin" });
    if (adminCount <= 1) throw httpError(400, "The last workspace administrator cannot be demoted");
  }
  if (input.role !== undefined) membership.role = input.role;
  if (input.disabled !== undefined && membership.user) {
    membership.user.disabled = input.disabled;
    await membership.user.save();
  }
  await membership.save();
  await recordAudit(req, {
    action: "admin.user.update",
    outcome: "success",
    metadata: { targetUserId: req.params.userId, role: input.role, disabled: input.disabled }
  });
  res.json({ member: { id: membership.user._id, name: membership.user.name, email: membership.user.email, role: membership.role, disabled: Boolean(membership.user.disabled) } });
}));

export default router;
