import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { setStorageClient } from "../src/config/storage.js";

let mongo;
let app;
let User;
let Company;
let Membership;
let Document;
let Permission;
let AuditEvent;
let unauthenticatedDocumentAuditLimiter;
let adminAgent;
let viewerAgent;
let documentId;
let nextTestClientAddress = 1;
let storageIsPrivate = true;

const MAX_UPLOAD_SIZE = 40 * 1024 * 1024;
const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x02, 0x00,
  0x00, 0x05, 0x00, 0x01, 0xa5, 0xf6, 0x45, 0x40,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82
]);

function fakeStorage() {
  return {
    storage: {
      getBucket: async () => ({ data: { id: "trustvault-private", public: !storageIsPrivate }, error: null }),
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
        download: async () => ({ data: new Blob([png]), error: null })
      })
    }
  };
}

async function register(agent, email, companyName) {
  return agent.post("/api/auth/register").send({
    name: email.split("@")[0],
    email,
    password: "Strong-password-123",
    companyName
  });
}

function createAgent() {
  const agent = request.agent(app);
  agent.set("X-Forwarded-For", `192.0.2.${nextTestClientAddress++}`)
    .set("Origin", process.env.CLIENT_ORIGIN);
  return agent;
}

async function inviteMember(admin, email, role) {
  const invitation = await admin.post("/api/workspaces/current/invitations").send({ email, role });
  assert.equal(invitation.status, 201);
  const member = createAgent();
  const accepted = await member.post("/api/auth/accept-invite").send({
    name: email.split("@")[0],
    email,
    password: "Strong-password-123",
    invitationCode: invitation.body.invitationCode
  });
  assert.equal(accepted.status, 201);
  return member;
}

before(async () => {
  process.env.JWT_SECRET = "test-only-secret-with-sufficient-length";
  process.env.CLIENT_ORIGIN = "http://localhost:5173";
  process.env.SUPABASE_BUCKET = "trustvault-private";
  process.env.UNAUTH_DOCUMENT_AUDIT_LIMIT = "3";
  process.env.UNAUTH_DOCUMENT_AUDIT_WINDOW_MS = "1000";
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const [{ default: serverApp }, userModel, companyModel, membershipModel, documentModel, permissionModel, auditModel] = await Promise.all([
    import("../src/app.js"),
    import("../src/models/User.js"),
    import("../src/models/Company.js"),
    import("../src/models/Membership.js"),
    import("../src/models/Document.js"),
    import("../src/models/Permission.js"),
    import("../src/models/AuditEvent.js")
  ]);
  const authMiddleware = await import("../src/middleware/auth.js");
  app = serverApp;
  app.set("trust proxy", 1);
  User = userModel.default;
  Company = companyModel.default;
  Membership = membershipModel.default;
  Document = documentModel.default;
  Permission = permissionModel.default;
  AuditEvent = auditModel.default;
  unauthenticatedDocumentAuditLimiter = authMiddleware.unauthenticatedDocumentAuditLimiter;
  setStorageClient(fakeStorage());
});

beforeEach(async () => {
  storageIsPrivate = true;
  await Promise.all([
    User.deleteMany({}),
    Company.deleteMany({}),
    Membership.deleteMany({}),
    Document.deleteMany({}),
    Permission.deleteMany({}),
    AuditEvent.deleteMany({})
  ]);
  adminAgent = createAgent();
  viewerAgent = createAgent();
  await register(adminAgent, "admin@example.test", "Acme");
  await register(viewerAgent, "outsider@example.test", "Other Company");
});

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test("registration hashes passwords, creates an admin session, and rejects duplicate accounts", async () => {
  const agent = createAgent();
  const response = await register(agent, "new-admin@example.test", "New Workspace");

  assert.equal(response.status, 201);
  assert.match(response.headers["set-cookie"][0], /HttpOnly/);
  assert.equal(response.body.role, "admin");
  assert.equal(response.body.user.email, "new-admin@example.test");
  assert.equal(response.body.passwordHash, undefined);

  const storedUser = await User.findOne({ email: "new-admin@example.test" }).select("+passwordHash");
  assert.ok(storedUser.passwordHash.startsWith("$2"));
  assert.notEqual(storedUser.passwordHash, "Strong-password-123");
  assert.equal(await bcrypt.compare("Strong-password-123", storedUser.passwordHash), true);
  assert.equal((await Membership.findOne({ user: storedUser._id })).role, "admin");

  const current = await agent.get("/api/auth/me");
  assert.equal(current.status, 200);
  assert.equal(current.body.user.id, String(storedUser._id));

  const duplicate = await register(createAgent(), "new-admin@example.test", "Duplicate Workspace");
  assert.equal(duplicate.status, 409);
  assert.equal(await User.countDocuments({ email: "new-admin@example.test" }), 1);
  assert.equal(await Company.countDocuments({ name: "Duplicate Workspace" }), 0);
});

