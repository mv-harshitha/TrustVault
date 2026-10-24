import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMongoUri } from "../src/config/db.js";

test("MongoDB configuration requires a valid connection string", () => {
  assert.throws(() => validateMongoUri(undefined), /MONGODB_URI is required/);
  assert.throws(() => validateMongoUri("   "), /MONGODB_URI is required/);
  assert.throws(
    () => validateMongoUri("https://example.test/trustvault"),
    /mongodb:\/\/ or mongodb\+srv:\/\//
  );
  assert.throws(
    () => validateMongoUri("mongodb://127.0.0.1:27017/trustvault database"),
    /must not contain whitespace/
  );
});

test("MongoDB configuration accepts Atlas SRV and local connection strings", () => {
  const atlasUri = "mongodb+srv://cluster.example.mongodb.net/trustvault?retryWrites=true&w=majority";
  assert.equal(validateMongoUri(`  ${atlasUri}  `), atlasUri);
  assert.equal(
    validateMongoUri("mongodb://127.0.0.1:27017/trustvault"),
    "mongodb://127.0.0.1:27017/trustvault"
  );
});
