import mongoose from "mongoose";

const documentSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 255 },
    category: { type: String, enum: ["Finance", "Legal", "HR", "Operations", "Other"], default: "Other", required: true },
    storagePath: { type: String, required: true, unique: true, select: false },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 1 }
  },
  { timestamps: true }
);

export default mongoose.model("Document", documentSchema);