test("CORS preflight and registration request errors return readable responses", async () => {
  const preflight = await request(app).options("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "content-type");
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], "http://localhost:5173");
  assert.equal(preflight.headers["access-control-allow-credentials"], "true");

  const malformed = await request(app).post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .set("Content-Type", "application/json")
    .send("{");
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers["access-control-allow-origin"], "http://localhost:5173");

  const missingOrigin = await request(app).post("/api/auth/register").send({
    name: "Missing Origin",
    email: "missing-origin@example.test",
    password: "Strong-password-123",
    companyName: "Missing Origin Workspace"
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal(await User.exists({ email: "missing-origin@example.test" }), null);

  const usersBeforeUntrustedRequest = await User.countDocuments();
  const untrusted = await request(app).post("/api/auth/register")
    .set("Origin", "https://attacker.example")
    .send({});
  assert.equal(untrusted.status, 403);
  assert.equal(await User.countDocuments(), usersBeforeUntrustedRequest);
});

test("registers and logs in; rejects invalid credentials", async () => {
  const agent = createAgent();
  const response = await agent.post("/api/auth/login").send({
    email: "admin@example.test",
    password: "Strong-password-123"
  });
  assert.equal(response.status, 200);
  assert.match(response.headers["set-cookie"][0], /HttpOnly/);
  assert.equal(response.body.passwordHash, undefined);
  assert.equal((await agent.get("/api/auth/me")).body.user.email, "admin@example.test");
  const invalid = await request(app).post("/api/auth/login")
    .set("Origin", process.env.CLIENT_ORIGIN)
    .send({
      email: "admin@example.test",
      password: "incorrect"
    });
  assert.equal(invalid.status, 401);
  assert.ok(await AuditEvent.exists({ action: "auth.login", outcome: "failure" }));
});

test("protects routes without a session and revokes a session at logout", async () => {
  const noSession = (method, path) => request(app)[method](path)
    .set("X-Forwarded-For", `198.51.100.${nextTestClientAddress++}`)
    .set("Origin", process.env.CLIENT_ORIGIN);
  assert.equal((await noSession("get", "/api/documents")).status, 401);
  const uploaded = await adminAgent.post("/api/documents").attach("file", png, { filename: "auth-matrix.png", contentType: "image/png" });
  const id = uploaded.body.document.id;
  const protectedRequests = [
    () => noSession("get", `/api/documents/${id}`),
    () => noSession("get", `/api/documents/${id}/view`),
    () => noSession("get", `/api/documents/${id}/download`),
    () => noSession("patch", `/api/documents/${id}`).send({ name: "forged.png" }),
    () => noSession("delete", `/api/documents/${id}`),
    () => noSession("get", `/api/documents/${id}/permissions`),
    () => noSession("post", `/api/documents/${id}/permissions`).send({ email: "x@example.test", level: "view" }),
    () => noSession("delete", `/api/documents/${id}/permissions/000000000000000000000001`),
    () => noSession("get", "/api/audit-logs"),
    () => noSession("get", `/api/audit-logs/documents/${id}`)
  ];
  const protectedResponses = [];
  for (const operation of protectedRequests) protectedResponses.push(await operation());
  assert.deepEqual(protectedResponses.map((response) => response.status), Array(10).fill(401));
  const agent = createAgent();
  await register(agent, "logout@example.test", "Logout Co");
  assert.equal((await agent.post("/api/auth/logout")).status, 204);
  assert.equal((await agent.get("/api/auth/me")).status, 401);
});

