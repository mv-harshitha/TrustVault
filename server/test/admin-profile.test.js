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
let AuditEvent;
let adminAgent;
let memberAgent;
let otherAgent;
let nextClient = 1;

function createAgent() {
  const agent = request.agent(app);
  agent.set("X-Forwarded-For", `192.0.2.${nextClient++}`).set("Origin", "http://localhost:5173");
  return agent;
}

async function register(agent, email, companyName) {
  return agent.post("/api/auth/register").send({
    name: email.split("@")[0],
    email,
    password: "Strong-password-123",
    companyName
  });
}

async function inviteAndAccept(admin, email, role) {
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
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const [{ default: serverApp }, userModel, companyModel, membershipModel, auditModel] = await Promise.all([
    import("../src/app.js"),
    import("../src/models/User.js"),
    import("../src/models/Company.js"),
    import("../src/models/Membership.js"),
    import("../src/models/AuditEvent.js")
  ]);
  app = serverApp;
  User = userModel.default;
  Company = companyModel.default;
  Membership = membershipModel.default;
  AuditEvent = auditModel.default;
  setStorageClient({ storage: { getBucket: async () => ({ data: { id: "bucket", public: false }, error: null }), from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), download: async () => ({ data: new Blob([]), error: null }) }) } });
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Company.deleteMany({}), Membership.deleteMany({}), AuditEvent.deleteMany({})]);
  adminAgent = createAgent();
  await register(adminAgent, "admin@example.test", "Acme");
  memberAgent = await inviteAndAccept(adminAgent, "member@example.test", "viewer");
});

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test("non-admin cannot access admin endpoints", async () => {
  assert.equal((await memberAgent.get("/api/admin/stats")).status, 403);
  assert.equal((await memberAgent.get("/api/admin/users")).status, 403);
});

test("admin stats use real membership and audit data", async () => {
  const response = await adminAgent.get("/api/admin/stats");
  assert.equal(response.status, 200);
  assert.equal(response.body.users, 2);
  assert.equal(typeof response.body.documents, "number");
  assert.equal(typeof response.body.storageBytes, "number");
});

test("admin can change a member role", async () => {
  const users = await adminAgent.get("/api/admin/users");
  const member = users.body.members.find((item) => item.email === "member@example.test");
  assert.ok(member);
  const updated = await adminAgent.patch(`/api/admin/users/${member.id}`).send({ role: "owner" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.member.role, "owner");
});

test("last admin cannot be demoted", async () => {
  const users = await adminAgent.get("/api/admin/users");
  const admin = users.body.members.find((item) => item.email === "admin@example.test");
  const response = await adminAgent.patch(`/api/admin/users/${admin.id}`).send({ role: "viewer" });
  assert.equal(response.status, 400);
});

test("disabled account cannot access protected routes", async () => {
  const users = await adminAgent.get("/api/admin/users");
  const member = users.body.members.find((item) => item.email === "member@example.test");
  const disabled = await adminAgent.patch(`/api/admin/users/${member.id}`).send({ disabled: true });
  assert.equal(disabled.status, 200);
  assert.equal((await memberAgent.get("/api/auth/me")).status, 403);
});

test("profile update persists changes", async () => {
  const response = await memberAgent.patch("/api/auth/me").send({ name: "Updated Member", email: "updated@example.test" });
  assert.equal(response.status, 200);
  assert.equal(response.body.user.name, "Updated Member");
  assert.equal(response.body.user.email, "updated@example.test");
  const me = await memberAgent.get("/api/auth/me");
  assert.equal(me.body.user.name, "Updated Member");
});

test("password change revokes other sessions", async () => {
  otherAgent = createAgent();
  const login = await otherAgent.post("/api/auth/login").send({ email: "member@example.test", password: "Strong-password-123" });
  assert.equal(login.status, 200);
  const changed = await memberAgent.post("/api/auth/me/password").send({ currentPassword: "Strong-password-123", newPassword: "New-strong-password-123" });
  assert.equal(changed.status, 204);
  assert.equal((await otherAgent.get("/api/auth/me")).status, 401);
  assert.equal((await memberAgent.get("/api/auth/me")).status, 200);
});

test("user cannot assign admin role through profile endpoint", async () => {
  const response = await memberAgent.patch("/api/auth/me").send({ role: "admin" });
  assert.equal(response.status, 400);
});
