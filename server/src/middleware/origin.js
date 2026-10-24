import { httpError } from "./errors.js";

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function requireTrustedOrigin(req, _res, next) {
  const origin = req.get("origin");
  const trustedOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
  if (stateChangingMethods.has(req.method) && origin && origin !== trustedOrigin) {
    return next(httpError(403, "Untrusted request origin"));
  }
  next();
}
