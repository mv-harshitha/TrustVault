export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

const allowedTypes = new Map([
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"]
]);

export function validateUploadFile(file) {
  if (!file) return "Choose a file to upload.";
  if (file.size > MAX_UPLOAD_SIZE) return "File exceeds the 10 MB limit.";

  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const expectedType = allowedTypes.get(extension);
  if (!expectedType || file.type !== expectedType) {
    return "Choose a verified PDF, PNG, or JPEG file.";
  }

  return "";
}
