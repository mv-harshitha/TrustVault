import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Membership from "../models/Membership.js";
import { asyncHandler, httpError } from "./errors.js";

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

export const requireAuth = asyncHandler(async (req, _res, next) => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured");
  const token = req.cookies[tokenCookie];
  if (!token) throw httpError(401, "Authentication required");
  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw httpError(401, "Invalid or expired session");
  }
  const user = await User.findById(claims.sub).select("+authVersion");
  if (!user) throw httpError(401, "Invalid session");
  if (claims.ver !== user.authVersion) throw httpError(401, "Session has been revoked");
  const membership = await Membership.findOne({ user: user._id }).populate("company");
  if (!membership) throw httpError(403, "No workspace membership");
  req.user = user;
  req.membership = membership;
  next();
});

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.membership.role)) return next(httpError(403, "Insufficient permissions"));
    next();
  };
}
