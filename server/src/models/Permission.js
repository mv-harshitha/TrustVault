import mongoose from "mongoose";

const permissionSchema = new mongoose.Schema(
  {
    document: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    level: { type: String, enum: ["view", "download", "edit"], required: true },
    grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null }
  },
  { timestamps: true }
);
permissionSchema.index({ document: 1, user: 1, revokedAt: 1 });
permissionSchema.index({ document: 1, user: 1 }, { unique: true, partialFilterExpression: { revokedAt: null } });

export default mongoose.model("Permission", permissionSchema);
