import { useEffect, useState } from "react";
import { api } from "./api.js";

export function AdminDashboard({ onError }) {
  const [stats, setStats] = useState(null);
  const [members, setMembers] = useState([]);
  const [events, setEvents] = useState([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      setBusy(true);
      try {
        const [statsResult, usersResult, auditResult] = await Promise.all([
          api("/admin/stats"),
          api("/admin/users"),
          api("/audit-logs")
        ]);
        if (!active) return;
        setStats(statsResult);
        setMembers(usersResult.members || []);
        setEvents(auditResult.events || []);
      } catch (error) {
        if (active) onError(error.message);
      } finally {
        if (active) setBusy(false);
      }
    }
    load();
    return () => { active = false; };
  }, [onError]);
  async function updateUser(userId, patch) {
    setBusy(true);
    setMessage("");
    try {
      const result = await api(`/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify(patch) });
      setMembers((current) => current.map((member) => member.id === userId ? { ...member, ...result.member } : member));
      setMessage("User updated.");
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }
  const filteredMembers = members.filter((member) => {
    const query = search.trim().toLowerCase();
    if (query && !member.name.toLowerCase().includes(query) && !member.email.toLowerCase().includes(query)) return false;
    if (roleFilter && member.role !== roleFilter) return false;
    return true;
  });
  return <div><div className="page-heading"><span className="eyebrow">ADMINISTRATION</span><h1>Admin dashboard</h1><p>Workspace users, documents, storage, and activity.</p></div>
    {message && <div role="status" className="notice"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Dismiss notification">×</button></div>}
    <div className="stats-grid">
      <div className="panel stat-card"><strong>{stats?.users ?? "…"}</strong><span>Registered users</span></div>
      <div className="panel stat-card"><strong>{stats?.documents ?? "…"}</strong><span>Uploaded documents</span></div>
      <div className="panel stat-card"><strong>{stats ? `${(stats.storageBytes / (1024 * 1024)).toFixed(1)} MB` : "…"}</strong><span>Storage used</span></div>
    </div>
    <div className="panel" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users" aria-label="Search users" />
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} aria-label="Filter by role">
          <option value="">All roles</option><option value="admin">Admin</option><option value="owner">Owner</option><option value="viewer">Viewer</option>
        </select>
      </div>
      {busy && <p>Loading…</p>}
      <div className="table-wrap"><table><thead><tr><th>USER</th><th>ROLE</th><th>STATUS</th><th>JOINED</th><th>ACTIONS</th></tr></thead><tbody>
        {filteredMembers.map((member) => <tr key={member.id}>
          <td><strong>{member.name}</strong><br /><small>{member.email}</small></td>
          <td><select value={member.role} disabled={busy} onChange={(event) => updateUser(member.id, { role: event.target.value })}><option value="admin">Admin</option><option value="owner">Owner</option><option value="viewer">Viewer</option></select></td>
          <td>{member.disabled ? "Disabled" : "Active"}</td>
          <td>{new Date(member.joinedAt).toLocaleDateString()}</td>
          <td><button disabled={busy} onClick={() => updateUser(member.id, { disabled: !member.disabled })}>{member.disabled ? "Enable" : "Disable"}</button></td>
        </tr>)}
      </tbody></table></div>
    </div>
    <div className="panel" style={{ marginTop: 16 }}>
      <h3>Recent activity</h3>
      {!events.length ? <p>No activity yet.</p> : <div className="audit-list">{events.map((event) => <div className="audit-row" key={event._id}><span className={`audit-dot ${event.outcome}`} /><span className="audit-copy"><strong>{event.action.replaceAll(".", " ")}</strong><small>{event.actor?.name || "Unknown user"}</small></span><span className={`outcome ${event.outcome}`}>{event.outcome}</span><time>{new Date(event.createdAt).toLocaleString()}</time></div>)}</div>}
    </div>
  </div>;
}
