# TrustVault API

All routes use the `/api` prefix. The browser client sends the HttpOnly `trustvault_session` cookie with requests. The API derives the user and workspace from that signed session and the MongoDB membership; request bodies, query strings, and hidden UI controls do not grant identity or roles.

## Health and authentication

| Method | Path | Access | Behavior |
| --- | --- | --- | --- |
| GET | `/api/health` | Public | Returns `{"status":"ok"}` while the API process is serving requests. |
| POST | `/api/auth/register` | Public | Validates name, work email, password, and company name; hashes the password with bcrypt; creates a company and its first administrator; sets the session cookie. Returns 201. |
| POST | `/api/auth/accept-invite` | Public | Accepts a matching, unexpired, single-use invitation and creates a user with the invited role. Returns 201. |
| POST | `/api/auth/login` | Public | Checks the bcrypt password hash and workspace membership; sets the session cookie. |
| POST | `/api/auth/logout` | Authenticated | Increments the server-side authentication version and clears the cookie. Returns 204. |
| GET | `/api/auth/me` | Authenticated | Returns the current session user and workspace membership. |

The API connects to MongoDB before it starts listening. A missing or invalid `MONGODB_URI`, database authentication failure, or Atlas network denial prevents startup, so `/api/health` will not be available. A successful health response confirms the HTTP process is running; it is not a per-request database check. The server uses the `trustvault` database explicitly.

The registration form calls `POST /api/auth/register`. The client API base is `VITE_API_URL`, falling back to `http://localhost:4000/api`. Set the server `CLIENT_ORIGIN` to the exact frontend origin; local development defaults to `http://localhost:5173`. JSON POSTs require a CORS preflight, which Express handles before the trusted-origin middleware.

If the browser reports `Failed to fetch`, inspect the browser Network panel and check that `GET http://localhost:4000/api/health` responds. A refused connection means the browser cannot reach the API process. A CORS failure means the response is blocked by the browser; check the request's `Origin`, `CLIENT_ORIGIN`, and OPTIONS response. Validation and application errors are HTTP responses with JSON bodies, rather than browser-level fetch failures.

## Workspace routes

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/workspaces/current` | Authenticated workspace member |
| GET | `/api/workspaces/current/members` | Workspace administrator |
| POST | `/api/workspaces/current/invitations` | Workspace administrator |
| DELETE | `/api/workspaces/current/members/:userId` | Workspace administrator; cannot remove itself or the last administrator; revokes the removed member's grants |

## Document routes

| Method | Path | Access |
| --- | --- | --- |
| POST | `/api/documents` | Workspace administrator or `owner` role; upload is signature checked; optional `category` is one of `Finance`, `Legal`, `HR`, `Operations`, or `Other` (defaults to `Other`) |
| GET | `/api/documents` | Administrator sees company documents; other members see documents they own or have an active grant for. Optional filters: `name`, `owner` (name/email substring), `category`, `dateFrom`, `dateTo` (`YYYY-MM-DD`, UTC, inclusive) |
| GET | `/api/documents/:id` | Administrator, document owner, or member with an active view/download grant |
| GET | `/api/documents/:id/view` | Administrator, document owner, or member with an active view/download grant |
| GET | `/api/documents/:id/download` | Administrator, document owner, or member with an active download grant |
| PATCH | `/api/documents/:id` | Administrator or document owner; set `name` and/or `category` |
| DELETE | `/api/documents/:id` | Administrator or document owner |
| POST | `/api/documents/:id/permissions` | Administrator or document owner; body uses `email`, `level` (`view` or `download`), and optional ISO-8601 `expiresAt` |
| GET | `/api/documents/:id/permissions` | Administrator or document owner |
| DELETE | `/api/documents/:id/permissions/:permissionId` | Administrator or document owner |

Every document lookup is scoped to the authenticated member's company. A non-admin member's access is evaluated against the current document owner and current grant on each request. Expired and revoked grants do not authorize access; a revoked view or download is rejected on the next API request. Cross-company document identifiers return 404. Same-company members without access receive 403.

Uploads require an explicitly configured `SUPABASE_BUCKET`. Before each upload, download, or delete, the server checks Supabase Storage metadata and refuses to operate unless the bucket exists and reports `public: false`. Objects use server-generated workspace/UUID paths. The browser receives neither the service-role key nor a permanent or signed storage URL; file reads are served through authenticated Express routes after current access checks. Create a private bucket in Supabase Storage, then set backend-only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_BUCKET`. Do not set these in the client environment.

`PATCH /api/documents/:id` edits the document display name and/or category. It is restricted to the document owner or workspace administrator and validates each field on the server. Upload, view, download, edit, delete, grant, revoke, and denied document/permission operations create server-side audit events. Events include actor, action, outcome, timestamp, document where known, request ID, and safe HTTP method/route metadata. There is no API for clients to create, edit, or delete audit events. The workspace audit listing is administrator-only; document audit history is limited to that document's owner and administrators.

The workspace role `owner` permits uploading, but it does not grant access to every document in that workspace. Document ownership is recorded from the authenticated user at upload time. Workspace administrators can access all documents in their company. Search filters are evaluated by the API after applying the authenticated workspace and active-grant scope, and before its 200-result cap. Owner matching is resolved only against owners of documents in the authenticated workspace, including documents owned by members who were later removed.

## Audit routes

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/audit-logs` | Workspace administrator |
| GET | `/api/audit-logs/documents/:id` | Workspace administrator or document owner |

Audit entries are generated by server handlers. The API does not accept client-supplied audit events.
