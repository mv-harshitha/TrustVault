import { createClient } from "@supabase/supabase-js";

let storage;

export function getStorage() {
  if (storage) return storage;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY
    || SUPABASE_URL.includes("your-project")
    || SUPABASE_SERVICE_ROLE_KEY.includes("your-server-only-service-role-key")) {
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
  const bucket = process.env.SUPABASE_BUCKET;
  if (!bucket) throw new Error("SUPABASE_BUCKET is required");
  return bucket;
}

export async function getPrivateBucketStorage() {
  const storage = getStorage();
  const bucket = getBucket();
  const { data, error } = await storage.storage.getBucket(bucket);
  if (error || data?.public !== false) {
    throw new Error("Configured Supabase bucket is unavailable or not private");
  }
  return { storage, bucket };
}
