import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("login, registration, and invitation password field can be shown and hidden accessibly", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const authScreen = app.slice(app.indexOf("export function AuthScreen"), app.indexOf("function Overview"));
  const passwordField = authScreen.match(/<label>Password([\s\S]*?)<\/label>/);

  assert.ok(passwordField, "shared authentication password field should exist");
  assert.match(passwordField[1], /type=\{showPassword \? "text" : "password"\}/);
  assert.match(passwordField[1], /aria-label=\{showPassword \? "Hide password" : "Show password"\}/);
  assert.match(passwordField[1], /aria-pressed=\{showPassword\}/);
  assert.match(passwordField[1], /type="button"/);
  assert.match(passwordField[1], /setShowPassword\(\(visible\) => !visible\)/);
  assert.match(passwordField[1], /<svg aria-hidden="true" focusable="false"/);
  assert.match(passwordField[1], /autoComplete=\{mode === "login" \? "current-password" : "new-password"\}/);
  assert.doesNotMatch(authScreen, /console\.|localStorage|sessionStorage/);
});

test("page uses normal left-to-right document scrolling without a global RTL scroller", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const htmlRule = css.match(/html\s*\{([^}]*)\}/)?.[1] ?? "";
  const bodyRule = css.match(/body\s*\{([^}]*)\}/)?.[1] ?? "";
  const rootRule = css.match(/#root\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(htmlRule, /direction:\s*ltr/);
  assert.match(htmlRule, /overflow-x:\s*hidden/);
  assert.match(bodyRule, /direction:\s*ltr/);
  assert.match(bodyRule, /overflow-x:\s*hidden/);
  assert.match(rootRule, /direction:\s*ltr/);
  assert.doesNotMatch(rootRule, /^\s*height:|overflow-y:\s*auto/m);
});

test("desktop sidebar has its own right-edge themed vertical scrollbar and mobile layout releases it", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const sidebarRule = css.match(/\.sidebar\s*\{([^}]*)\}/)?.[1] ?? "";
  const mobileRules = css.slice(css.indexOf("@media (max-width: 760px)"), css.indexOf("@media (max-width: 560px)"));

  assert.match(sidebarRule, /position:\s*fixed/);
  assert.match(sidebarRule, /height:\s*100vh/);
  assert.match(sidebarRule, /overflow-x:\s*hidden/);
  assert.match(sidebarRule, /overflow-y:\s*auto/);
  assert.match(sidebarRule, /overscroll-behavior:\s*contain/);
  assert.match(sidebarRule, /scrollbar-width:\s*thin/);
  assert.match(sidebarRule, /scrollbar-color:\s*#7188c5\s+#182437/);
  assert.match(css, /\.sidebar::-webkit-scrollbar\s*\{\s*width:\s*8px/);
  assert.match(css, /\.sidebar::-webkit-scrollbar-thumb\s*\{\s*background:\s*#7188c5/);
  assert.match(mobileRules, /\.sidebar\s*\{[^}]*height:\s*auto;[^}]*overflow:\s*visible/);
});
