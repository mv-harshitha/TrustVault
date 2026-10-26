import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import User from "../models/User.js";
import Membership from "../models/Membership.js";
import Document from "../models/Document.js";
import { asyncHandler, httpError } from "./errors.js";
import { recordAudit } from "../services/audit.js";

export const tokenCookie = "trustvault_session";
function positiveIntegerSetting(name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const configured = process.env[name];
  if (configured === undefined || configured.trim() === "") return fallback;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return value;
}

export const unauthenticatedDocumentAuditLimiter = rateLimit({
  windowMs: positiveIntegerSetting("UNAUTH_DOCUMENT_AUDIT_WINDOW_MS", 15 * 60 * 1000, 2_147_483_647),
  limit: positiveIntegerSetting("UNAUTH_DOCUMENT_AUDIT_LIMIT", 30),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many unauthenticated document requests. Try again later." }
});

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

function checkUnauthenticatedDocumentLimit(req, res) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      res.removeListener("finish", onResponseFinished);
      res.removeListener("close", onResponseFinished);
    };
    const onResponseFinished = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(false);
    };

    res.once("finish", onResponseFinished);
    res.once("close", onResponseFinished);
    unauthenticatedDocumentAuditLimiter(req, res, (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(true);
    });
  });
}

async function auditUnauthenticatedDocumentRequest(req, res, reason) {
  if (req.baseUrl !== "/api/documents") return true;
  if (!await checkUnauthenticatedDocumentLimit(req, res)) return false;

  const documentId = /^\/([a-f\d]{24})(?:\/|$)/i.exec(req.path)?.[1];
  const document = documentId
    ? await Document.findById(documentId).select("_id company").lean()
    : null;
  if (!document) return true;
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
  return true;
}

export const requireAuth = asyncHandler(async (req, res, next) => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured");
  const token = req.cookies[tokenCookie];
  if (!token) {
    if (!await auditUnauthenticatedDocumentRequest(req, res, "missing_session")) return;
    throw httpError(401, "Authentication required");
  }
  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    if (!await auditUnauthenticatedDocumentRequest(req, res, "invalid_or_expired_session")) return;
    throw httpError(401, "Invalid or expired session");
  }
  const user = await User.findById(claims.sub).select("+authVersion");
  if (!user) {
    if (!await auditUnauthenticatedDocumentRequest(req, res, "unknown_session_user")) return;
    throw httpError(401, "Invalid session");
  }
  if (user.disabled) {
    if (!await auditUnauthenticatedDocumentRequest(req, res, "disabled_account")) return;
    throw httpError(403, "Account is disabled");
  }
  req.user = user;
  if (claims.ver !== user.authVersion) {
    if (!await auditUnauthenticatedDocumentRequest(req, res, "revoked_session")) return;
    throw httpError(401, "Session has been revoked");
  }
  const membership = await Membership.findOne({ user: user._id }).populate("company");
  if (!membership) {
    if (!await auditUnauthenticatedDocumentRequest(req, res, "no_workspace_membership")) return;
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
