import "dotenv/config";
import app from "./app.js";
import { connectDatabase } from "./config/db.js";

const port = Number(process.env.PORT || 4000);

try {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");
  await connectDatabase();
  app.listen(port, () => console.log(`TrustVault API listening on port ${port}`));
} catch (error) {
  console.error("Unable to start TrustVault API:", error);
  process.exitCode = 1;
}
