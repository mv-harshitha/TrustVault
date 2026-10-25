import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getUploadMimeType, MAX_UPLOAD_SIZE, validateUploadFile } from "../src/upload.js";

function file(name, type, size = 100) {
  return { name, type, size };
}

test("upload area uses the native file input directly without scripted click forwarding", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const uploadPage = app.slice(app.indexOf("function UploadPage"), app.indexOf("function DocumentDetails"));
  const dropZone = uploadPage.match(/<div\s+className=\{`drop-zone[\s\S]*?<\/div>/);
  const input = uploadPage.match(/<input\s+className="file-input"([\s\S]*?)\/>/);
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.ok(input, "file input should be present");
  assert.ok(dropZone, "drop zone should be present");
  assert.match(input[1], /type="file"/);
  assert.match(input[1], /aria-label="Browse files"/);
  assert.doesNotMatch(input[1], /tabIndex=/);
  assert.match(styles, /\.file-input \{ position: absolute; inset: 0; z-index: 1;/);
  assert.match(styles, /opacity: 0; cursor: pointer;/);
  assert.match(input[1], /onChange=/);
  assert.doesNotMatch(dropZone[0].split("<input")[0], /onClick=|onKeyDown=/);
  assert.doesNotMatch(uploadPage, /\.click\(\)/);
  assert.match(input[1], /disabled=\{busy\}/);
  assert.match(input[1], /accept="\.pdf,\.png,\.jpg,\.jpeg,application\/pdf,image\/png,image\/jpeg"/);
  assert.doesNotMatch(styles, /\.file-input\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(styles, /\.file-input\s*\{[^}]*visibility:\s*hidden/);
});

test("native input change stores non-empty selections and leaves empty/cancel changes untouched", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../src/api.js", import.meta.url), "utf8");
  const uploadPage = app.slice(app.indexOf("function UploadPage"), app.indexOf("function DocumentDetails"));
  const selection = uploadPage.match(/function selectFile\(candidate, input\) \{([\s\S]*?)\n  \}/);

  assert.match(uploadPage, /const candidate = event\.target\.files\[0\]/);
  assert.match(uploadPage, /const candidate = event\.target\.files\[0\];/);
  assert.match(uploadPage, /if \(candidate\) selectFile\(candidate, event\.target\);/);
  assert.ok(selection, "file selection handler should be present");
  assert.ok(selection[1].indexOf("setFile(validationError ? null : candidate)") < selection[1].indexOf("input.value = \"\""), "React state should be updated before the native input is reset");
  assert.match(uploadPage, /\{file \? file\.name : "Drop your file here, or browse"\}/);
  assert.match(uploadPage, /selectFile\(event\.dataTransfer\.files\[0\] \|\| null\)/);
  assert.match(uploadPage, /disabled=\{!file \|\| Boolean\(validateUploadFile\(file\)\) \|\| busy\}/);
  assert.doesNotMatch(uploadPage, /onCancel=/);
  assert.match(api, /new Blob\(\[file\], \{ type: mimeType \}\)/);
  assert.match(api, /data\.append\("file", uploadFile, file\.name\)/);
});

test("development diagnostics report file selection without exposing file paths or contents", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const uploadPage = app.slice(app.indexOf("function UploadPage"), app.indexOf("function DocumentDetails"));

  assert.match(uploadPage, /const diagnosticsEnabled = import\.meta\.env\.DEV/);
  assert.match(uploadPage, /\{diagnosticsEnabled && <section className="upload-diagnostics"/);
  assert.match(uploadPage, /onClick=\{\(\) => \{\s*if \(diagnosticsEnabled\) setDiagnostics/);
  assert.match(uploadPage, /changeFired:\s*true/);
  assert.match(uploadPage, /filesReceived,/);
  assert.match(uploadPage, /extension,/);
  assert.match(uploadPage, /validationError \? `Failed: \$\{validationError\}` : "Passed"/);
  assert.match(uploadPage, /reactStateUpdated:\s*true/);
  assert.match(uploadPage, /nativeInputMounted/);
  assert.match(uploadPage, /nativeInputEnabled:\s*Boolean\(input && !input\.disabled\)/);
  assert.doesNotMatch(uploadPage, /file\.path|file\.content|file\.webkitRelativePath/);
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

test("selecting the same file again is supported because the input is reset after selection", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const uploadPage = app.slice(app.indexOf("function UploadPage"), app.indexOf("function DocumentDetails"));
  const selection = uploadPage.match(/function selectFile\(candidate, input\) \{([\s\S]*?)\n  \}/);
  assert.ok(selection);
  assert.ok(selection[1].indexOf("setFile(validationError ? null : candidate)") < selection[1].indexOf("input.value = \"\""));
});

test("drag-and-drop continues to select the dropped file", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const uploadPage = app.slice(app.indexOf("function UploadPage"), app.indexOf("function DocumentDetails"));
  assert.match(uploadPage, /onDragOver=\{\(event\) => \{ event\.preventDefault\(\); setDragging\(true\); \}\}/);
  assert.match(uploadPage, /onDrop=\{\(event\) => \{\s*event\.preventDefault\(\);\s*setDragging\(false\);\s*if \(!busy\) selectFile\(event\.dataTransfer\.files\[0\] \|\| null\);\s*\}\}/);
});

test("rejects missing files and files larger than 10 MB", () => {
  assert.equal(validateUploadFile(null), "Choose a file to upload.");
  assert.equal(validateUploadFile(file("too-large.pdf", "application/pdf", MAX_UPLOAD_SIZE + 1)), "File exceeds the 10 MB limit.");
});
