import mongoose from "mongoose";

const companySchema = new mongoose.Schema(
  { name: { type: String, required: true, trim: true, maxlength: 120 } },
  { timestamps: true }
);

export default mongoose.model("Company", companySchema);
