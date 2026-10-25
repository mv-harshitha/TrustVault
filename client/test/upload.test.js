import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getUploadMimeType, MAX_UPLOAD_SIZE, validateUploadFile } from "../src/upload.js";

function file(name, type, size = 100) {
  return { name, type, size };
}

test("upload picker exposes a keyboard-accessible Browse button with one click path", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const uploadPage = app.slice(app.indexOf("function UploadPage"), app.indexOf("function DocumentDetails"));
  const input = uploadPage.match(/<input\s+ref=\{fileInputRef\}([\s\S]*?)\/>/);
  const browseButton = uploadPage.match(/<button className="browse-button"([\s\S]*?)<\/button>/);

  assert.ok(input, "file input should be present");
  assert.ok(browseButton, "an explicit Browse files button should be present");
  assert.match(input[1], /type="file"/);
  assert.match(input[1], /tabIndex=\{-1\}/);
  assert.match(input[1], /onChange=/);
  assert.match(browseButton[1], /type="button"/);
  assert.match(browseButton[1], /event\.stopPropagation\(\)/);
  assert.match(browseButton[1], /fileInputRef\.current\?\.click\(\)/);
  assert.match(uploadPage, /onClick=\{openFilePicker\}/);
  assert.match(uploadPage, /fileInputRef\.current\?\.click\(\)/);
  assert.doesNotMatch(uploadPage, /onKeyDown=/);
  assert.match(browseButton[1], /disabled=\{busy\}/);
  assert.match(input[1], /accept="\.pdf,\.png,\.jpg,\.jpeg,application\/pdf,image\/png,image\/jpeg"/);
});

test("file selection, validation, drop, and upload state remain connected", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../src/api.js", import.meta.url), "utf8");
  const uploadPage = app.slice(app.indexOf("function UploadPage"), app.indexOf("function DocumentDetails"));

  assert.match(uploadPage, /event\.target\.files\[0\] \|\| null/);
  assert.match(uploadPage, /setFile\(validationError \? null : candidate\)/);
  assert.match(uploadPage, /if \(input\) input\.value = ""/);
  assert.match(uploadPage, /\{file \? file\.name : "Drop your file here, or browse"\}/);
  assert.match(uploadPage, /selectFile\(event\.dataTransfer\.files\[0\] \|\| null\)/);
  assert.match(uploadPage, /disabled=\{!file \|\| Boolean\(validateUploadFile\(file\)\) \|\| busy\}/);
  assert.doesNotMatch(uploadPage, /onCancel=/);
  assert.match(uploadPage, /event\.target\.closest\("button"\)/);
  assert.match(api, /new Blob\(\[file\], \{ type: mimeType \}\)/);
  assert.match(api, /data\.append\("file", uploadFile, file\.name\)/);
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

test("accepts supported files when the browser omits MIME and resolves the upload type by extension", () => {
  assert.equal(validateUploadFile(file("report.pdf", "")), "");
  assert.equal(validateUploadFile(file("image.png", "")), "");
  assert.equal(validateUploadFile(file("image.jpg", "")), "");
  assert.equal(validateUploadFile(file("image.jpeg", "")), "");
  assert.equal(getUploadMimeType(file("report.pdf", "")), "application/pdf");
  assert.equal(getUploadMimeType(file("image.png", "")), "image/png");
  assert.equal(getUploadMimeType(file("image.jpg", "")), "image/jpeg");
  assert.equal(getUploadMimeType(file("image.jpeg", "")), "image/jpeg");
  assert.equal(getUploadMimeType(file("notes.txt", "")), "");
});

test("rejects missing files and files larger than 10 MB", () => {
  assert.equal(validateUploadFile(null), "Choose a file to upload.");
  assert.equal(validateUploadFile(file("too-large.pdf", "application/pdf", MAX_UPLOAD_SIZE + 1)), "File exceeds the 10 MB limit.");
});