test("rate limits unauthenticated document audit work and expires the IP window", async () => {
  const uploaded = await adminAgent.post("/api/documents")
    .attach("file", png, { filename: "unauthenticated-audit.png", contentType: "image/png" });
  assert.equal(uploaded.status, 201);
  const id = uploaded.body.document.id;
  const ip = "203.0.113.240";
  const originalFindById = Document.findById;
  const originalAuditCreate = AuditEvent.create;
  let lookupCount = 0;
  let auditWriteCount = 0;
  Document.findById = function (...args) {
    lookupCount += 1;
    return originalFindById.apply(this, args);
  };
  AuditEvent.create = function (...args) {
    auditWriteCount += 1;
    return originalAuditCreate.apply(this, args);
  };

  let deniedResponses;
  let limitedExisting;
  let limitedUnknown;
  try {
    deniedResponses = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      deniedResponses.push(await request(app)
        .get(`/api/documents/${id}/download`)
        .set("X-Forwarded-For", ip)
        .set("Authorization", "Bearer harmless-test-token"));
    }
    limitedExisting = await request(app)
      .get(`/api/documents/${id}/download`)
      .set("X-Forwarded-For", ip);
    limitedUnknown = await request(app)
      .get("/api/documents/000000000000000000000001/download")
      .set("X-Forwarded-For", ip);
    assert.deepEqual(deniedResponses.map((response) => response.status), [401, 401, 401]);
    assert.equal(limitedExisting.status, 429);
    assert.equal(limitedUnknown.status, 429);
    assert.deepEqual(limitedExisting.body, limitedUnknown.body);
    assert.equal(JSON.stringify(limitedExisting.body).includes(id), false);
    assert.equal(JSON.stringify(limitedExisting.body).includes("Acme"), false);
    assert.equal(lookupCount, 3);
    assert.equal(auditWriteCount, 3);
  } finally {
    Document.findById = originalFindById;
    AuditEvent.create = originalAuditCreate;
  }

  const events = await AuditEvent.find({
    action: "document.access",
    outcome: "denied",
    document: id
  }).lean();
  assert.equal(events.length, 3);
  const document = await Document.findById(id);
  assert.ok(events.every((event) => event.actor === null));
  assert.ok(events.every((event) => String(event.company) === String(document.company)));
  assert.ok(events.every((event) => event.metadata.reason === "missing_session"));
  assert.ok(events.every((event) => event.metadata.requestedPath === `/api/documents/${id}/download`));
  assert.ok(events.every((event) => !JSON.stringify(event).includes("harmless-test-token")));

  adminAgent.set("X-Forwarded-For", ip);
  assert.equal((await adminAgent.get(`/api/documents/${id}/download`)).status, 200);

  const rateInfo = await unauthenticatedDocumentAuditLimiter.getKey(ip);
  assert.ok(rateInfo?.resetTime instanceof Date);
  const waitMs = Math.max(0, rateInfo.resetTime.getTime() - Date.now() + 25);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  const afterWindow = await request(app)
    .get(`/api/documents/${id}/download`)
    .set("X-Forwarded-For", ip)
    .set("Authorization", "Bearer harmless-test-token");
  assert.equal(afterWindow.status, 401);
  assert.equal(await AuditEvent.countDocuments({ action: "document.access", document: id }), 4);

  const visibleToAdmin = await adminAgent.get("/api/audit-logs");
  assert.equal(visibleToAdmin.status, 200);
  assert.ok(visibleToAdmin.body.events.some((item) => item.action === "document.access" && item.document === String(id)));
});

