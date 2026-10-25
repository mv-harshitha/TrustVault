import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { sessionChanged, sessionIdentity, watchSession } from "../src/session.js";

const admin = {
  user: { id: "admin-user" },
  role: "admin",
  company: { id: "workspace-a", name: "Snovasys" }
};
const viewer = {
  user: { id: "viewer-user" },
  role: "viewer",
  company: { id: "workspace-a", name: "Snovasys" }
};

function eventTarget(visibilityState) {
  const target = new EventTarget();
  if (visibilityState !== undefined) target.visibilityState = visibilityState;
  return target;
}

const activeObservers = new Set();
afterEach(() => {
  for (const observer of activeObservers) observer.stop();
  activeObservers.clear();
});

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("session identity includes user, workspace, and role", () => {
  assert.equal(sessionChanged(admin, { ...admin, user: { id: "admin-user" } }), false);
  assert.equal(sessionChanged(admin, viewer), true);
  assert.equal(sessionChanged(admin, { ...admin, company: { id: "workspace-b" } }), true);
  assert.equal(sessionChanged(admin, { ...admin, role: "owner" }), true);
  assert.equal(sessionChanged(admin, false), true);
  assert.equal(sessionIdentity(admin), JSON.stringify(["admin-user", "workspace-a", "admin"]));
});

test("tab focus revalidates and applies the identity returned by the shared session", async () => {
  const windowTarget = eventTarget();
  const applied = [];
  const sessions = [admin, viewer];
  const observer = watchSession({
    loadSession: async () => sessions.shift(),
    onSession: (session) => applied.push(session),
    onChecking() {},
    windowTarget,
    documentTarget: eventTarget("visible")
  });
  activeObservers.add(observer);

  await flush();
  assert.deepEqual(applied, [admin]);

  windowTarget.dispatchEvent(new Event("focus"));
  await flush();
  assert.deepEqual(applied, [admin, viewer]);
});

test("visibility changes revalidate only when the tab becomes visible", async () => {
  let calls = 0;
  const documentTarget = eventTarget("hidden");
  const observer = watchSession({
    loadSession: async () => { calls += 1; return admin; },
    onSession() {},
    onChecking() {},
    windowTarget: eventTarget(),
    documentTarget
  });
  activeObservers.add(observer);
  await flush();
  assert.equal(calls, 1);

  documentTarget.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(calls, 1);

  documentTarget.visibilityState = "visible";
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(calls, 2);
});

test("session verification failure logs out safely and stale responses are ignored", async () => {
  let resolveInitial;
  let calls = 0;
  const applied = [];
  const windowTarget = eventTarget();
  const observer = watchSession({
    loadSession: () => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { resolveInitial = resolve; });
      return Promise.reject(new Error("session unavailable"));
    },
    onSession: (session) => applied.push(session),
    onChecking() {},
    windowTarget,
    documentTarget: eventTarget("visible")
  });
  activeObservers.add(observer);

  windowTarget.dispatchEvent(new Event("focus"));
  await flush();
  assert.deepEqual(applied, [false]);

  resolveInitial(admin);
  await flush();
  assert.deepEqual(applied, [false]);
});

test("stopping the observer removes focus and visibility listeners", async () => {
  let calls = 0;
  const windowTarget = eventTarget();
  const documentTarget = eventTarget("visible");
  const observer = watchSession({
    loadSession: async () => { calls += 1; return admin; },
    onSession() {},
    onChecking() {},
    windowTarget,
    documentTarget
  });
  await flush();
  observer.stop();
  activeObservers.delete(observer);

  windowTarget.dispatchEvent(new Event("focus"));
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(calls, 1);
});
