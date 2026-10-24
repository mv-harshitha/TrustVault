import mongoose from "mongoose";

const mongodbUriPattern = /^mongodb(?:\+srv)?:\/\//;
const databaseName = "trustvault";
// Atlas database users authenticate against the admin database. Without this,
// the driver inherits the dbName below and authentication fails even with
// correct credentials.
const authSource = "admin";
let connectionPromise = null;

function redactMongoUris(message) {
  return String(message).replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, "[redacted MongoDB URI]");
}

export function validateMongoUri(uri) {
  const value = typeof uri === "string" ? uri.trim() : "";
  if (!value) throw new Error("MONGODB_URI is required");
  if (!mongodbUriPattern.test(value)) {
    throw new Error("MONGODB_URI must use the mongodb:// or mongodb+srv:// scheme");
  }
  if (/\s/.test(value)) throw new Error("MONGODB_URI must not contain whitespace");
  return value;
}

export async function connectDatabase(uri = process.env.MONGODB_URI) {
  const mongoUri = validateMongoUri(uri);
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (mongoose.connection.readyState === 2) return mongoose.connection.asPromise();
  if (connectionPromise) return connectionPromise;

  connectionPromise = mongoose.connect(mongoUri, {
    dbName: databaseName,
    authSource,
    serverSelectionTimeoutMS: 15_000,
    appName: "TrustVault"
  }).then(() => mongoose.connection).catch((error) => {
    const message = error instanceof Error ? error.message : "unknown connection error";
    throw new Error(`MongoDB connection failed: ${redactMongoUris(message)}`);
  }).finally(() => {
    connectionPromise = null;
  });

  return connectionPromise;
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
