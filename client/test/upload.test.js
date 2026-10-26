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

test("upload page presents a keyboard-focusable drop target and visible native file picker", async () => {
  const uploadPage = await uploadSource();

  assert.match(uploadPage, /className=\{`drop-zone \$\{dragging \? "dragging" : ""\}`\}/);
  assert.match(uploadPage, /role="region"/);
  assert.match(uploadPage, /tabIndex=\{busy \? -1 : 0\}/);
  assert.match(uploadPage, /Drag your document from File Explorer and drop it here\./);
  const picker = uploadPage.match(/<input\s+className="browse-file-input"([\s\S]*?)\/>/);
  assert.ok(picker, "visible native file input should be present");
  assert.match(picker[1], /type="file"/);
  assert.match(picker[1], /aria-label="Browse Files"/);
  assert.match(picker[1], /accept="\.pdf,\.png,\.jpg,\.jpeg,application\/pdf,image\/png,image\/jpeg"/);
  assert.match(picker[1], /disabled=\{busy\}/);
  assert.doesNotMatch(uploadPage, /fileInputRef|diagnosticsEnabled|\.click\(\)/);
});

test("native file selection and drag-and-drop use the same validation and state handler", async () => {
  const uploadPage = await uploadSource();

  assert.match(uploadPage, /onDragOver=\{\(event\) => \{ event\.preventDefault\(\); setDragging\(true\); \}\}/);
  assert.match(uploadPage, /onDragLeave=\{\(\) => setDragging\(false\)\}/);
  assert.match(uploadPage, /onDrop=\{\(event\) => \{\s*event\.preventDefault\(\);\s*setDragging\(false\);\s*if \(!busy && event\.dataTransfer\.files\[0\]\) selectFile\(event\.dataTransfer\.files\[0\]\);\s*\}\}/);
  assert.match(uploadPage, /if \(candidate\) selectFile\(candidate, event\.target\)/);
  assert.match(uploadPage, /function selectFile\(candidate, input\) \{/);
  assert.match(uploadPage, /const validationError = validateUploadFile\(candidate\)/);
  assert.match(uploadPage, /setFileError\(validationError\)/);
  assert.match(uploadPage, /setFile\(validationError \? null : candidate\)/);
  assert.match(uploadPage, /if \(input\) input\.value = ""/);
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

test("native input resets after valid or invalid selections for same-file reselection", async () => {
  const uploadPage = await uploadSource();
  const selection = uploadPage.match(/function selectFile\(candidate, input\) \{([\s\S]*?)\n  \}/);

  assert.ok(selection, "shared file selection handler should be present");
  assert.ok(
    selection[1].indexOf("setFile(validationError ? null : candidate)") < selection[1].indexOf('input.value = ""'),
    "React state should capture validation result before resetting the native input"
  );
});

test("pasting only accepts clipboard file data and never file path text", async () => {
  const uploadPage = await uploadSource();

  assert.match(uploadPage, /const candidate = event\.clipboardData\?\.files\[0\]/);
  assert.match(uploadPage, /if \(!candidate\) return;\s*event\.preventDefault\(\);\s*selectFile\(candidate\)/);
  assert.match(uploadPage, /press Ctrl\+V to paste a copied file/);
  assert.doesNotMatch(uploadPage, /clipboardData\.getData|file\.path|webkitRelativePath/);
});

test("accepts supported PDF, PNG, and JPEG files within the 40 MB limit", () => {
  assert.equal(validateUploadFile(file("report.pdf", "application/pdf")), "");
  assert.equal(validateUploadFile(file("image.png", "image/png")), "");
  assert.equal(validateUploadFile(file("image.jpg", "image/jpeg")), "");
  assert.equal(validateUploadFile(file("image.jpeg", "image/jpeg")), "");
  assert.equal(validateUploadFile(file("maximum.pdf", "application/pdf", MAX_UPLOAD_SIZE)), "");
});

test("rejects unsupported extensions, mismatched MIME types, and oversized files", () => {
  assert.equal(validateUploadFile(null), "Choose a file to upload.");
  assert.equal(validateUploadFile(undefined), "Choose a file to upload.");
  assert.equal(validateUploadFile(file("notes.txt", "text/plain")), "Choose a verified PDF, PNG, or JPEG file.");
  assert.equal(validateUploadFile(file("report.pdf", "text/plain")), "Choose a verified PDF, PNG, or JPEG file.");
  assert.equal(validateUploadFile(file("image.png", "image/jpeg")), "Choose a verified PDF, PNG, or JPEG file.");
  assert.equal(validateUploadFile(file("too-large.pdf", "application/pdf", MAX_UPLOAD_SIZE + 1)), "File exceeds the 40 MB limit.");
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

test("regression test: file selection handler handles native picker, drag-and-drop, invalid files, and reselection", () => {
  let fileState = null;
  let fileErrorState = "";

  function setFile(f) { fileState = f; }
  function setFileError(e) { fileErrorState = e; }

  function selectFile(candidate, input) {
    const validationError = validateUploadFile(candidate);
    setFileError(validationError);
    setFile(validationError ? null : candidate);
    if (input) input.value = "";
  }

  const mockInput = { value: "C:\\fakepath\\document.pdf" };
  const validFile = file("document.pdf", "application/pdf", 1024);

  // 1. Native file selection of a valid file
  selectFile(validFile, mockInput);
  assert.equal(fileState, validFile);
  assert.equal(fileErrorState, "");
  assert.equal(mockInput.value, "", "native input value should reset to allow duplicate selection");

  // 2. Same-file reselection
  mockInput.value = "C:\\fakepath\\document.pdf";
  selectFile(validFile, mockInput);
  assert.equal(fileState, validFile);
  assert.equal(fileErrorState, "");
  assert.equal(mockInput.value, "", "native input value should reset again on same-file reselection");

  // 3. Selection of an invalid file
  const invalidFile = file("script.sh", "application/x-sh", 500);
  mockInput.value = "C:\\fakepath\\script.sh";
  selectFile(invalidFile, mockInput);
  assert.equal(fileState, null, "invalid file should clear selected file state");
  assert.equal(fileErrorState, "Choose a verified PDF, PNG, or JPEG file.");
  assert.equal(mockInput.value, "", "input value should reset even after invalid file selection");

  // 4. Reselection of same invalid file
  mockInput.value = "C:\\fakepath\\script.sh";
  selectFile(invalidFile, mockInput);
  assert.equal(fileState, null);
  assert.equal(fileErrorState, "Choose a verified PDF, PNG, or JPEG file.");
  assert.equal(mockInput.value, "");

  // 5. Drag-and-drop file selection (without input element)
  selectFile(validFile);
  assert.equal(fileState, validFile);
  assert.equal(fileErrorState, "");
});
