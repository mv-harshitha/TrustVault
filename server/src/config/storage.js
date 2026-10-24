import { createClient } from "@supabase/supabase-js";

let storage;

export function getStorage() {
  if (storage) return storage;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Private file storage is not configured");
  }
  storage = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return storage;
}

export function setStorageClient(client) {
  storage = client;
}

export function getBucket() {
  return process.env.SUPABASE_BUCKET || "trustvault-private";
}
