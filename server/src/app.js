import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.js";
import workspaceRoutes from "./routes/workspaces.js";
import documentRoutes from "./routes/documents.js";
import adminRoutes from "./routes/admin.js";
import auditRoutes from "./routes/audit.js";
import { requestId } from "./middleware/requestId.js";
import { errorHandler } from "./middleware/errors.js";
import { requireTrustedOrigin } from "./middleware/origin.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  credentials: true
}));
app.use(requestId);
app.use(requireTrustedOrigin);
app.use(express.json({ limit: "4mb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/audit-logs", auditRoutes);
app.use("/api/admin", adminRoutes);
app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
app.use(errorHandler);

export default app;
