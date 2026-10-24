import mongoose from "mongoose";

const auditEventSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
    action: { type: String, required: true },
    document: { type: mongoose.Schema.Types.ObjectId, ref: "Document", default: null },
    outcome: { type: String, enum: ["success", "denied", "failure"], required: true },
    description: { type: String, maxlength: 500 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    requestId: { type: String, default: null }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
auditEventSchema.index({ company: 1, createdAt: -1 });
auditEventSchema.index({ document: 1, createdAt: -1 });

export default mongoose.model("AuditEvent", auditEventSchema);
