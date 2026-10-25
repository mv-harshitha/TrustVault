import { getUploadMimeType } from "./upload.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

function readResponseBody(responseText) {
  try {
    return JSON.parse(responseText);
  } catch {
    return {};
  }
}

async function fetchApi(url, options) {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Unable to reach the TrustVault API. Check that the backend is running and CORS allows this frontend origin.");
    }
    throw error;
  }
}

export async function api(path, options = {}) {
  const response = await fetchApi(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: options.body instanceof FormData
      ? options.headers
      : { "Content-Type": "application/json", ...options.headers }
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

export function uploadDocument(file, category, onProgress = () => {}) {
  const data = new FormData();
  const mimeType = getUploadMimeType(file);
  const uploadFile = file.type ? file : new Blob([file], { type: mimeType });
  data.append("file", uploadFile, file.name);
  data.append("category", category);

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_URL}/documents`);
    request.withCredentials = true;
    request.timeout = 120000;
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      const body = readResponseBody(request.responseText);
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(body.error || `Upload failed (HTTP ${request.status}).`));
        return;
      }
      resolve(body);
    });
    request.addEventListener("error", () => {
      reject(new Error("Unable to reach the TrustVault API. Check that the backend is running and CORS allows this frontend origin."));
    });
    request.addEventListener("timeout", () => {
      reject(new Error("The upload timed out. Check your connection and try again."));
    });
    request.send(data);
  });
}

export async function getDocumentFile(id, action) {
  const response = await fetchApi(`${API_URL}/documents/${id}/${action}`, { credentials: "include" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Unable to access this document");
  }
  const disposition = response.headers.get("Content-Disposition") || "";
  const filename = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1] || "document");
  return { filename, url: URL.createObjectURL(await response.blob()) };
}

export async function downloadFile(id) {
  const { filename, url } = await getDocumentFile(id, "download");
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
