import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
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
let adminAgent;
let viewerAgent;
let documentId;

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

before(async () => {
  process.env.JWT_SECRET = "test-only-secret-with-sufficient-length";
  process.env.CLIENT_ORIGIN = "http://localhost:5173";
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
  app = serverApp;
  User = userModel.default;
  Company = companyModel.default;
  Membership = membershipModel.default;
  Document = documentModel.default;
  Permission = permissionModel.default;
  AuditEvent = auditModel.default;
  setStorageClient(fakeStorage());
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Company.deleteMany({}),
    Membership.deleteMany({}),
    Document.deleteMany({}),
    Permission.deleteMany({}),
    AuditEvent.deleteMany({})
  ]);
  adminAgent = request.agent(app);
  viewerAgent = request.agent(app);
  await register(adminAgent, "admin@example.test", "Acme");
  await register(viewerAgent, "outsider@example.test", "Other Company");
});

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test("registers and logs in; rejects invalid credentials", async () => {
  const response = await request(app).post("/api/auth/login").send({
    email: "admin@example.test",
    password: "Strong-password-123"
  });
  assert.equal(response.status, 200);
  assert.match(response.headers["set-cookie"][0], /HttpOnly/);
  const invalid = await request(app).post("/api/auth/login").send({
    email: "admin@example.test",
    password: "incorrect"
  });
  assert.equal(invalid.status, 401);
  assert.ok(await AuditEvent.exists({ action: "auth.login", outcome: "failure" }));
});

test("protects routes without a session and revokes a session at logout", async () => {
  assert.equal((await request(app).get("/api/documents")).status, 401);
  const agent = request.agent(app);
  await register(agent, "logout@example.test", "Logout Co");
  assert.equal((await agent.post("/api/auth/logout")).status, 204);
  assert.equal((await agent.get("/api/auth/me")).status, 401);
});

test("uploads verified files, checks MIME and size, and serves downloads after authorization", async () => {
  const uploaded = await adminAgent.post("/api/documents")
    .attach("file", png, { filename: "report.png", contentType: "image/png" });
  assert.equal(uploaded.status, 201);
  documentId = uploaded.body.document.id;
  const forbiddenType = await adminAgent.post("/api/documents")
    .attach("file", Buffer.from("not a pdf"), { filename: "report.pdf", contentType: "application/pdf" });
  assert.equal(forbiddenType.status, 400);
  const oversized = await adminAgent.post("/api/documents")
    .attach("file", Buffer.alloc(10 * 1024 * 1024 + 1, 1), { filename: "large.png", contentType: "image/png" });
  assert.equal(oversized.status, 400);
  const downloaded = await adminAgent.get(`/api/documents/${documentId}/download`);
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.headers["content-disposition"], /report.png/);
  assert.ok(await AuditEvent.exists({ action: "document.upload", outcome: "success" }));
  assert.ok(await AuditEvent.exists({ action: "document.download", outcome: "success" }));
});

test("enforces workspace isolation, grant eligibility, permission level, expiry, and revocation", async () => {
  const uploaded = await adminAgent.post("/api/documents")
    .attach("file", png, { filename: "private.png", contentType: "image/png" });
  documentId = uploaded.body.document.id;
  assert.equal((await viewerAgent.get(`/api/documents/${documentId}`)).status, 404);

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
  const joined = await request.agent(app).post("/api/auth/accept-invite").send({
    name: "Member", email: "member@example.test", password: "Strong-password-123",
    invitationCode: invitation.body.invitationCode
  });
  assert.equal(joined.status, 201);
  const member = request.agent(app);
  await member.post("/api/auth/login").send({ email: "member@example.test", password: "Strong-password-123" });

  const deniedGrant = await member.post(`/api/documents/${documentId}/permissions`)
    .send({ email: "outsider@example.test", level: "download" });
  assert.equal(deniedGrant.status, 403);
  const granted = await adminAgent.post(`/api/documents/${documentId}/permissions`)
    .send({ email: "member@example.test", level: "view" });
  assert.equal(granted.status, 201);
  assert.equal((await member.get(`/api/documents/${documentId}`)).status, 200);
  assert.equal((await member.get(`/api/documents/${documentId}/download`)).status, 403);
  const downloadGrant = await adminAgent.post(`/api/documents/${documentId}/permissions`)
    .send({ email: "member@example.test", level: "download" });
  assert.equal(downloadGrant.status, 201);
  assert.equal((await member.get(`/api/documents/${documentId}/download`)).status, 200);
  assert.equal((await adminAgent.delete(`/api/documents/${documentId}/permissions/${downloadGrant.body.permission.id}`)).status, 204);
  assert.equal((await member.get(`/api/documents/${documentId}`)).status, 403);

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

test("records successful and denied access events and limits audit visibility", async () => {
  const uploaded = await adminAgent.post("/api/documents")
    .attach("file", png, { filename: "audit.png", contentType: "image/png" });
  documentId = uploaded.body.document.id;
  const invitation = await adminAgent.post("/api/workspaces/current/invitations")
    .send({ email: "audit-viewer@example.test", role: "viewer" });
  const auditViewer = request.agent(app);
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

test("workspace admins can remove only their own members and revoke their grants", async () => {
  const uploaded = await adminAgent.post("/api/documents")
    .attach("file", png, { filename: "remove.png", contentType: "image/png" });
  const invitation = await adminAgent.post("/api/workspaces/current/invitations")
    .send({ email: "removable@example.test", role: "viewer" });
  const accepted = await request.agent(app).post("/api/auth/accept-invite").send({
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
