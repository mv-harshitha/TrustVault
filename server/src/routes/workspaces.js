import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import Membership from "../models/Membership.js";
import Permission from "../models/Permission.js";
import User from "../models/User.js";
import WorkspaceInvite from "../models/WorkspaceInvite.js";
import { asyncHandler, httpError } from "../middleware/errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { recordAudit } from "../services/audit.js";
import { inviteSchema } from "../validators/index.js";

const router = Router();
router.use(requireAuth);
const invitationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Invitation limit reached. Try again later." }
});

router.get("/current", asyncHandler(async (req, res) => {
  res.json({
    company: req.membership.company,
    role: req.membership.role,
    user: { id: req.user._id, name: req.user.name, email: req.user.email }
  });
}));

router.get("/current/members", requireRole("admin"), asyncHandler(async (req, res) => {
  const memberships = await Membership.find({ company: req.membership.company._id })
    .populate("user", "name email")
    .sort({ createdAt: 1 });
  res.json({ members: memberships.map(({ user, role, createdAt }) => ({ id: user._id, name: user.name, email: user.email, role, joinedAt: createdAt })) });
}));

router.delete("/current/members/:userId", requireRole("admin"), asyncHandler(async (req, res) => {
  if (String(req.params.userId) === String(req.user._id)) throw httpError(400, "You cannot remove your own administrator membership");
  const membership = await Membership.findOne({
    user: req.params.userId,
    company: req.membership.company._id
  });
  if (!membership) throw httpError(404, "Workspace member not found");
  if (membership.role === "admin") {
    const adminCount = await Membership.countDocuments({ company: req.membership.company._id, role: "admin" });
    if (adminCount <= 1) throw httpError(400, "The last workspace administrator cannot be removed");
  }
  const now = new Date();
  const activePermissions = await Permission.find({
    company: req.membership.company._id,
    user: membership.user,
    revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
  }).select("document level");
  await Permission.updateMany(
    { _id: { $in: activePermissions.map((permission) => permission._id) }, revokedAt: null },
    { $set: { revokedAt: now } }
  );
  await membership.deleteOne();
  await Promise.all(activePermissions.map((permission) => recordAudit(req, {
    action: "permission.revoke",
    outcome: "success",
    document: permission.document,
    metadata: { targetUserId: membership.user, level: permission.level, reason: "member_removed" }
  })));
  await recordAudit(req, {
    action: "workspace.member.remove",
    outcome: "success",
    metadata: { memberId: membership.user, role: membership.role, revokedPermissionCount: activePermissions.length }
  });
  res.status(204).end();
}));

router.post("/current/invitations", invitationLimiter, requireRole("admin"), asyncHandler(async (req, res) => {
  const input = inviteSchema.parse(req.body);
  const email = input.email.toLowerCase();
  if (await User.exists({ email })) throw httpError(409, "This email already has an account");
  const invitationCode = randomBytes(32).toString("hex");
  await WorkspaceInvite.updateMany(
    { company: req.membership.company._id, email, consumedAt: null },
    { $set: { consumedAt: new Date() } }
  );
  const invitation = await WorkspaceInvite.create({
    company: req.membership.company._id,
    email,
    role: input.role,
    tokenHash: createHash("sha256").update(invitationCode).digest("hex"),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000)
  });
  try {
    await recordAudit(req, { action: "workspace.invite.create", outcome: "success", metadata: { role: input.role } });
  } catch (error) {
    await WorkspaceInvite.deleteOne({ _id: invitation._id });
    throw error;
  }
  res.status(201).json({ invitationCode, expiresInHours: 48 });
}));

export default router;
