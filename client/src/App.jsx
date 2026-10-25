import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, downloadFile, getDocumentFile, uploadDocument } from "./api.js";
import { sessionChanged, watchSession } from "./session.js";
import { validateUploadFile } from "./upload.js";

const navItems = [
  ["overview", "Overview", "◫"],
  ["documents", "My documents", "▤"],
  ["shared", "Shared with me", "↗"],
  ["upload", "Upload document", "+"],
  ["audit", "Audit trail", "◷"],
  ["members", "Workspace members", "♙"]
];
const documentCategories = ["Finance", "Legal", "HR", "Operations", "Other"];
const dateLabel = (date) => new Date(date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const sizeLabel = (bytes) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export default function App() {
  const [account, setAccount] = useState(null);
  const [sessionChecking, setSessionChecking] = useState(true);
  const [page, setPage] = useState("overview");
  const [documents, setDocuments] = useState([]);
  const [events, setEvents] = useState([]);
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [documentEvents, setDocumentEvents] = useState([]);
  const [preview, setPreview] = useState(null);
  const accountRef = useRef(null);
  const previewRef = useRef(null);
  const sessionObserverRef = useRef(null);
  const sessionEpochRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState({ name: "", owner: "", category: "", dateFrom: "", dateTo: "" });

  const refresh = useCallback(async () => {
    if (!account) return false;
    const requestEpoch = sessionEpochRef.current;
    try {
      const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
      const result = await api(`/documents${params.size ? `?${params}` : ""}`);
      if (requestEpoch !== sessionEpochRef.current) return false;
      setDocuments(result.documents);
      return true;
    } catch (error) {
      if (requestEpoch === sessionEpochRef.current) setNotice(error.message);
      return false;
    }
  }, [account, filters]);

  const clearAccountState = useCallback(() => {
    sessionEpochRef.current += 1;
    setDocuments([]);
    setEvents([]);
    setMembers([]);
    setSelected(null);
    setPermissions([]);
    setDocumentEvents([]);
    if (previewRef.current?.url) URL.revokeObjectURL(previewRef.current.url);
    previewRef.current = null;
    setPreview(null);
    setFilters({ name: "", owner: "", category: "", dateFrom: "", dateTo: "" });
    setPage("overview");
    setNotice("");
  }, []);

  const applySession = useCallback((nextSession) => {
    if (sessionChanged(accountRef.current, nextSession)) clearAccountState();
    accountRef.current = nextSession;
    setAccount(nextSession);
  }, [clearAccountState]);

  useEffect(() => {
    const observer = watchSession({
      loadSession: () => api("/auth/me"),
      onSession: applySession,
      onChecking: setSessionChecking,
      windowTarget: window,
      documentTarget: document
    });
    sessionObserverRef.current = observer;
    return () => {
      observer.stop();
      if (sessionObserverRef.current === observer) sessionObserverRef.current = null;
    };
  }, [applySession]);

  useEffect(() => {
    const timer = window.setTimeout(refresh, 250);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if ((page === "audit" || page === "overview") && account?.role === "admin") {
      const requestEpoch = sessionEpochRef.current;
      api("/audit-logs").then((result) => {
        if (requestEpoch === sessionEpochRef.current) setEvents(result.events);
      }).catch((error) => {
        if (requestEpoch === sessionEpochRef.current) setNotice(error.message);
      });
    }
    if (page === "members" && account?.role === "admin") {
      const requestEpoch = sessionEpochRef.current;
      api("/workspaces/current/members").then((result) => {
        if (requestEpoch === sessionEpochRef.current) setMembers(result.members);
      }).catch((error) => {
        if (requestEpoch === sessionEpochRef.current) setNotice(error.message);
      });
    }
  }, [page, account]);

  const filteredDocs = useMemo(() => documents.filter((doc) => {
    const owned = String(doc.owner.id) === String(account?.user?.id);
    return page === "shared" ? !owned : page === "documents" ? owned : true;
  }), [documents, page, account]);

  async function signIn() {
    const session = await sessionObserverRef.current?.revalidate();
    if (!session) throw new Error("Unable to verify your session. Please sign in again.");
    setPage("overview");
  }

  async function logout() {
    setLogoutBusy(true);
    try {
      await api("/auth/logout", { method: "POST" });
      applySession(false);
    } catch (error) {
      setNotice(`Sign out failed: ${error.message}`);
    } finally {
      setLogoutBusy(false);
    }
  }

  async function openDocument(document) {
    const requestEpoch = sessionEpochRef.current;
    setBusy(true);
    setNotice("");
    try {
      const result = await api(`/documents/${document.id}`);
      if (requestEpoch !== sessionEpochRef.current) return;
      setSelected(result.document);
      if (account.role === "admin" || String(document.owner.id) === String(account.user.id)) {
        const grants = await api(`/documents/${document.id}/permissions`);
        if (requestEpoch !== sessionEpochRef.current) return;
        setPermissions(grants.permissions);
        const activity = await api(`/audit-logs/documents/${document.id}`);
        if (requestEpoch !== sessionEpochRef.current) return;
        setDocumentEvents(activity.events);
      } else {
        setPermissions([]);
        setDocumentEvents([]);
      }
    } catch (error) {
      if (requestEpoch === sessionEpochRef.current) setNotice(error.message);
    } finally {
      if (requestEpoch === sessionEpochRef.current) setBusy(false);
    }
  }

  async function downloadDocument(documentId) {
    const requestEpoch = sessionEpochRef.current;
    try {
      await downloadFile(documentId);
    } catch (error) {
      if (requestEpoch === sessionEpochRef.current) setNotice(error.message);
    }
  }

  async function viewDocument(documentId) {
    const requestEpoch = sessionEpochRef.current;
    try {
      const file = await getDocumentFile(documentId, "view");
      if (requestEpoch !== sessionEpochRef.current) {
        URL.revokeObjectURL(file.url);
        return;
      }
      previewRef.current = file;
      setPreview(file);
    } catch (error) {
      if (requestEpoch === sessionEpochRef.current) setNotice(error.message);
    }
  }

  function closePreview() {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    previewRef.current = null;
    setPreview(null);
  }

  async function deleteDocument(documentId) {
    if (!window.confirm("Delete this document permanently?")) return;
    const requestEpoch = sessionEpochRef.current;
    try {
      await api(`/documents/${documentId}`, { method: "DELETE" });
      if (requestEpoch !== sessionEpochRef.current) return;
      setSelected(null);
      await refresh();
      setNotice("Document deleted");
    } catch (error) {
      if (requestEpoch === sessionEpochRef.current) setNotice(error.message);
    }
  }

  async function updateDocument(documentId, changes) {
    const requestEpoch = sessionEpochRef.current;
    const result = await api(`/documents/${documentId}`, { method: "PATCH", body: JSON.stringify(changes) });
    if (requestEpoch !== sessionEpochRef.current) return;
    setSelected((current) => current && String(current.id) === String(documentId)
      ? { ...current, name: result.document.name, category: result.document.category }
      : current);
    setDocuments((current) => current.map((doc) => String(doc.id) === String(documentId)
      ? { ...doc, name: result.document.name, category: result.document.category }
      : doc));
    const refreshed = await refresh();
    if (refreshed) setNotice("Document details updated");
  }

  if (account === null || sessionChecking) return <div className="boot-screen"><div className="brand-mark">T</div><p>Opening your secure workspace...</p></div>;
  if (!account) return <AuthScreen onSuccess={signIn} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="#" className="brand" onClick={(event) => { event.preventDefault(); setPage("overview"); }}>
          <span className="brand-mark">T</span><span>trustvault<small>PRIVATE WORKSPACE</small></span>
        </a>
        <div className="workspace-card"><span className="workspace-icon">⌂</span><span><strong>{account.company?.name || "Your workspace"}</strong><small>{account.role} workspace</small></span><span className="caret">⌄</span></div>
        <nav aria-label="Workspace navigation">
          <span className="nav-heading">WORKSPACE</span>
          {navItems.map(([key, label, icon]) => {
            if ((key === "audit" || key === "members") && account.role !== "admin") return null;
            return <button key={key} className={`nav-link ${page === key ? "active" : ""}`} onClick={() => { setPage(key); setSelected(null); }}><span className="nav-icon">{icon}</span>{label}{key === "upload" && <span className="nav-plus">↗</span>}</button>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-note"><span className="shield">◈</span><span><strong>Your files stay private</strong><small>Every access is permission-checked and recorded.</small></span></div>
          <div className="profile">
            <span className="avatar">{account.user.name.slice(0, 1).toUpperCase()}</span>
            <span className="profile-identity"><strong>{account.user.name}</strong><small>{account.user.email}</small></span>
            <button className="sign-out-button" type="button" onClick={logout} disabled={logoutBusy} aria-label="Sign out">
              {logoutBusy ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{pageTitle(page, selected)}</strong></div><div className="top-actions"><span className="secure-label"><i /> Secure session</span><button className="icon-button" aria-label="Account settings">⚙</button></div></header>
        <section className="page-content">
          {preview && <div className="preview-overlay" role="dialog" aria-modal="true" aria-label={`Preview ${preview.filename}`}><div className="preview-dialog"><div className="preview-toolbar"><strong>{preview.filename}</strong><button className="icon-button" onClick={closePreview} aria-label="Close preview">×</button></div><iframe title={`Document preview: ${preview.filename}`} src={preview.url} /></div></div>}
          {notice && <div role="status" className="notice"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}
          {page === "overview" && <Overview account={account} documents={documents} events={events} onNavigate={setPage} onOpen={(doc) => { setPage("documents"); openDocument(doc); }} onDownload={downloadDocument} />}
          {page === "upload" && <UploadPage onUploaded={async () => { await refresh(); setPage("documents"); setNotice("Document uploaded securely"); }} onError={setNotice} />}
          {(page === "documents" || page === "shared") && (selected
            ? <DocumentDetails document={selected} permissions={permissions} events={documentEvents} account={account} sessionEpochRef={sessionEpochRef} onBack={() => setSelected(null)} onView={viewDocument} onDownload={downloadDocument} onDelete={deleteDocument} onUpdate={updateDocument} onError={setNotice} onPermissions={setPermissions} />
            : <DocumentsPage title={page === "shared" ? "Shared with me" : "My documents"} subtitle={page === "shared" ? "Documents other workspace members have shared with you." : "Documents you own and manage."} documents={filteredDocs} filters={filters} setFilters={setFilters} busy={busy} onOpen={openDocument} onDownload={downloadDocument} />)}
          {page === "audit" && <AuditPage events={events} />}
          {page === "members" && <MembersPage members={members} account={account} onMembers={setMembers} onError={setNotice} />}
        </section>
      </main>
    </div>
  );
}

function pageTitle(page, selected) {
  if (selected) return selected.name;
  return ({ overview: "Overview", documents: "My documents", shared: "Shared with me", upload: "Upload document", audit: "Audit trail", members: "Workspace members" })[page] || "Overview";
}

function AuthScreen({ onSuccess }) {
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const endpoint = mode === "join" ? "/auth/accept-invite" : `/auth/${mode}`;
      const result = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
      await onSuccess(result);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="auth-layout">
    <div className="auth-aside"><a href="#" className="brand brand-light"><span className="brand-mark">T</span><span>trustvault</span></a><div className="auth-message"><span className="eyebrow">CONFIDENTIAL BY DESIGN</span><h1>Your team's important work, in safe hands.</h1><p>Share sensitive documents with the people who need them. Every permission is explicit. Every access leaves a trace.</p><div className="auth-proof"><span>◈</span> Private storage <i /> <span>◷</span> Auditable access <i /> <span>⌑</span> Workspace isolation</div></div><span className="auth-footer">A clearer, safer way to share.</span></div>
    <div className="auth-main"><form className="auth-form" onSubmit={submit}>
      <span className="eyebrow">SECURE WORKSPACE ACCESS</span><h2>{mode === "login" ? "Welcome back" : mode === "join" ? "Join your workspace" : "Create your workspace"}</h2><p>{mode === "login" ? "Sign in to continue to your documents." : mode === "join" ? "Use the invitation code sent by your workspace administrator." : "Your account starts a private company workspace."}</p>
      {(mode === "register" || mode === "join") && <label>Your name<input name="name" required autoComplete="name" maxLength="100" placeholder="Jordan Lee" /></label>}
      {mode === "register" && <label>Company name<input name="companyName" required minLength="2" maxLength="120" placeholder="Acme Studio" /></label>}
      {mode === "join" && <label>Invitation code<input name="invitationCode" required minLength="32" maxLength="128" autoComplete="off" placeholder="Paste your workspace invitation code" /></label>}
      <label>Work email<input name="email" type="email" required autoComplete="email" placeholder="you@company.com" /></label>
      <label>Password<input name="password" type="password" required minLength={mode === "login" ? 1 : 10} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "login" ? "Your password" : "At least 10 characters"} /></label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="primary-button full-button" disabled={busy}>{busy ? "Please wait..." : mode === "login" ? "Sign in securely" : mode === "join" ? "Join workspace" : "Create workspace"} <span>→</span></button>
      <div className="auth-switch">{mode === "login" ? "New to TrustVault?" : mode === "join" ? "Don't have an invitation?" : "Already have an account?"} <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Create an account" : "Sign in"}</button></div>
      {mode === "login" && <div className="auth-switch invite-switch">Invited to a workspace? <button type="button" onClick={() => { setMode("join"); setError(""); }}>Join with a code</button></div>}
      {mode === "register" && <div className="auth-switch invite-switch">Joining an existing workspace? <button type="button" onClick={() => { setMode("join"); setError(""); }}>Use an invitation code</button></div>}
      <div className="auth-privacy">⌑ &nbsp; Your credentials are encrypted and never shared.</div>
    </form></div>
  </div>;
}

function Overview({ account, documents, events, onNavigate, onOpen, onDownload }) {
  const owned = documents.filter((doc) => String(doc.owner.id) === String(account.user.id)).length;
  const shared = documents.length - owned;
  return <div>
    <div className="welcome-row"><div><span className="eyebrow">YOUR WORKSPACE</span><h1>Good to see you, {account.user.name.split(" ")[0]}.</h1><p>Here's what's happening with your secure documents.</p></div><button className="primary-button" onClick={() => onNavigate("upload")}>＋ Upload document</button></div>
    <div className="stat-grid"><StatCard label="Accessible documents" value={documents.length} icon="▤" accent="blue" /><StatCard label="Owned by you" value={owned} icon="◈" accent="purple" /><StatCard label="Shared with you" value={shared} icon="↗" accent="green" /><StatCard label="Workspace role" value={account.role} icon="⌑" accent="amber" /></div>
    <div className="section-heading"><div><h2>Recent documents</h2><p>Your latest files, all in one place.</p></div><button className="text-button" onClick={() => onNavigate("documents")}>View all documents <span>→</span></button></div>
    <DocumentTable documents={documents.slice(0, 5)} onOpen={onOpen} onDownload={onDownload} />
    <div className="overview-lower"><div className="panel"><div className="panel-heading"><div><h3>Workspace protection</h3><p>Security checks that protect your files.</p></div><span className="status-chip"><i /> ACTIVE</span></div><div className="protection-row"><span className="protection-icon">⌑</span><span><strong>Private file storage</strong><small>Documents are never stored in a public folder.</small></span><b>Enabled</b></div><div className="protection-row"><span className="protection-icon">◈</span><span><strong>Explicit permissions</strong><small>Access is verified for every request.</small></span><b>Enabled</b></div><div className="protection-row"><span className="protection-icon">◷</span><span><strong>Audit trail</strong><small>Important actions are recorded server-side.</small></span><b>Enabled</b></div></div>
      <div className="panel quick-panel"><span className="quick-icon">↗</span><h3>Share with confidence</h3><p>Give teammates view-only or download access. Revoke it whenever you need to.</p><button className="text-button" onClick={() => onNavigate("documents")}>Manage documents <span>→</span></button></div></div>
    {account.role === "admin" && events.length > 0 && <p className="muted small">Latest activity: {events[0].action.replaceAll(".", " ")} · {dateLabel(events[0].createdAt)}</p>}
  </div>;
}

function StatCard({ label, value, icon, accent }) {
  return <div className="stat-card"><span className={`stat-icon ${accent}`}>{icon}</span><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><span className="stat-caption">In this workspace</span></div>;
}

function DocumentsPage({ title, subtitle, documents, filters, setFilters, busy, onOpen, onDownload }) {
  const updateFilter = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value }));
  return <div><div className="page-heading"><div><span className="eyebrow">DOCUMENT LIBRARY</span><h1>{title}</h1><p>{subtitle}</p></div></div>
    <div className="toolbar document-filters"><label className="search-box"><span>⌕</span><input value={filters.name} onChange={updateFilter("name")} placeholder="Document name" aria-label="Search by document name" /></label><label><input value={filters.owner} onChange={updateFilter("owner")} placeholder="Owner name or email" aria-label="Search by owner" /></label><label><select value={filters.category} onChange={updateFilter("category")} aria-label="Filter by category"><option value="">All categories</option>{documentCategories.map((value) => <option key={value}>{value}</option>)}</select></label><label><input type="date" value={filters.dateFrom} onChange={updateFilter("dateFrom")} aria-label="Uploaded from date" /></label><label><input type="date" value={filters.dateTo} onChange={updateFilter("dateTo")} aria-label="Uploaded to date" /></label><span className="result-count">{documents.length} {documents.length === 1 ? "document" : "documents"}</span></div>
    <DocumentTable documents={documents} busy={busy} onOpen={onOpen} onDownload={onDownload} />
  </div>;
}

