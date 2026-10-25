import { Router } from "express";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import Document from "../models/Document.js";
import Permission from "../models/Permission.js";
import Membership from "../models/Membership.js";
import User from "../models/User.js";
import { getPrivateBucketStorage } from "../config/storage.js";
import { asyncHandler, httpError } from "../middleware/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { getDocumentAccess } from "../services/documents.js";
import { recordAudit } from "../services/audit.js";
import { documentCategorySchema, documentSearchSchema, documentUpdateSchema, permissionSchema } from "../validators/index.js";

const router = Router();
const MAX_UPLOAD_SIZE = 40 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_SIZE, files: 1 } });
const allowedTypes = new Set(["application/pdf", "image/png", "image/jpeg"]);
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Upload limit reached. Try again later." }
});
router.use(requireAuth);

router.post("/", uploadLimiter, asyncHandler(async (req, _res, next) => {
  if (["owner", "admin"].includes(req.membership.role)) return next();
  await recordAudit(req, { action: "document.upload", outcome: "denied", metadata: { reason: "role_not_allowed" } });
  throw httpError(403, "Only document owners and administrators can upload");
}), upload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) {
    await recordAudit(req, { action: "document.upload", outcome: "failure", metadata: { reason: "missing_file" } });
    throw httpError(400, "A document file is required");
  }
  const categoryResult = documentCategorySchema.safeParse(req.body.category || "Other");
  if (!categoryResult.success) {
    await recordAudit(req, { action: "document.upload", outcome: "denied", metadata: { reason: "invalid_category" } });
    throw httpError(400, "Choose a valid document category");
  }
  const detected = await fileTypeFromBuffer(req.file.buffer);
  if (!detected || !allowedTypes.has(detected.mime) || req.file.mimetype !== detected.mime) {
    await recordAudit(req, { action: "document.upload", outcome: "denied", metadata: { reason: "unsupported_file_type" } });
    throw httpError(400, "Only verified PDF, PNG, and JPEG files are accepted");
  }
  const storagePath = `${req.membership.company._id}/${randomUUID()}`;
  let storage;
  let storageBucket;
  try {
    const privateStorage = await getPrivateBucketStorage();
    storage = privateStorage.storage;
    storageBucket = privateStorage.bucket;
    const { error } = await storage.storage.from(storageBucket).upload(storagePath, req.file.buffer, {
      contentType: detected.mime,
      upsert: false
    });
    if (error) throw error;
  } catch {
    await recordAudit(req, { action: "document.upload", outcome: "failure", metadata: { reason: "storage_failure" } });
    throw httpError(502, "Document storage is unavailable");
  }
  let document;
  try {
    const safeName = req.file.originalname
      .replace(/[\\/\u0000-\u001f\u007f]/g, "")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 255) || "document";
    document = await Document.create({
      company: req.membership.company._id,
      owner: req.user._id,
      name: safeName,
      category: categoryResult.data,
      storagePath,
      mimeType: detected.mime,
      size: req.file.size
    });
    await recordAudit(req, { action: "document.upload", outcome: "success", document: document._id });
  } catch (error) {
    if (document) await Document.deleteOne({ _id: document._id });
    const { error: cleanupError } = await storage.storage.from(storageBucket).remove([storagePath]);
    if (cleanupError) console.error(`[${req.id}] Failed to remove incomplete upload:`, cleanupError);
    throw error;
  }
  res.status(201).json({ document: { id: document._id, name: document.name, category: document.category, size: document.size, mimeType: document.mimeType, createdAt: document.createdAt, owner: req.user.name } });
}));

