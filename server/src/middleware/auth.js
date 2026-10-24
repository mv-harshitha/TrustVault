import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Membership from "../models/Membership.js";
import Document from "../models/Document.js";
import { asyncHandler, httpError } from "./errors.js";
import { recordAudit } from "../services/audit.js";

export const tokenCookie = "trustvault_session";
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/"
};

export function setSessionCookie(res, userId, authVersion = 0) {
  const token = jwt.sign({ sub: String(userId), ver: authVersion }, process.env.JWT_SECRET, { expiresIn: "8h" });
  res.cookie(tokenCookie, token, { ...cookieOptions, maxAge: 8 * 60 * 60 * 1000 });
}

export function clearSessionCookie(res) {
  res.clearCookie(tokenCookie, cookieOptions);
}

async function auditUnauthenticatedDocumentRequest(req, reason) {
  if (req.baseUrl !== "/api/documents") return;

  const documentId = /^\/([a-f\d]{24})(?:\/|$)/i.exec(req.path)?.[1];
  const document = documentId
    ? await Document.findById(documentId).select("_id company").lean()
    : null;
  if (!document) return;
  const requestedPath = `${req.baseUrl}${req.path}`
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 300);

  await recordAudit(req, {
    actor: req.user?._id ?? null,
    company: document.company,
    action: "document.access",
    outcome: "denied",
    document: document._id,
    metadata: {
      reason,
      requestedPath
    }
  });
}

export const requireAuth = asyncHandler(async (req, _res, next) => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured");
  const token = req.cookies[tokenCookie];
  if (!token) {
    await auditUnauthenticatedDocumentRequest(req, "missing_session");
    throw httpError(401, "Authentication required");
  }
  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    await auditUnauthenticatedDocumentRequest(req, "invalid_or_expired_session");
    throw httpError(401, "Invalid or expired session");
  }
  const user = await User.findById(claims.sub).select("+authVersion");
  if (!user) {
    await auditUnauthenticatedDocumentRequest(req, "unknown_session_user");
    throw httpError(401, "Invalid session");
  }
  req.user = user;
  if (claims.ver !== user.authVersion) {
    await auditUnauthenticatedDocumentRequest(req, "revoked_session");
    throw httpError(401, "Session has been revoked");
  }
  const membership = await Membership.findOne({ user: user._id }).populate("company");
  if (!membership) {
    await auditUnauthenticatedDocumentRequest(req, "no_workspace_membership");
    throw httpError(403, "No workspace membership");
  }
  req.membership = membership;
  next();
});

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.membership.role)) return next(httpError(403, "Insufficient permissions"));
    next();
  };
}
