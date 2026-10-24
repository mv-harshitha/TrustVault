import { test } from "node:test";
import assert from "node:assert/strict";
import { documentCategorySchema, documentUpdateSchema } from "../src/validators/index.js";

test("document update validation accepts name, category, or both", () => {
  assert.deepEqual(documentUpdateSchema.parse({ name: "Renamed report.pdf" }), { name: "Renamed report.pdf" });
  assert.deepEqual(documentUpdateSchema.parse({ category: "Finance" }), { category: "Finance" });
  assert.deepEqual(
    documentUpdateSchema.parse({ name: "  Quarterly plan.pdf  ", category: "Legal" }),
    { name: "Quarterly plan.pdf", category: "Legal" }
  );
});

test("document update validation rejects unsafe names and unknown fields", () => {
  assert.equal(documentUpdateSchema.safeParse({ name: "   " }).success, false);
  assert.equal(documentUpdateSchema.safeParse({ name: "../escape.pdf" }).success, false);
  assert.equal(documentUpdateSchema.safeParse({ name: "line\nbreak.pdf" }).success, false);
  assert.equal(documentUpdateSchema.safeParse({ name: "a".repeat(256) }).success, false);
  assert.equal(documentUpdateSchema.safeParse({ category: "Payroll" }).success, false);
  assert.equal(documentUpdateSchema.safeParse({ owner: "000000000000000000000000" }).success, false);
});

test("document categories are limited to the documented set", () => {
  for (const category of ["Finance", "Legal", "HR", "Operations", "Other"]) {
    assert.equal(documentCategorySchema.parse(category), category);
  }
  assert.equal(documentCategorySchema.safeParse("Payroll").success, false);
});