router.get("/", asyncHandler(async (req, res) => {
  const filters = documentSearchSchema.parse(req.query);
  const base = { company: req.membership.company._id };
  const clauses = [];
  if (req.membership.role !== "admin") {
    const permissions = await Permission.find({
      ...base,
      user: req.user._id,
      revokedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
    }).select("document");
    const ids = permissions.map((permission) => permission.document);
    clauses.push({ $or: [{ owner: req.user._id }, { _id: { $in: ids } }] });
  }
  if (filters.name) clauses.push({ name: { $regex: filters.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } });
  if (filters.category) clauses.push(filters.category === "Other"
    ? { $or: [{ category: "Other" }, { category: { $exists: false } }] }
    : { category: filters.category });
  if (filters.owner) {
    const documentOwnerIds = await Document.distinct("owner", { company: req.membership.company._id });
    const ownerPattern = new RegExp(filters.owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const owners = await User.find({ _id: { $in: documentOwnerIds }, $or: [{ name: ownerPattern }, { email: ownerPattern }] }).distinct("_id");
    clauses.push({ owner: { $in: owners } });
  }
  if (filters.dateFrom || filters.dateTo) {
    const createdAt = {};
    if (filters.dateFrom) createdAt.$gte = new Date(`${filters.dateFrom}T00:00:00.000Z`);
    if (filters.dateTo) {
      const dayAfter = new Date(`${filters.dateTo}T00:00:00.000Z`);
      dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
      createdAt.$lt = dayAfter;
    }
    clauses.push({ createdAt });
  }
  if (clauses.length) base.$and = clauses;
  const documents = await Document.find(base).populate("owner", "name email").sort({ createdAt: -1 }).limit(200);
  res.json({ documents: documents.map((doc) => ({
    id: doc._id, name: doc.name, category: doc.category || "Other", size: doc.size, mimeType: doc.mimeType,
    createdAt: doc.createdAt, owner: { id: doc.owner._id, name: doc.owner.name }
  })) });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const { document, allowed, expired, permission } = await getDocumentAccess(req.params.id, req.membership, req.user._id);
  if (!document || !allowed) {
    await recordAudit(req, {
      action: expired ? "permission.expired_attempt" : "document.view",
      outcome: "denied",
      document: document?._id,
      metadata: { documentId: req.params.id, reason: expired ? "permission_expired" : "access_denied" }
    });
    throw httpError(document ? 403 : 404, document ? "Document access denied" : "Document not found");
  }
  await recordAudit(req, { action: "document.view", outcome: "success", document: document._id });
  res.json({ document: {
    id: document._id,
    name: document.name,
    category: document.category || "Other",
    size: document.size,
    mimeType: document.mimeType,
    createdAt: document.createdAt,
    owner: document.owner,
    canDownload: req.membership.role === "admin" || String(document.owner._id) === String(req.user._id) || permission?.level === "download",
    canEdit: req.membership.role === "admin" || String(document.owner._id) === String(req.user._id) || permission?.level === "edit"
  } });
}));

async function serveDocumentFile(req, res, document, disposition) {
  let contents;
  try {
    const { storage, bucket } = await getPrivateBucketStorage();
    const { data, error } = await storage.storage.from(bucket).download(document.storagePath);
    if (error || !data) throw new Error("Storage download failed");
    contents = Buffer.from(await data.arrayBuffer());
  } catch {
    await recordAudit(req, { action: `document.${disposition}`, outcome: "failure", document: document._id, metadata: { reason: "storage_failure" } });
    throw httpError(502, "Document storage is unavailable");
  }
  await recordAudit(req, { action: `document.${disposition}`, outcome: "success", document: document._id });
  res.setHeader("Content-Type", document.mimeType);
  res.setHeader("Content-Disposition", `${disposition === "view" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(document.name)}`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(contents);
}

router.get("/:id/view", asyncHandler(async (req, res) => {
  const { document, allowed, expired } = await getDocumentAccess(req.params.id, req.membership, req.user._id, "view", true);
  if (!document || !allowed) {
    await recordAudit(req, {
      action: expired ? "permission.expired_attempt" : "document.view",
      outcome: "denied",
      document: document?._id,
      metadata: { documentId: req.params.id, reason: expired ? "permission_expired" : "access_denied" }
    });
    throw httpError(document ? 403 : 404, document ? "Document access denied" : "Document not found");
  }
  await serveDocumentFile(req, res, document, "view");
}));

router.get("/:id/download", asyncHandler(async (req, res) => {
  const { document, allowed, expired } = await getDocumentAccess(req.params.id, req.membership, req.user._id, "download", true);
  if (!document || !allowed) {
    await recordAudit(req, {
      action: expired ? "permission.expired_attempt" : "document.download",
      outcome: "denied",
      document: document?._id,
      metadata: { documentId: req.params.id, reason: expired ? "permission_expired" : "access_denied" }
    });
    throw httpError(document ? 403 : 404, document ? "Download access denied" : "Document not found");
  }
  await serveDocumentFile(req, res, document, "download");
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const document = await Document.findOne({ _id: req.params.id, company: req.membership.company._id }).select("+storagePath");
  if (!document) {
    await recordAudit(req, { action: "document.delete", outcome: "denied", metadata: { documentId: req.params.id, reason: "document_not_found" } });
    throw httpError(404, "Document not found");
  }
  if (req.membership.role !== "admin" && String(document.owner) !== String(req.user._id)) {
    await recordAudit(req, { action: "document.delete", outcome: "denied", document: document._id });
    throw httpError(403, "Only the owner or an administrator can delete this document");
  }
  try {
    const { storage, bucket } = await getPrivateBucketStorage();
    const { error } = await storage.storage.from(bucket).remove([document.storagePath]);
    if (error) throw error;
  } catch {
    await recordAudit(req, { action: "document.delete", outcome: "failure", document: document._id, metadata: { reason: "storage_failure" } });
    throw httpError(502, "Document storage is unavailable");
  }
  try {
    await Promise.all([
      Permission.deleteMany({ document: document._id }),
      Document.deleteOne({ _id: document._id })
    ]);
  } catch {
    await recordAudit(req, { action: "document.delete", outcome: "failure", document: document._id, metadata: { reason: "metadata_delete_failure", storageObjectRemoved: true } });
    throw httpError(500, "Document metadata could not be deleted after storage removal");
  }
  await recordAudit(req, { action: "document.delete", outcome: "success", document: document._id });
  res.status(204).end();
}));

router.post("/:id/permissions", asyncHandler(async (req, res) => {
  const { document } = await getDocumentAccess(req.params.id, req.membership, req.user._id);
  if (!document) {
    await recordAudit(req, { action: "permission.grant", outcome: "denied", metadata: { documentId: req.params.id, reason: "document_not_found" } });
    throw httpError(404, "Document not found");
  }
  if (req.membership.role !== "admin" && String(document.owner._id) !== String(req.user._id)) {
    await recordAudit(req, { action: "permission.grant", outcome: "denied", document: document._id });
    throw httpError(403, "Only the owner or an administrator can grant access");
  }
  const input = permissionSchema.parse(req.body);
  const target = await User.findOne({ email: input.email.toLowerCase() });
  if (!target || String(target._id) === String(req.user._id)) throw httpError(400, "User is not an eligible workspace member");
  const targetMembership = await Membership.findOne({
    user: target._id,
    company: req.membership.company._id
  });
  if (!targetMembership) throw httpError(400, "User is not an eligible workspace member");
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && expiresAt <= new Date()) throw httpError(400, "Expiration must be in the future");
  const permission = await Permission.findOneAndUpdate(
    { document: document._id, user: target._id, revokedAt: null },
    { $set: { company: req.membership.company._id, level: input.level, grantedBy: req.user._id, expiresAt } },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );
  await recordAudit(req, {
    action: "permission.grant",
    outcome: "success",
    document: document._id,
    metadata: { level: permission.level, targetUserId: target._id }
  });
  res.status(201).json({ permission: { id: permission._id, user: { id: target._id, name: target.name, email: target.email }, level: permission.level, expiresAt: permission.expiresAt } });
}));

router.get("/:id/permissions", asyncHandler(async (req, res) => {
  const { document } = await getDocumentAccess(req.params.id, req.membership, req.user._id);
  if (!document) {
    await recordAudit(req, { action: "permission.view", outcome: "denied", metadata: { documentId: req.params.id, reason: "document_not_found" } });
    throw httpError(404, "Document not found");
  }
  if (req.membership.role !== "admin" && String(document.owner._id) !== String(req.user._id)) {
    await recordAudit(req, { action: "permission.view", outcome: "denied", document: document._id, metadata: { reason: "role_not_allowed" } });
    throw httpError(403, "Only the owner or an administrator can manage permissions");
  }
  const permissions = await Permission.find({
    document: document._id,
    revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
  })
    .populate("user", "name email").sort({ createdAt: -1 });
  res.json({ permissions: permissions.map((item) => ({ id: item._id, user: item.user, level: item.level, expiresAt: item.expiresAt })) });
}));

router.delete("/:id/permissions/:permissionId", asyncHandler(async (req, res) => {
  const { document } = await getDocumentAccess(req.params.id, req.membership, req.user._id);
  if (!document) {
    await recordAudit(req, { action: "permission.revoke", outcome: "denied", metadata: { documentId: req.params.id, reason: "document_not_found" } });
    throw httpError(404, "Document not found");
  }
  if (req.membership.role !== "admin" && String(document.owner._id) !== String(req.user._id)) {
    await recordAudit(req, { action: "permission.revoke", outcome: "denied", document: document._id, metadata: { reason: "role_not_allowed" } });
    throw httpError(403, "Only the owner or an administrator can revoke access");
  }
  const permission = await Permission.findOneAndUpdate(
    { _id: req.params.permissionId, document: document._id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { new: true }
  );
  if (!permission) {
    await recordAudit(req, { action: "permission.revoke", outcome: "denied", document: document._id, metadata: { permissionId: req.params.permissionId, reason: "permission_not_found" } });
    throw httpError(404, "Active permission not found");
  }
  await recordAudit(req, {
    action: "permission.revoke",
    outcome: "success",
    document: document._id,
    metadata: { level: permission.level, targetUserId: permission.user }
  });
  res.status(204).end();
}));

router.patch("/:id", asyncHandler(async (req, res) => {
  const { document, allowed } = await getDocumentAccess(req.params.id, req.membership, req.user._id, "edit");
  if (!document) {
    await recordAudit(req, { action: "document.edit", outcome: "denied", metadata: { documentId: req.params.id, reason: "document_not_found" } });
    throw httpError(404, "Document not found");
  }
  if (!allowed) {
    await recordAudit(req, { action: "document.edit", outcome: "denied", document: document._id, metadata: { reason: "role_not_allowed" } });
    throw httpError(403, "Only the owner, an administrator, or a user with edit access can edit this document");
  }
  const input = documentUpdateSchema.parse(req.body);
  if (!input.name && !input.category) throw httpError(400, "Provide a document name or category");
  const previous = { name: document.name, category: document.category };
  if (input.name) document.name = input.name;
  if (input.category) document.category = input.category;
  await document.save();
  try {
    await recordAudit(req, {
      action: "document.edit",
      outcome: "success",
      document: document._id,
      metadata: { fields: Object.keys(input) }
    });
  } catch (error) {
    document.name = previous.name;
    document.category = previous.category;
    await document.save();
    throw error;
  }
  res.json({ document: { id: document._id, name: document.name, category: document.category, size: document.size, mimeType: document.mimeType, createdAt: document.createdAt } });
}));

export default router;
