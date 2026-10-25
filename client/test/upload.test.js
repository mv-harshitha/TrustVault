import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getUploadMimeType, MAX_UPLOAD_SIZE, validateUploadFile } from "../src/upload.js";

function file(name, type, size = 100) {
  return { name, type, size };
}

async function uploadSource() {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  return app.slice(app.indexOf("function UploadPage"), app.indexOf("function DocumentDetails"));
}

test("upload page presents a keyboard-focusable drag target without a native picker", async () => {
  const uploadPage = await uploadSource();

  assert.match(uploadPage, /className=\{`drop-zone \$\{dragging \? "dragging" : ""\}`\}/);
  assert.match(uploadPage, /role="region"/);
  assert.match(uploadPage, /tabIndex=\{busy \? -1 : 0\}/);
  assert.match(uploadPage, /Drag your document from File Explorer and drop it here\./);
  assert.doesNotMatch(uploadPage, /type="file"|Browse files|fileInputRef|diagnosticsEnabled/);
});

test("drag-and-drop selects the dropped file and preserves validation errors", async () => {
  const uploadPage = await uploadSource();

  assert.match(uploadPage, /onDragOver=\{\(event\) => \{ event\.preventDefault\(\); setDragging\(true\); \}\}/);
  assert.match(uploadPage, /onDragLeave=\{\(\) => setDragging\(false\)\}/);
  assert.match(uploadPage, /onDrop=\{\(event\) => \{\s*event\.preventDefault\(\);\s*setDragging\(false\);\s*if \(!busy && event\.dataTransfer\.files\[0\]\) selectFile\(event\.dataTransfer\.files\[0\]\);\s*\}\}/);
  assert.match(uploadPage, /const validationError = validateUploadFile\(candidate\)/);
  assert.match(uploadPage, /setFileError\(validationError\)/);
  assert.match(uploadPage, /setFile\(validationError \? null : candidate\)/);
  assert.match(uploadPage, /className="upload-error" role="alert"/);
});

test("valid dropped file name and size are displayed with a success indicator", async () => {
  const uploadPage = await uploadSource();

  assert.match(uploadPage, /\{file \? <>/);
  assert.match(uploadPage, /drop-zone-icon selected/);
  assert.match(uploadPage, /Document ready/);
  assert.match(uploadPage, /className="selected-file-name"\>\{file\.name\}/);
  assert.match(uploadPage, /className="selected-file-size"\>\{sizeLabel\(file\.size\)\}/);
});

test("upload button stays disabled until a valid file is selected", async () => {
  const uploadPage = await uploadSource();

  assert.match(uploadPage, /disabled=\{!file \|\| Boolean\(validateUploadFile\(file\)\) \|\| busy\}/);
  assert.match(uploadPage, /await uploadDocument\(file, category, setProgress\)/);
});

test("pasting only accepts clipboard file data and never file path text", async () => {
  const uploadPage = await uploadSource();

  assert.match(uploadPage, /const candidate = event\.clipboardData\?\.files\[0\]/);
  assert.match(uploadPage, /if \(!candidate\) return;\s*event\.preventDefault\(\);\s*selectFile\(candidate\)/);
  assert.match(uploadPage, /press Ctrl\+V to paste a copied file/);
  assert.doesNotMatch(uploadPage, /clipboardData\.getData|file\.path|webkitRelativePath/);
});

test("accepts supported PDF, PNG, and JPEG files within the 10 MB limit", () => {
  assert.equal(validateUploadFile(file("report.pdf", "application/pdf")), "");
  assert.equal(validateUploadFile(file("image.png", "image/png")), "");
  assert.equal(validateUploadFile(file("image.jpg", "image/jpeg")), "");
  assert.equal(validateUploadFile(file("image.jpeg", "image/jpeg")), "");
  assert.equal(validateUploadFile(file("maximum.pdf", "application/pdf", MAX_UPLOAD_SIZE)), "");
});

test("rejects unsupported extensions, mismatched MIME types, and oversized files", () => {
  assert.equal(validateUploadFile(file("notes.txt", "text/plain")), "Choose a verified PDF, PNG, or JPEG file.");
  assert.equal(validateUploadFile(file("report.pdf", "text/plain")), "Choose a verified PDF, PNG, or JPEG file.");
  assert.equal(validateUploadFile(file("image.png", "image/jpeg")), "Choose a verified PDF, PNG, or JPEG file.");
  assert.equal(validateUploadFile(file("too-large.pdf", "application/pdf", MAX_UPLOAD_SIZE + 1)), "File exceeds the 10 MB limit.");
});

test("accepts supported files when the browser omits MIME and resolves upload MIME by extension", () => {
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