test("uploads verified files, checks MIME and size, and serves downloads after authorization", async () => {
  const uploaded = await adminAgent.post("/api/documents")
    .attach("file", png, { filename: "../../report.png", contentType: "image/png" });
  assert.equal(uploaded.status, 201);
  documentId = uploaded.body.document.id;
  assert.equal(uploaded.body.document.category, "Other");
  assert.equal("storagePath" in uploaded.body.document, false);
  assert.equal("url" in uploaded.body.document, false);
  const safeDocument = await Document.findById(documentId);
  assert.equal(/[\\/\u0000-\u001f\u007f]/.test(safeDocument.name), false);
  assert.equal(safeDocument.name.startsWith("."), false);
  const forbiddenType = await adminAgent.post("/api/documents")
    .attach("file", Buffer.from("not a pdf"), { filename: "report.pdf", contentType: "application/pdf" });
  assert.equal(forbiddenType.status, 400);
  const invalidCategory = await adminAgent.post("/api/documents").field("category", "Payroll")
    .attach("file", png, { filename: "invalid-category.png", contentType: "image/png" });
  assert.equal(invalidCategory.status, 400);
  const maxSizePng = Buffer.alloc(MAX_UPLOAD_SIZE);
  png.copy(maxSizePng);
  const acceptedMaximum = await adminAgent.post("/api/documents")
    .attach("file", maxSizePng, { filename: "maximum-size.png", contentType: "image/png" });
  assert.equal(acceptedMaximum.status, 201);
  const oversized = await adminAgent.post("/api/documents")
    .attach("file", Buffer.alloc(MAX_UPLOAD_SIZE + 1, 1), { filename: "large.png", contentType: "image/png" });
  assert.equal(oversized.status, 400);
  assert.equal(oversized.body.error, "File exceeds the 40 MB limit");
  const downloaded = await adminAgent.get(`/api/documents/${documentId}/download`);
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.headers["content-disposition"], /report.png/);
  const uploadEvent = await AuditEvent.findOne({ action: "document.upload", outcome: "success", document: documentId }).lean();
  const downloadEvent = await AuditEvent.findOne({ action: "document.download", outcome: "success", document: documentId }).lean();
  assert.ok(uploadEvent?.createdAt instanceof Date);
  assert.ok(downloadEvent?.createdAt instanceof Date);
  assert.ok(uploadEvent.requestId);
  assert.equal(downloadEvent.metadata.method, "GET");
  assert.equal(downloadEvent.metadata.route, "/api/documents/:id/download");
});

test("refuses document storage when the configured bucket is public", async () => {
  storageIsPrivate = false;
  const response = await adminAgent.post("/api/documents")
    .attach("file", png, { filename: "private.png", contentType: "image/png" });
  assert.equal(response.status, 502);
  assert.equal(await Document.countDocuments({}), 0);
  assert.ok(await AuditEvent.exists({ action: "document.upload", outcome: "failure", "metadata.reason": "storage_failure" }));
});

test("enforces workspace isolation, grant eligibility, permission level, expiry, and revocation", async () => {
  const uploaded = await adminAgent.post("/api/documents")
    .attach("file", png, { filename: "private.png", contentType: "image/png" });
  documentId = uploaded.body.document.id;
  assert.equal((await viewerAgent.get(`/api/documents/${documentId}`)).status, 404);
  assert.equal((await viewerAgent.get(`/api/documents/${documentId}/view`)).status, 404);
  assert.equal((await viewerAgent.get(`/api/documents/${documentId}/download`)).status, 404);
  assert.equal((await viewerAgent.delete(`/api/documents/${documentId}`)).status, 404);
  assert.equal((await viewerAgent.patch(`/api/documents/${documentId}`).send({ name: "cross-workspace.png" })).status, 404);
  assert.equal((await viewerAgent.get(`/api/documents/${documentId}/permissions`)).status, 404);
  assert.equal((await viewerAgent.post(`/api/documents/${documentId}/permissions`).send({ email: "outsider@example.test", level: "view" })).status, 404);

  const outsider = await User.findOne({ email: "outsider@example.test" });
  const outsiderMembership = await Membership.findOne({ user: outsider._id });
  await Permission.create({
    document: documentId,
    company: outsiderMembership.company,
    user: outsider._id,
    level: "download",
    grantedBy: outsider._id
  });
  assert.equal((await viewerAgent.get(`/api/documents/${documentId}`)).status, 404);

  const invitation = await adminAgent.post("/api/workspaces/current/invitations")
    .send({ email: "member@example.test", role: "viewer" });
  assert.equal(invitation.status, 201);
  const joined = await createAgent().post("/api/auth/accept-invite").send({
    name: "Member", email: "member@example.test", password: "Strong-password-123",
    invitationCode: invitation.body.invitationCode
  });
  assert.equal(joined.status, 201);
  const member = createAgent();
  await member.post("/api/auth/login").send({ email: "member@example.test", password: "Strong-password-123" });

  const deniedGrant = await member.post(`/api/documents/${documentId}/permissions`)
    .send({ email: "outsider@example.test", level: "download" });
  assert.equal(deniedGrant.status, 403);
  const granted = await adminAgent.post(`/api/documents/${documentId}/permissions`)
    .send({ email: "member@example.test", level: "view" });
  assert.equal(granted.status, 201);
  assert.equal((await member.get(`/api/documents/${documentId}`)).status, 200);
  assert.equal((await member.get(`/api/documents/${documentId}/view`)).status, 200);
  assert.equal((await member.get(`/api/documents/${documentId}/download`)).status, 403);
  const downloadGrant = await adminAgent.post(`/api/documents/${documentId}/permissions`)
    .send({ email: "member@example.test", level: "download" });
  assert.equal(downloadGrant.status, 201);
  assert.equal((await member.get(`/api/documents/${documentId}/download`)).status, 200);
  assert.ok(await AuditEvent.exists({ action: "permission.grant", outcome: "success", document: documentId }));
  assert.equal((await adminAgent.delete(`/api/documents/${documentId}/permissions/${downloadGrant.body.permission.id}`)).status, 204);
  assert.ok(await AuditEvent.exists({ action: "permission.revoke", outcome: "success", document: documentId }));
  assert.equal((await member.get(`/api/documents/${documentId}`)).status, 403);
  assert.equal((await member.get(`/api/documents/${documentId}/view`)).status, 403);
  assert.equal((await member.get(`/api/documents/${documentId}/download`)).status, 403);

  await Permission.create({
    document: documentId,
    company: (await Membership.findOne({ user: (await User.findOne({ email: "admin@example.test" }))._id })).company,
    user: (await User.findOne({ email: "member@example.test" }))._id,
    level: "view",
    grantedBy: (await User.findOne({ email: "admin@example.test" }))._id,
    expiresAt: new Date(Date.now() - 1000)
  });
  await member.get(`/api/documents/${documentId}`);
  assert.ok(await AuditEvent.exists({ action: "permission.expired_attempt", outcome: "denied" }));
  assert.ok(await AuditEvent.exists({ action: "permission.grant", outcome: "denied" }));
});

