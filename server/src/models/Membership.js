import mongoose from "mongoose";

const membershipSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    role: { type: String, enum: ["admin", "owner", "viewer"], required: true }
  },
  { timestamps: true }
);
membershipSchema.index({ user: 1, company: 1 }, { unique: true });
membershipSchema.index({ company: 1, role: 1 });

export default mongoose.model("Membership", membershipSchema);