function DocumentTable({ documents, busy, onOpen, onDownload }) {
  if (busy) return <div className="empty-state">Loading document details...</div>;
  if (!documents.length) return <div className="empty-state"><span className="empty-icon">▤</span><strong>No documents yet</strong><p>Documents you can access will appear here.</p></div>;
  return <div className="table-wrap"><table><thead><tr><th>DOCUMENT</th><th>CATEGORY</th><th>OWNER</th><th>UPLOADED</th><th>SIZE</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{documents.map((doc) => <tr key={doc.id}>
    <td><button className="document-name" onClick={() => onOpen(doc)}><span className={`file-icon ${doc.mimeType === "application/pdf" ? "pdf" : "image"}`}>{doc.mimeType === "application/pdf" ? "PDF" : "IMG"}</span><span><strong>{doc.name}</strong><small>{doc.mimeType.split("/")[1].toUpperCase()}</small></span></button></td>
    <td>{doc.category || "Other"}</td><td><span className="owner-cell"><span className="mini-avatar">{doc.owner.name.slice(0, 1)}</span>{doc.owner.name}</span></td><td>{dateLabel(doc.createdAt)}</td><td>{sizeLabel(doc.size)}</td>
    <td><div className="row-actions"><button className="icon-button" title="Open details" onClick={() => onOpen(doc)}>•••</button><button className="icon-button" title="Download document" onClick={() => onDownload(doc.id)}>↓</button></div></td>
  </tr>)}</tbody></table></div>;
}