test("owner, administrator, and viewer roles are enforced on direct document API requests", async () => {
  const adminDocumentResponse = await adminAgent.post("/api/documents")
    .attach("file", png, { filename: "admin-owned.png", contentType: "image/png" });
  assert.equal(adminDocumentResponse.status, 201);
  const adminDocumentId = adminDocumentResponse.body.document.id;

  const owner = await inviteMember(adminAgent, "owner@example.test", "owner");
  const viewer = await inviteMember(adminAgent, "viewer@example.test", "viewer");
  const ownerDocumentResponse = await owner.post("/api/documents")
    .attach("file", png, { filename: "owner-owned.png", contentType: "image/png" });
  assert.equal(ownerDocumentResponse.status, 201);
  const ownerDocumentId = ownerDocumentResponse.body.document.id;

  assert.equal((await owner.get(`/api/documents/${ownerDocumentId}`)).status, 200);
  assert.equal((await adminAgent.get(`/api/documents/${ownerDocumentId}`)).status, 200);
  assert.equal((await adminAgent.get(`/api/documents/${ownerDocumentId}/download`)).status, 200);
  assert.equal((await owner.get(`/api/documents/${adminDocumentId}`)).status, 403);
  assert.equal((await owner.get(`/api/documents/${adminDocumentId}/permissions`)).status, 403);
  assert.equal((await owner.delete(`/api/documents/${adminDocumentId}`)).status, 403);

  assert.equal((await viewer.post("/api/documents")
    .attach("file", png, { filename: "forbidden.png", contentType: "image/png" })).status, 403);
  assert.equal((await viewer.get(`/api/documents/${ownerDocumentId}`)).status, 403);
  const adminUser = await User.findOne({ email: "admin@example.test" });
  assert.equal((await viewer.get(`/api/documents/${ownerDocumentId}?userId=${adminUser._id}`)).status, 403);
  assert.equal((await viewer.get(`/api/documents/${ownerDocumentId}/view`)).status, 403);
  assert.equal((await viewer.get(`/api/documents/${ownerDocumentId}/download`)).status, 403);
  assert.equal((await viewer.get(`/api/documents/${ownerDocumentId}/permissions`)).status, 403);
  assert.equal((await viewer.post(`/api/documents/${ownerDocumentId}/permissions`)
    .send({ email: "outsider@example.test", level: "download", role: "admin", userId: adminUser._id })).status, 403);
  assert.equal((await viewer.delete(`/api/documents/${ownerDocumentId}`)).status, 403);
  assert.equal((await viewer.patch(`/api/documents/${ownerDocumentId}`).send({ name: "renamed.png" })).status, 403);
  assert.ok(await AuditEvent.exists({ action: "document.edit", outcome: "denied" }));

  const ownerGrant = await owner.post(`/api/documents/${ownerDocumentId}/permissions`)
    .send({ email: "viewer@example.test", level: "view" });
  assert.equal(ownerGrant.status, 201);
  assert.equal((await viewer.get(`/api/documents/${ownerDocumentId}`)).status, 200);
  assert.equal((await viewer.get(`/api/documents/${ownerDocumentId}/view`)).status, 200);
  assert.equal((await viewer.get(`/api/documents/${ownerDocumentId}/download`)).status, 403);
  assert.equal((await viewer.delete(`/api/documents/${ownerDocumentId}/permissions/${ownerGrant.body.permission.id}`)).status, 403);
  assert.ok(await AuditEvent.exists({ action: "permission.revoke", outcome: "denied" }));

  assert.equal((await owner.delete(`/api/documents/${ownerDocumentId}/permissions/${ownerGrant.body.permission.id}`)).status, 204);
  assert.equal((await viewer.get(`/api/documents/${ownerDocumentId}/view`)).status, 403);

  const visibleToViewer = await viewer.get("/api/documents");
  assert.equal(visibleToViewer.status, 200);
  assert.deepEqual(visibleToViewer.body.documents, []);
  const visibleToAdmin = await adminAgent.get("/api/documents");
  assert.equal(visibleToAdmin.status, 200);
  assert.equal(visibleToAdmin.body.documents.length, 2);
});

