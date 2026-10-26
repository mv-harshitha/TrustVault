import { useEffect, useState } from "react";
import { api } from "./api.js";

export function ProfileSettings({ onError, onNotice }) {
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [avatar, setAvatar] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    api("/auth/me").then((result) => {
      if (!active) return;
      setProfile(result.user);
      setName(result.user.name || "");
      setEmail(result.user.email || "");
      setAvatar(result.user.avatar || "");
    }).catch((error) => { if (active) onError(error.message); });
    return () => { active = false; };
  }, [onError]);
  function handleAvatarFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { onError("Avatar must be 2 MB or smaller."); return; }
    const reader = new FileReader();
    reader.onload = () => setAvatar(String(reader.result || ""));
    reader.readAsDataURL(file);
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/auth/me", { method: "PATCH", body: JSON.stringify({ name, email, avatar }) });
      setProfile(result.user);
      onNotice("Profile updated");
      setMessage("Profile saved successfully.");
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }
  function cancel() {
    if (profile) {
      setName(profile.name || "");
      setEmail(profile.email || "");
      setAvatar(profile.avatar || "");
    }
    setMessage("");
  }
  return <div><div className="page-heading"><span className="eyebrow">PROFILE</span><h1>Profile settings</h1><p>Manage your personal information.</p></div>
    {message && <div role="status" className="notice"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Dismiss notification">×</button></div>}
    <form className="panel" onSubmit={save} style={{ display: "grid", gap: 12, maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {avatar ? <img src={avatar} alt="Avatar preview" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover" }} /> : <span className="avatar" style={{ width: 72, height: 72, fontSize: 24 }}>{(name || "U").slice(0, 1).toUpperCase()}</span>}
        <label>Avatar image<input type="file" accept="image/*" onChange={handleAvatarFile} /></label>
      </div>
      <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} /></label>
      <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></label>
      <div style={{ display: "flex", gap: 12 }}>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
        <button type="button" onClick={cancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  </div>;
}
