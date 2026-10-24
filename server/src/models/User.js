import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    authVersion: { type: Number, default: 0, select: false }
  },
  { timestamps: true }
);
userSchema.index({ email: 1 }, { unique: true });

export default mongoose.model("User", userSchema);