test("edit grants allow metadata editing without download, deletion, or permission management", async () => {
  const uploaded = await adminAgent.post("/api/documents")
    .attach("file", png, { filename: "editable.png", contentType: "image/png" });
  assert.equal(uploaded.status, 201);
  const id = uploaded.body.document.id;
  const editor = await inviteMember(adminAgent, "metadata-editor@example.test", "viewer");
  const editorUser = await User.findOne({ email: "metadata-editor@example.test" });

  assert.equal((await editor.patch(`/api/documents/${id}`).send({ name: "before-grant.png" })).status, 403);
  const grant = await adminAgent.post(`/api/documents/${id}/permissions`)
    .send({ email: "metadata-editor@example.test", level: "edit" });
  assert.equal(grant.status, 201);
  assert.equal(grant.body.permission.level, "edit");

  const details = await editor.get(`/api/documents/${id}`);
  assert.equal(details.status, 200);
  assert.equal(details.body.document.canEdit, true);
  assert.equal(details.body.document.canDownload, false);
  assert.equal((await editor.get(`/api/documents/${id}/view`)).status, 200);
  assert.equal((await editor.get(`/api/documents/${id}/download`)).status, 403);
  const edited = await editor.patch(`/api/documents/${id}`).send({ name: "edited-by-viewer.png", category: "Legal" });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.document.name, "edited-by-viewer.png");
  assert.equal(edited.body.document.category, "Legal");

  // Edit capability is scoped to metadata and does not change the user's role.
  assert.equal((await editor.delete(`/api/documents/${id}`)).status, 403);
  assert.equal((await editor.get(`/api/documents/${id}/permissions`)).status, 403);
  assert.equal((await editor.post(`/api/documents/${id}/permissions`).send({ email: "outsider@example.test", level: "view" })).status, 403);
  assert.equal((await editor.delete(`/api/documents/${id}/permissions/${grant.body.permission.id}`)).status, 403);
  assert.equal((await editor.post("/api/workspaces/current/invitations").send({ email: "forged-role@example.test", role: "owner" })).status, 403);
  assert.equal((await Membership.findOne({ user: editorUser._id })).role, "viewer");

  // A member from another workspace cannot edit by supplying a forged role.
  assert.equal((await viewerAgent.patch(`/api/documents/${id}`).send({ name: "cross-workspace.png", role: "admin" })).status, 404);
  assert.equal((await Document.findById(id)).name, "edited-by-viewer.png");

  assert.equal((await adminAgent.delete(`/api/documents/${id}/permissions/${grant.body.permission.id}`)).status, 204);
  assert.equal((await editor.get(`/api/documents/${id}`)).status, 403);
  assert.equal((await editor.get(`/api/documents/${id}/view`)).status, 403);
  assert.equal((await editor.patch(`/api/documents/${id}`).send({ name: "after-revocation.png" })).status, 403);
  assert.equal((await Document.findById(id)).name, "edited-by-viewer.png");
  assert.ok(await AuditEvent.exists({ action: "document.edit", outcome: "denied", actor: editorUser._id, document: id }));
});

