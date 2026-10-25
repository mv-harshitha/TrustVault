import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MAX_UPLOAD_SIZE, validateUploadFile } from "../src/upload.js";

function file(name, type, size = 100) {
  return { name, type, size };
}

test("upload picker uses a native label association and remains keyboard reachable", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const input = app.match(/<input\s+id="document-file-picker"([\s\S]*?)\/>/);
  const label = app.match(/<label\s+htmlFor="document-file-picker"([\s\S]*?)<\/label>/);

  assert.ok(input, "file input should be present");
  assert.ok(label, "upload drop zone should be an associated label");
  assert.match(input[1], /type="file"/);
  assert.doesNotMatch(input[1], /tabIndex=\{-1\}/);
  assert.match(input[1], /onChange=/);
  assert.match(label[1], /onDrop=/);
  assert.doesNotMatch(label[1], /onClick=|onKeyDown=/);
  assert.doesNotMatch(app, /fileInputRef\.current\?\.click\(\)/);
  assert.match(input[1], /accept="\.pdf,\.png,\.jpg,\.jpeg,application\/pdf,image\/png,image\/jpeg"/);
});

test("file selection, validation, drop, and upload state remain connected", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const uploadPage = app.slice(app.indexOf("function UploadPage"), app.indexOf("function DocumentDetails"));

  assert.match(uploadPage, /event\.target\.files\[0\] \|\| null/);
  assert.match(uploadPage, /setFile\(validationError \? null : candidate\)/);
  assert.match(uploadPage, /if \(input\) input\.value = ""/);
  assert.match(uploadPage, /\{file \? file\.name : "Drop your file here, or browse"\}/);
  assert.match(uploadPage, /selectFile\(event\.dataTransfer\.files\[0\] \|\| null\)/);
  assert.match(uploadPage, /disabled=\{!file \|\| Boolean\(validateUploadFile\(file\)\) \|\| busy\}/);
  assert.doesNotMatch(uploadPage, /onCancel=/);
});

test("accepts supported PDF, PNG, and JPEG files within the size limit", () => {
  assert.equal(validateUploadFile(file("report.pdf", "application/pdf")), "");
  assert.equal(validateUploadFile(file("image.png", "image/png")), "");
  assert.equal(validateUploadFile(file("image.jpg", "image/jpeg")), "");
  assert.equal(validateUploadFile(file("image.jpeg", "image/jpeg")), "");
  assert.equal(validateUploadFile(file("maximum.pdf", "application/pdf", MAX_UPLOAD_SIZE)), "");
});

test("rejects unsupported extensions and mismatched MIME types", () => {
  assert.equal(validateUploadFile(file("notes.txt", "text/plain")), "Choose a verified PDF, PNG, or JPEG file.");
  assert.equal(validateUploadFile(file("report.pdf", "text/plain")), "Choose a verified PDF, PNG, or JPEG file.");
  assert.equal(validateUploadFile(file("image.png", "image/jpeg")), "Choose a verified PDF, PNG, or JPEG file.");
});

test("rejects missing files and files larger than 10 MB", () => {
  assert.equal(validateUploadFile(null), "Choose a file to upload.");
  assert.equal(validateUploadFile(file("too-large.pdf", "application/pdf", MAX_UPLOAD_SIZE + 1)), "File exceeds the 10 MB limit.");
});