function UploadPage({ onUploaded, onError }) {
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState("Other");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState("");
  const [progress, setProgress] = useState(null);
  function selectFile(candidate) {
    const validationError = validateUploadFile(candidate);
    setFileError(validationError);
    setFile(validationError ? null : candidate);
  }

  function handlePaste(event) {
    if (busy) return;
    const candidate = event.clipboardData?.files[0];
    if (!candidate) return;
    event.preventDefault();
    selectFile(candidate);
  }

  async function submit(event) {
    event.preventDefault();
    const validationError = validateUploadFile(file);
    if (validationError) {
      setFileError(validationError);
      return;
    }
    setBusy(true);
    setProgress(0);
    setFileError("");
    try {
      await uploadDocument(file, category, setProgress);
      setFile(null);
      setFileError("");
      setProgress(null);
      await onUploaded();
    } catch (error) {
      setProgress(null);
      onError(`Upload failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }
  return <div className="upload-layout"><div><div className="page-heading"><span className="eyebrow">ADD TO YOUR LIBRARY</span><h1>Upload a document</h1><p>Files are stored privately and checked before upload.</p></div><form onSubmit={submit} className="upload-form">
    <label className="upload-category">Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{documentCategories.map((value) => <option key={value}>{value}</option>)}</select></label>
    <div
      className={`drop-zone ${dragging ? "dragging" : ""}`}
      role="region"
      aria-label="Document upload drop zone"
      aria-describedby="upload-drop-instructions upload-paste-instructions"
      aria-disabled={busy}
      tabIndex={busy ? -1 : 0}
      aria-live="polite"
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!busy && event.dataTransfer.files[0]) selectFile(event.dataTransfer.files[0]);
      }}
      onPaste={handlePaste}
    >
      {file ? <>
        <span className="drop-zone-icon selected" aria-hidden="true">✓</span>
        <span className="drop-zone-title">Document ready</span>
        <strong className="selected-file-name">{file.name}</strong>
        <span className="selected-file-size">{sizeLabel(file.size)}</span>
        <span className="drop-zone-hint" id="upload-drop-instructions">Drop another document to replace this file.</span>
      </> : <>
        <span className="drop-zone-icon" aria-hidden="true">↓</span>
        <span className="drop-zone-title">Add a document to your workspace</span>
        <strong className="drop-zone-instructions" id="upload-drop-instructions">Drag your document from File Explorer and drop it here.</strong>
        <span className="drop-zone-hint">PDF, PNG, JPG, or JPEG · Maximum size 10 MB</span>
      </>}
      <span className="paste-instructions" id="upload-paste-instructions">Or focus this area and press Ctrl+V to paste a copied file.</span>
    </div>
    {fileError && <p className="upload-error" role="alert">{fileError}</p>}
    {progress !== null && <div className="upload-progress" role="status" aria-live="polite">
      {progress < 100 ? `Uploading securely · ${progress}%` : "Upload sent; waiting for private storage and audit confirmation..."}
      <progress max="100" value={progress} aria-label="Upload progress" />
    </div>}
    <div className="upload-info"><span>◈</span><span><strong>Private by default</strong><small>Only you and workspace administrators can access this document until you share it.</small></span></div>
    <button className="primary-button" disabled={!file || Boolean(validateUploadFile(file)) || busy}>{busy ? "Uploading securely..." : "Upload document"} <span>→</span></button>
  </form>
  </div><aside className="upload-aside panel"><span className="quick-icon">⌑</span><h3>Protected from the start</h3><p>Your file is validated, assigned a unique storage name, and kept in private storage. The original filename is used only as display metadata.</p><div className="upload-step"><b>01</b><span><strong>File validation</strong><small>Format and size are checked.</small></span></div><div className="upload-step"><b>02</b><span><strong>Private storage</strong><small>No permanent public link.</small></span></div><div className="upload-step"><b>03</b><span><strong>Audit event</strong><small>Upload is recorded for review.</small></span></div></aside></div>;
}

function DocumentDetails({ document, permissions, events, account, sessionEpochRef, onBack, onView, onDownload, onDelete, onUpdate, onError, onPermissions }) {
  const [email, setEmail] = useState("");
  const [level, setLevel] = useState("view");
  const [expiration, setExpiration] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(document.name);
  const [draftCategory, setDraftCategory] = useState(document.category || "Other");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const canManage = account.role === "admin" || String(document.owner._id) === String(account.user.id);
  const canEdit = canManage || document.canEdit === true;
  function startEditing() {
    setDraftName(document.name);
    setDraftCategory(document.category || "Other");
    setEditError("");
    setEditing(true);
  }
  function cancelEditing() {
    if (saving) return;
    setEditing(false);
    setEditError("");
  }
  async function saveDetails(event) {
    event.preventDefault();
    const name = draftName.trim();
    if (!name) {
      setEditError("Enter a document name.");
      return;
    }
    if (name.length > 255) {
      setEditError("Use 255 characters or fewer.");
      return;
    }
    if (/[\\/\u0000-\u001f]/.test(name)) {
      setEditError("The name cannot contain slashes or control characters.");
      return;
    }
    const currentCategory = document.category || "Other";
    const changes = {};
    if (name !== document.name) changes.name = name;
    if (draftCategory !== currentCategory) changes.category = draftCategory;
    if (!Object.keys(changes).length) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setEditError("");
    try {
      await onUpdate(document.id, changes);
      setEditing(false);
    } catch (error) {
      setEditError(error.message);
    } finally {
      setSaving(false);
    }
  }
  async function grant(event) {
    event.preventDefault();
    const requestEpoch = sessionEpochRef.current;
    try {
      await api(`/documents/${document.id}/permissions`, {
        method: "POST",
        body: JSON.stringify({ email, level, expiresAt: expiration ? new Date(expiration).toISOString() : null })
      });
      if (requestEpoch !== sessionEpochRef.current) return;
      const result = await api(`/documents/${document.id}/permissions`);
      if (requestEpoch !== sessionEpochRef.current) return;
      onPermissions(result.permissions);
      setEmail("");
      setExpiration("");
    } catch (error) {
      if (requestEpoch === sessionEpochRef.current) onError(error.message);
    }
  }
  async function revoke(id) {
    if (!window.confirm("Revoke this person's access?")) return;
    const requestEpoch = sessionEpochRef.current;
    try {
      await api(`/documents/${document.id}/permissions/${id}`, { method: "DELETE" });
      if (requestEpoch !== sessionEpochRef.current) return;
      onPermissions(permissions.filter((permission) => permission.id !== id));
    } catch (error) {
      if (requestEpoch === sessionEpochRef.current) onError(error.message);
    }
  }
  return <div><button className="back-button" onClick={onBack}>← Back to documents</button><div className="detail-grid"><div className="detail-main"><div className="detail-title"><span className="file-icon large">{document.mimeType === "application/pdf" ? "PDF" : "IMG"}</span><div><span className="eyebrow">DOCUMENT DETAILS</span><h1>{document.name}</h1><p>Uploaded {dateLabel(document.createdAt)}</p></div></div><div className="panel detail-meta"><h3>File information</h3><div><span>Owner</span><strong>{document.owner.name}</strong></div><div><span>Category</span><strong>{document.category || "Other"}</strong></div><div><span>File type</span><strong>{document.mimeType}</strong></div><div><span>File size</span><strong>{sizeLabel(document.size)}</strong></div><div><span>Workspace</span><strong>{account.company.name}</strong></div></div>  <div className="detail-actions"><button className="primary-button" onClick={() => onView(document.id)}>◉ &nbsp; Preview document</button>{document.canDownload && <button className="secondary-button" onClick={() => onDownload(document.id)}>↓ &nbsp; Download</button>}{canEdit && !editing && <button className="secondary-button" onClick={startEditing}>✎ &nbsp; Edit details</button>}{canManage && <button className="danger-button" onClick={() => onDelete(document.id)}>Delete document</button>}</div>
      {canEdit && editing && <form className="panel rename-form" onSubmit={saveDetails}>
        <h3>Edit document details</h3>
        <label>Document name<input value={draftName} onChange={(event) => { setDraftName(event.target.value); setEditError(""); }} maxLength={255} autoFocus aria-invalid={Boolean(editError)} aria-describedby={editError ? "document-edit-error" : "document-edit-hint"} /></label>
        <small className="field-hint" id="document-edit-hint">Up to 255 characters. Slashes are not allowed.</small>
        <label>Category<select value={draftCategory} onChange={(event) => { setDraftCategory(event.target.value); setEditError(""); }}>{documentCategories.map((value) => <option key={value}>{value}</option>)}</select></label>
        {editError && <div className="form-error" id="document-edit-error" role="alert">{editError}</div>}
        <div className="rename-actions"><button className="primary-button" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button><button type="button" className="secondary-button" onClick={cancelEditing} disabled={saving}>Cancel</button></div>
      </form>}
    </div>
    {canManage && <aside className="panel permission-panel"><span className="eyebrow">ACCESS CONTROL</span><h2>Manage access</h2><p>Only workspace members can be granted access.</p><form onSubmit={grant} className="grant-form"><label>Member email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" /></label><label>Permission level<select value={level} onChange={(event) => setLevel(event.target.value)}><option value="view">View and preview</option><option value="download">View, preview, and download</option><option value="edit">View and edit details (no download)</option></select></label><label>Expires (optional)<input type="datetime-local" value={expiration} onChange={(event) => setExpiration(event.target.value)} /></label><button className="primary-button full-button">Grant access <span>→</span></button></form><div className="permission-list"><h3>Active permissions <span>{permissions.length}</span></h3>{permissions.length ? permissions.map((permission) => <div className="permission-row" key={permission.id}><span className="mini-avatar">{permission.user.name.slice(0, 1)}</span><span className="permission-user"><strong>{permission.user.name}</strong><small>{permission.user.email} · {permission.level}</small></span><button className="icon-button revoke" title={`Revoke ${permission.user.name}`} onClick={() => revoke(permission.id)}>×</button></div>) : <p className="muted small">No one else has access yet.</p>}</div><div className="permission-list"><h3>Recent document activity</h3>{events.slice(0, 5).map((event) => <div className="activity-mini" key={event._id}><span>{event.action.replaceAll(".", " ")}</span><small>{event.actor?.name || "Unknown"} · {dateLabel(event.createdAt)}</small></div>)}{!events.length && <p className="muted small">No activity recorded yet.</p>}</div></aside>}
  </div></div>;
}

function AuditPage({ events }) {
  return <div><div className="page-heading"><span className="eyebrow">ACCOUNTABILITY</span><h1>Audit trail</h1><p>Backend-recorded activity for your workspace. Entries cannot be edited or deleted here.</p></div>
    {!events.length ? <div className="empty-state"><span className="empty-icon">◷</span><strong>No activity recorded yet</strong><p>Workspace events will appear here as they happen.</p></div> : <div className="panel audit-list">{events.map((event) => <div className="audit-row" key={event._id}><span className={`audit-dot ${event.outcome}`} /><span className="audit-copy"><strong>{event.action.replaceAll(".", " ")}</strong><small>{event.actor?.name || "Unknown user"}{event.description ? ` · ${event.description}` : ""}</small></span><span className={`outcome ${event.outcome}`}>{event.outcome}</span><time>{dateLabel(event.createdAt)}</time></div>)}</div>}
  </div>;
}

function MembersPage({ members, account, onMembers, onError }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  async function invite(event) {
    event.preventDefault();
    setError("");
    setCode("");
    try {
      const result = await api("/workspaces/current/invitations", { method: "POST", body: JSON.stringify({ email, role }) });
      setCode(result.invitationCode);
      setEmail("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }
  async function removeMember(member) {
    if (!window.confirm(`Remove ${member.name} from this workspace? Their active document permissions will be revoked.`)) return;
    try {
      await api(`/workspaces/current/members/${member.id}`, { method: "DELETE" });
      onMembers(members.filter((current) => current.id !== member.id));
    } catch (requestError) {
      onError(requestError.message);
    }
  }
  return <div><div className="page-heading"><span className="eyebrow">YOUR TEAM</span><h1>Workspace members</h1><p>Invite trusted teammates to this company workspace.</p></div>
    <form className="panel invite-panel" onSubmit={invite}><div><h3>Invite a member</h3><p>Invitation codes expire in 48 hours. Send the code to the intended recipient through a trusted channel.</p></div><label>Email address<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" /></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value)}><option value="viewer">Authorized viewer</option><option value="owner">Document owner</option></select></label><button className="primary-button">Create invitation <span>→</span></button>
      {error && <div className="form-error" role="alert">{error}</div>}{code && <div className="invite-code"><strong>Copy this one-time code</strong><textarea readOnly value={code} onFocus={(event) => event.target.select()} aria-label="Invitation code" /><small>It is shown only once and grants access to this workspace for the invited email.</small></div>}</form>
    <h2 className="members-subheading">Current members</h2><div className="panel member-list">{members.map((member) => <div className="member-row" key={member.id}><span className="avatar">{member.name.slice(0, 1).toUpperCase()}</span><span><strong>{member.name}</strong><small>{member.email}</small></span><span className="role-pill">{member.role}</span><time>{dateLabel(member.joinedAt)}</time>{String(member.id) !== String(account.user.id) && <button className="remove-member" onClick={() => removeMember(member)} aria-label={`Remove ${member.name}`}>Remove</button>}</div>)}</div></div>;
}