test("records successful and denied access events and limits audit visibility", async () => {
  const uploaded = await adminAgent.post("/api/documents")
    .attach("file", png, { filename: "audit.png", contentType: "image/png" });
  documentId = uploaded.body.document.id;
  const invitation = await adminAgent.post("/api/workspaces/current/invitations")
    .send({ email: "audit-viewer@example.test", role: "viewer" });
  const auditViewer = createAgent();
  await auditViewer.post("/api/auth/accept-invite").send({
    name: "Audit viewer",
    email: "audit-viewer@example.test",
    password: "Strong-password-123",
    invitationCode: invitation.body.invitationCode
  });
  await auditViewer.get(`/api/documents/${documentId}`);
  const adminLogs = await adminAgent.get("/api/audit-logs");
  const otherLogs = await auditViewer.get("/api/audit-logs");
  assert.equal(adminLogs.status, 200);
  assert.equal(otherLogs.status, 403);
  assert.ok(adminLogs.body.events.some((event) => event.action === "document.view" && event.outcome === "denied"));
});

test("audits document edits with safe request context and exposes no audit mutation API", async () => {
  const uploaded = await adminAgent.post("/api/documents")
    .attach("file", png, { filename: "before.png", contentType: "image/png" });
  assert.equal(uploaded.status, 201);
  const id = uploaded.body.document.id;
  const viewer = await inviteMember(adminAgent, "edit-viewer@example.test", "viewer");
  const denied = await viewer.patch(`/api/documents/${id}`).send({ name: "not-allowed.png" });
  assert.equal(denied.status, 403);
  const edited = await adminAgent.patch(`/api/documents/${id}`).send({ name: "after.png" });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.document.name, "after.png");
  assert.equal((await adminAgent.patch(`/api/documents/${id}`).send({ name: "../unsafe.png" })).status, 400);

  const editEvent = await AuditEvent.findOne({ action: "document.edit", outcome: "success", document: id }).lean();
  assert.ok(editEvent);
  assert.ok(editEvent.createdAt instanceof Date);
  assert.equal(String(editEvent.actor), String((await User.findOne({ email: "admin@example.test" }))._id));
  assert.equal(editEvent.metadata.method, "PATCH");
  assert.equal(editEvent.metadata.route, "/api/documents/:id");
  assert.deepEqual(editEvent.metadata.fields, ["name"]);
  assert.equal(JSON.stringify(editEvent).includes("Strong-password-123"), false);
  assert.ok(await AuditEvent.exists({ action: "document.edit", outcome: "denied", actor: (await User.findOne({ email: "edit-viewer@example.test" }))._id }));

  const countBefore = await AuditEvent.countDocuments();
  assert.equal((await adminAgent.post("/api/audit-logs").send({ action: "forged" })).status, 404);
  assert.equal((await adminAgent.patch(`/api/audit-logs/${editEvent._id}`).send({ outcome: "success" })).status, 404);
  assert.equal((await adminAgent.delete(`/api/audit-logs/${editEvent._id}`)).status, 404);
  assert.equal((await viewer.get("/api/audit-logs")).status, 403);
  assert.equal(await AuditEvent.countDocuments(), countBefore);
});

test("records document deletion only after the authorized deletion succeeds", async () => {
  const uploaded = await adminAgent.post("/api/documents")
    .attach("file", png, { filename: "delete.png", contentType: "image/png" });
  assert.equal(uploaded.status, 201);
  const id = uploaded.body.document.id;
  const deleted = await adminAgent.delete(`/api/documents/${id}`);
  assert.equal(deleted.status, 204);
  assert.equal(await Document.exists({ _id: id }), null);
  assert.ok(await AuditEvent.exists({ action: "document.delete", outcome: "success", document: id, actor: (await User.findOne({ email: "admin@example.test" }))._id }));
});

