import { Router } from "express";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import User from "../models/User.js";
import Company from "../models/Company.js";
import Membership from "../models/Membership.js";
import WorkspaceInvite from "../models/WorkspaceInvite.js";
import { asyncHandler, httpError } from "../middleware/errors.js";
import { clearSessionCookie, requireAuth, setSessionCookie } from "../middleware/auth.js";
import { recordAudit } from "../services/audit.js";
import { acceptInviteSchema, loginSchema, passwordChangeSchema, profileUpdateSchema, registerSchema } from "../validators/index.js";

const router = Router();
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Registration limit reached. Try again later." }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." }
});

router.post("/register", registrationLimiter, asyncHandler(async (req, res) => {
  const input = registerSchema.parse(req.body);
  const email = input.email.toLowerCase();
  if (await User.exists({ email })) throw httpError(409, "An account with that email already exists");

  const company = await Company.create({ name: input.companyName });
  let user;
  try {
    user = await User.create({
      email,
      name: input.name,
      passwordHash: await bcrypt.hash(input.password, 12)
    });
    await Membership.create({ user: user._id, company: company._id, role: "admin" });
    req.user = user;
    req.membership = { company };
    await recordAudit(req, { action: "auth.register", outcome: "success" });
  } catch (error) {
    if (user) {
      await Membership.deleteMany({ user: user._id });
      await User.deleteOne({ _id: user._id });
    }
    await Company.deleteOne({ _id: company._id });
    throw error;
  }
  setSessionCookie(res, user._id, user.authVersion);
  res.status(201).json({ user: { id: user._id, name: user.name, email }, role: "admin", company: company.name });
}));

router.post("/accept-invite", registrationLimiter, asyncHandler(async (req, res) => {
  const input = acceptInviteSchema.parse(req.body);
  const email = input.email.toLowerCase();
  if (await User.exists({ email })) throw httpError(409, "An account with that email already exists");
  const tokenHash = createHash("sha256").update(input.invitationCode).digest("hex");
  const invitation = await WorkspaceInvite.findOneAndUpdate(
    { tokenHash, email, consumedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { consumedAt: new Date() } },
    { new: true }
  ).select("+tokenHash").populate("company");
  if (!invitation) throw httpError(400, "Invitation is invalid, expired, or does not match this email");
  let user;
  try {
    user = await User.create({ email, name: input.name, passwordHash: await bcrypt.hash(input.password, 12) });
    const membership = await Membership.create({
      user: user._id,
      company: invitation.company._id,
      role: invitation.role
    });
    req.user = user;
    req.membership = { ...membership.toObject(), company: invitation.company };
    await recordAudit(req, { action: "workspace.invite.accept", outcome: "success" });
  } catch (error) {
    if (user) {
      await Membership.deleteMany({ user: user._id });
      await User.deleteOne({ _id: user._id });
    }
    await WorkspaceInvite.updateOne({ _id: invitation._id }, { $set: { consumedAt: null } });
    throw error;
  }
  setSessionCookie(res, user._id, user.authVersion);
  res.status(201).json({ user: { id: user._id, name: user.name, email }, role: invitation.role, company: invitation.company.name });
}));

router.post("/login", loginLimiter, asyncHandler(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await User.findOne({ email: input.email.toLowerCase() }).select("+passwordHash +authVersion");
  const membership = user ? await Membership.findOne({ user: user._id }).populate("company") : null;
  const valid = user && await bcrypt.compare(input.password, user.passwordHash);
  if (!valid || !membership) {
    await recordAudit(req, {
      action: "auth.login",
      outcome: "failure",
      actor: user?._id || null,
      company: membership?.company?._id || null,
      metadata: { reason: "invalid_credentials" }
    });
    throw httpError(401, "Invalid email or password");
  }
  req.user = user;
  req.membership = membership;
  await recordAudit(req, { action: "auth.login", outcome: "success" });
  setSessionCookie(res, user._id, user.authVersion);
  res.json({ user: { id: user._id, name: user.name, email: user.email }, role: membership.role, company: membership.company.name });
}));

router.post("/logout", requireAuth, asyncHandler(async (req, res) => {
  await recordAudit(req, { action: "auth.logout", outcome: "success" });
  await User.updateOne({ _id: req.user._id }, { $inc: { authVersion: 1 } });
  clearSessionCookie(res);
  res.status(204).end();
}));

router.get("/me", requireAuth, (req, res) => {
  res.json({
    user: { id: req.user._id, name: req.user.name, email: req.user.email, avatar: req.user.avatar || "", disabled: Boolean(req.user.disabled) },
    role: req.membership.role,
    company: { id: req.membership.company._id, name: req.membership.company.name }
  });
});

router.patch("/me", requireAuth, asyncHandler(async (req, res) => {
  const input = profileUpdateSchema.parse(req.body);
  if (input.email && input.email.toLowerCase() !== req.user.email) {
    if (await User.exists({ email: input.email.toLowerCase(), _id: { $ne: req.user._id } })) throw httpError(409, "That email is already in use");
  }
  if (input.name !== undefined) req.user.name = input.name;
  if (input.email !== undefined) req.user.email = input.email.toLowerCase();
  if (input.avatar !== undefined) req.user.avatar = input.avatar;
  await req.user.save();
  await recordAudit(req, { action: "profile.update", outcome: "success", metadata: { fields: Object.keys(input) } });
  res.json({ user: { id: req.user._id, name: req.user.name, email: req.user.email, avatar: req.user.avatar || "" } });
}));

router.post("/me/password", requireAuth, asyncHandler(async (req, res) => {
  const input = passwordChangeSchema.parse(req.body);
  const user = await User.findById(req.user._id).select("+passwordHash +authVersion");
  if (!user || !(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    await recordAudit(req, { action: "auth.password.change", outcome: "failure", metadata: { reason: "invalid_current_password" } });
    throw httpError(400, "Current password is incorrect");
  }
  user.passwordHash = await bcrypt.hash(input.newPassword, 12);
  user.authVersion = (user.authVersion || 0) + 1;
  await user.save();
  setSessionCookie(res, user._id, user.authVersion);
  await recordAudit(req, { action: "auth.password.change", outcome: "success" });
  res.status(204).end();
}));

export default router;
