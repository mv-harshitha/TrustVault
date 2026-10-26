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

test("page scrollbar is on the left while page content stays left-to-right", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const htmlRule = css.match(/html\s*\{([^}]*)\}/)?.[1] ?? "";
  const bodyRule = css.match(/body\s*\{([^}]*)\}/)?.[1] ?? "";
  const rootRule = css.match(/#root\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(htmlRule, /direction:\s*rtl/);
  assert.match(htmlRule, /overflow:\s*hidden/);
  assert.match(bodyRule, /direction:\s*ltr/);
  assert.match(bodyRule, /overflow:\s*hidden/);
  assert.match(rootRule, /direction:\s*rtl/);
  assert.match(rootRule, /overflow-y:\s*auto/);
  assert.match(rootRule, /scrollbar-gutter:\s*stable/);
  assert.match(rootRule, /scroll-behavior:\s*smooth/);
  assert.match(css, /#root\s*>\s*\*\s*\{\s*direction:\s*ltr/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*#root\s*\{\s*scroll-behavior:\s*auto/);
});