test("workspace admins can remove only their own members and revoke their grants", async () => {
  const uploaded = await adminAgent.post("/api/documents")
    .attach("file", png, { filename: "remove.png", contentType: "image/png" });
  const invitation = await adminAgent.post("/api/workspaces/current/invitations")
    .send({ email: "removable@example.test", role: "viewer" });
  const accepted = await createAgent().post("/api/auth/accept-invite").send({
    name: "Removable member",
    email: "removable@example.test",
    password: "Strong-password-123",
    invitationCode: invitation.body.invitationCode
  });
  assert.equal(accepted.status, 201);
  const member = await User.findOne({ email: "removable@example.test" });
  const grant = await adminAgent.post(`/api/documents/${uploaded.body.document.id}/permissions`)
    .send({ email: "removable@example.test", level: "view" });
  assert.equal(grant.status, 201);
  const removed = await adminAgent.delete(`/api/workspaces/current/members/${member._id}`);
  assert.equal(removed.status, 204);
  assert.equal(await Membership.exists({ user: member._id }), null);
  assert.ok(await Permission.exists({ document: uploaded.body.document.id, user: member._id, revokedAt: { $ne: null } }));
  assert.ok(await AuditEvent.exists({ action: "permission.revoke", outcome: "success", "metadata.reason": "member_removed" }));
  assert.ok(await AuditEvent.exists({ action: "workspace.member.remove", outcome: "success" }));
});

test("document search filters by name, workspace owner, category, and UTC upload date through the API", async () => {
  const first = await adminAgent.post("/api/documents").field("category", "Finance")
    .attach("file", png, { filename: "Quarterly report.png", contentType: "image/png" });
  const second = await adminAgent.post("/api/documents").field("category", "Legal")
    .attach("file", png, { filename: "Contract scan.png", contentType: "image/png" });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const legacy = await adminAgent.post("/api/documents").attach("file", png, { filename: "legacy.png", contentType: "image/png" });
  assert.equal(legacy.status, 201);
  await Document.collection.updateOne({ _id: new mongoose.Types.ObjectId(legacy.body.document.id) }, { $unset: { category: "" } });
  await Document.collection.updateOne({ _id: new mongoose.Types.ObjectId(first.body.document.id) }, { $set: { createdAt: new Date("2025-01-10T14:00:00.000Z") } });
  await Document.collection.updateOne({ _id: new mongoose.Types.ObjectId(second.body.document.id) }, { $set: { createdAt: new Date("2025-02-10T14:00:00.000Z") } });

  const byName = await adminAgent.get("/api/documents?name=Quarterly");
  assert.deepEqual(byName.body.documents.map((item) => item.id), [first.body.document.id]);
  assert.equal((await adminAgent.get("/api/documents?name=.*")).body.documents.length, 0);
  const byOwner = await adminAgent.get("/api/documents?owner=admin%40example.test");
  assert.equal(byOwner.body.documents.length, 3);
  const formerOwner = await inviteMember(adminAgent, "former-owner@example.test", "owner");
  const formerOwnerUpload = await formerOwner.post("/api/documents").attach("file", png, { filename: "former-owner.png", contentType: "image/png" });
  assert.equal(formerOwnerUpload.status, 201);
  const formerOwnerUser = await User.findOne({ email: "former-owner@example.test" });
  assert.equal((await adminAgent.delete(`/api/workspaces/current/members/${formerOwnerUser._id}`)).status, 204);
  const byFormerOwner = await adminAgent.get("/api/documents?owner=former-owner%40example.test");
  assert.deepEqual(byFormerOwner.body.documents.map((item) => item.id), [formerOwnerUpload.body.document.id]);
  const byCategoryAndDate = await adminAgent.get("/api/documents?category=Finance&dateFrom=2025-01-10&dateTo=2025-01-10");
  assert.deepEqual(byCategoryAndDate.body.documents.map((item) => item.id), [first.body.document.id]);
  const oldDefaultCategory = await adminAgent.get("/api/documents?category=Other");
  assert.deepEqual(
    oldDefaultCategory.body.documents.map((item) => item.id).sort(),
    [legacy.body.document.id, formerOwnerUpload.body.document.id].sort()
  );
  assert.equal((await adminAgent.get("/api/documents?dateFrom=2025-02-11&dateTo=2025-02-01")).status, 400);
  assert.equal((await adminAgent.get("/api/documents?category=Payroll")).status, 400);

  const joined = await inviteMember(adminAgent, "same-workspace-viewer@example.test", "viewer");
  const privateUpload = await joined.post("/api/documents").attach("file", png, { filename: "viewer-private.png", contentType: "image/png" });
  assert.equal(privateUpload.status, 403);
  const visible = await joined.get("/api/documents?category=Finance");
  assert.equal(visible.status, 200);
  assert.equal(visible.body.documents.length, 0);
  assert.equal((await viewerAgent.get(`/api/documents?name=${encodeURIComponent("Quarterly")}`)).body.documents.length, 0);
});
