import test from "node:test";
import assert from "node:assert/strict";
import { MAX_UPLOAD_SIZE, validateUploadFile } from "../src/upload.js";

function file(name, type, size = 100) {
  return { name, type, size };
}

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
