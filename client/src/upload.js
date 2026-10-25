export const MAX_UPLOAD_SIZE = 40 * 1024 * 1024;

const allowedTypes = new Map([
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"]
]);

export function getUploadMimeType(file) {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return allowedTypes.get(extension) || "";
}

export function validateUploadFile(file) {
  if (!file) return "Choose a file to upload.";
  if (file.size > MAX_UPLOAD_SIZE) return "File exceeds the 40 MB limit.";

  const expectedType = getUploadMimeType(file);
  if (!expectedType || (file.type && file.type !== expectedType)) {
    return "Choose a verified PDF, PNG, or JPEG file.";
  }

  return "";
}
