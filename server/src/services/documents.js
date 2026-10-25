import Document from "../models/Document.js";
import Permission from "../models/Permission.js";

export async function getDocumentAccess(documentId, membership, userId, level = "view", includeStoragePath = false) {
  const query = Document.findOne({
    _id: documentId,
    company: membership.company._id
  }).populate("owner", "name email");
  if (includeStoragePath) query.select("+storagePath");
  const document = await query;
  if (!document) return { document: null, allowed: false };
  if (membership.role === "admin" || String(document.owner._id) === String(userId)) {
    return { document, allowed: true };
  }
  const permission = await Permission.findOne({
    document: document._id,
    company: membership.company._id,
    user: userId,
    revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
  });
  const allowed = permission && (
    level === "view"
    || (level === "download" && permission.level === "download")
    || (level === "edit" && permission.level === "edit")
  );
  if (!permission) {
    const expiredPermission = await Permission.exists({
      document: document._id,
      company: membership.company._id,
      user: userId,
      revokedAt: null,
      expiresAt: { $lte: new Date() }
    });
    return { document, allowed: false, expired: Boolean(expiredPermission) };
  }
  return { document, allowed: Boolean(allowed), permission, expired: false };
}
