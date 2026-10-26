import { useEffect, useState } from "react";
import { api } from "./api.js";

export function AccountSettings({ onError, onNotice }) {
  const [profile, setProfile] = useState(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    api("/auth/me").then((result) => { if (active) setProfile(result.user); }).catch((error) => { if (active) onError(error.message); });
    return () => { active = false; };
  }, [onError]);
  async function changePassword(event) {
    event.preventDefault();
    if (newPassword !== confirmPassword) { onError("New passwords do not match."); return; }
    setBusy(true);
    setMessage("");
    try {
      await api("/auth/me/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onNotice("Password changed");
      setMessage("Password updated successfully.");
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (!window.confirm("Log out of TrustVault?")) return;
    try {
      await api("/auth/logout", { method: "POST" });
      window.location.reload();
    } catch (error) {
      onError(error.message);
    }
  }
  return <div><div className="page-heading"><span className="eyebrow">ACCOUNT</span><h1>Account settings</h1><p>Security and session controls.</p></div>
    {message && <div role="status" className="notice"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Dismiss notification">×</button></div>}
    <div className="panel" style={{ maxWidth: 640, display: "grid", gap: 12 }}>
      <h3>Account information</h3>
      <p><strong>Name:</strong> {profile?.name || "…"}</p>
      <p><strong>Email:</strong> {profile?.email || "…"}</p>
      <p><strong>Status:</strong> {profile?.disabled ? "Disabled" : "Active"}</p>
    </div>
    <form className="panel" onSubmit={changePassword} style={{ maxWidth: 640, display: "grid", gap: 12, marginTop: 16 }}>
      <h3>Change password</h3>
      <label>Current password<div className="password-input-wrap"><input type={showCurrent ? "text" : "password"} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /><button type="button" className="password-toggle-btn" onClick={() => setShowCurrent((value) => !value)} aria-label={showCurrent ? "Hide current password" : "Show current password"}>{showCurrent ? "Hide" : "Show"}</button></div></label>
      <label>New password<div className="password-input-wrap"><input type={showNew ? "text" : "password"} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={10} /><button type="button" className="password-toggle-btn" onClick={() => setShowNew((value) => !value)} aria-label={showNew ? "Hide new password" : "Show new password"}>{showNew ? "Hide" : "Show"}</button></div></label>
      <label>Confirm new password<input type={showNew ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={10} /></label>
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "Updating…" : "Change password"}</button>
    </form>
    <div className="panel" style={{ maxWidth: 640, marginTop: 16 }}>
      <h3>Session</h3>
      <p>Your session is protected by an HTTP-only cookie. Logging out revokes the current session.</p>
      <button onClick={logout}>Log out</button>
    </div>
  </div>;
}
