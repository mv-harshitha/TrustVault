const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
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

export async function getDocumentFile(id, action) {
  const response = await fetch(`${API_URL}/documents/${id}/${action}`, { credentials: "include" });
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
