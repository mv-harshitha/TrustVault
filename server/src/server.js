import "dotenv/config";
import app from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/db.js";

const port = Number(process.env.PORT || 4000);
let httpServer;

function errorMessage(error) {
  return error instanceof Error ? error.message : "Unknown error";
}

async function shutdown(signal) {
  console.log(`${signal} received; shutting down TrustVault API`);
  if (httpServer) {
    await new Promise((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await disconnectDatabase();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error("TrustVault API shutdown failed:", errorMessage(error));
        process.exit(1);
      });
  });
}

try {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");
  const connection = await connectDatabase();
  console.log(`Connected to MongoDB database "${connection.name}"`);
  httpServer = app.listen(port, () => console.log(`TrustVault API listening on port ${port}`));
} catch (error) {
  console.error("Unable to start TrustVault API:", errorMessage(error));
  await disconnectDatabase().catch(() => {});
  process.exitCode = 1;
}
