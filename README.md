# TrustVault — Secure Document Sharing with a Real Audit Trail

TrustVault is a full-stack MVP for private company workspaces, explicitly shared documents, role-checked downloads, and backend-generated audit records. The app keeps file objects private and performs authorization on every document operation.

**Status:** source is published, and the deployed frontend and backend health endpoint were reachable when checked on 2026-10-25. The frontend returned the TrustVault page title and the backend `/api/health` returned `{"status":"ok"}`. This verifies availability only; it does not verify production registration, document sharing, Supabase file operations, audit visibility, or end-to-end authorization. Do not upload real confidential documents until those production flows and storage configuration have been independently verified.

- **Live frontend:** [https://trust-vault-ecru.vercel.app/](https://trust-vault-ecru.vercel.app/)
- **Backend health:** [https://trustvault-api-pnvi.onrender.com/api/health](https://trustvault-api-pnvi.onrender.com/api/health)
- **Public repository:** [https://github.com/mv-harshitha/TrustVault](https://github.com/mv-harshitha/TrustVault)

## Implemented

- Company workspaces with `admin`, `owner`, and `viewer` memberships. Admins can invite and remove members in their own workspace.
- Registration creates a new company and its first admin. Admins can invite owners and viewers using a single-use, 48-hour invitation code.
- Password hashing with bcrypt, an eight-hour JWT in an HttpOnly cookie, logout invalidation, trusted-origin checks, and rate limits on login, registration, invitation, upload, and member-invitation routes.
- Private Supabase Storage uploads with server-generated object names. The server checks file signatures and accepts PDF, PNG, and JPEG up to 10 MB.
- The API checks that the configured Supabase bucket exists and is private before file operations; downloads remain server-mediated and are authorized on each request.
- Company-scoped document metadata, explicit view/download/edit grants, expiration, revocation, owner/admin management, and authorization on each request. An edit grant permits metadata edits and preview only, not downloads, deletion, or permission management.
- Downloads are served through the authenticated backend rather than returning a storage URL, so a revoked grant is checked on the next download request.
- Persistent MongoDB audit events for registration, login, upload, view, download, permission grants/revocations, deletion, invitations, denied document access, expired grants, and oversized uploads. Audit writes are awaited before success responses.
- Responsive React workspace UI with login/registration, dashboard, document lists, upload, document permissions, member invitations, and admin audit visibility.
- Automated integration tests for core authentication, tenancy, document access, permissions, audit visibility, file validation, and upload/download flows.

## Architecture

`client/` is a React/Vite single-page application. `server/` is an Express API. MongoDB stores users, companies, memberships, document metadata, permissions, invitations, and audit events. Supabase Storage contains private file objects only.

Authorization is implemented in the API and uses the authenticated user plus the user's current database membership. Client-supplied role, company, and owner IDs are not accepted as authorization inputs. Every document lookup is scoped to the authenticated company, and document grants are rechecked on each read, view, edit, or download. See [API.md](docs/API.md) for route-level access rules and [THREATS.md](THREATS.md) for the threat model and verified limits.

All state-changing API requests require an `Origin` matching the configured `CLIENT_ORIGIN`; missing and untrusted origins are rejected. Non-browser clients must provide that origin and authenticate normally.

The membership model allows one company membership per user for this MVP. A user account cannot yet switch between multiple workspaces. Audit list endpoints are capped at the latest 100 entries; document lists are capped at 200.

## Database schema and relationships

MongoDB uses Mongoose schemas with timestamps and explicit ObjectId references:

| Collection / model | Main relationships and purpose |
| --- | --- |
| `Company` | Workspace root. One company has many memberships, documents, invitations, and audit events. |
| `User` | Account identity and bcrypt password hash (`select: false`). The email has a unique index. |
| `Membership` | Links a user to a company and assigns `admin`, `owner`, or `viewer`. A unique `(user, company)` index prevents duplicate memberships; the current invitation flow creates one workspace per account. |
| `Document` | Belongs to a company and an owner user. Stores display name, category, MIME type, size, and a server-generated private-storage path (`select: false`). The file bytes live in private Supabase Storage, not MongoDB. |
| `Permission` | Named-user grant for one document and company, created by a granting user. Levels are `view`, `download`, or `edit`; grants may expire or be revoked. The partial unique index permits only one unrevoked grant per document/user pair. |
| `WorkspaceInvite` | Hashed, single-use invitation code for a company/email/role, with expiry and consumption timestamps. Only the token hash is stored. |
| `AuditEvent` | Append-through-application activity entry with optional actor, company and document references, action, outcome, safe metadata, request ID, and UTC creation time. Ordinary API routes do not mutate or delete events. |

Authorization joins the signed session's user to the current `Membership`; document operations then scope the document to that company and check its owner or current permission. Audit indexes support descending time-based queries by company and document. Mongoose schemas and indexes are defined under `server/src/models/`.

## Requirements

- Node.js 20 or newer and npm
- MongoDB Atlas cluster (or a local MongoDB instance for offline development)
- Supabase project and a private Storage bucket

### MongoDB Atlas setup

TrustVault uses Mongoose and accepts a standard Atlas `mongodb+srv://` connection string. To connect your cluster:

1. In MongoDB Atlas, create a database user with read/write access to only the `trustvault` database. Do not use an Atlas administrative account for the application.
2. Add only the network addresses you need to the cluster's IP access list. Use your current development address; avoid `0.0.0.0/0` unless your environment requires it.
3. Use **Connect > Drivers** to copy the connection string, and include the database name `trustvault` before the query string. Add `authSource=admin`: Atlas database users authenticate against the `admin` database, not the application database.
   `mongodb+srv://<username>:<password>@<cluster-host>/trustvault?retryWrites=true&w=majority&authSource=admin`
4. Put the real URI only in the ignored `server/.env` file as `MONGODB_URI`. Percent-encode special characters in the password. Never commit it, paste it into an issue, or send it in chat.
5. Start the API. The server validates the URI, connects before listening, explicitly uses the `trustvault` database and the `admin` authentication source, and stops startup with a redacted error if the connection fails.

If a database password or JWT secret has been exposed outside its secure environment, treat it as compromised. Rotate the Atlas user's password and generate a new `JWT_SECRET` locally; changing `JWT_SECRET` invalidates existing sessions and requires users to sign in again. This project does not rotate credentials automatically.

The app does not migrate existing local data to Atlas. If you need that data, use `mongodump` and `mongorestore` or a reviewed migration process, and do not delete the local database until the Atlas copy has been verified.

## Local setup

1. From the repository root, install workspace dependencies:

   ```powershell
   npm install
   ```

2. Copy `server/.env.example` to `server/.env`. Set:
   - `MONGODB_URI` to your MongoDB Atlas URI (see [MongoDB Atlas setup](#mongodb-atlas-setup)) or a local MongoDB URI for offline development.
   - `JWT_SECRET` to a unique random secret (at least 32 random bytes).
   - `CLIENT_ORIGIN` to `http://localhost:5173`.
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_BUCKET`.

   Keep the Supabase service-role key only in the server environment. Create the bucket named by `SUPABASE_BUCKET` as **private** in Supabase. Never put the service-role key in client environment variables.

3. Copy `client/.env.example` to `client/.env`. For local use, keep:

   ```env
   VITE_API_URL=http://localhost:4000/api
   ```

4. Start the API and UI from the repository root:

   ```powershell
   npm run dev
   ```

   The API listens on port 4000; Vite serves the UI at http://localhost:5173. `npm run dev` needs both ports available.

### Troubleshooting registration

The Create Workspace form sends `POST http://localhost:4000/api/auth/register` by default. If the browser displays `Failed to fetch`, check that both dev servers are running, then open `http://localhost:4000/api/health`. A refused connection means the browser cannot reach the API process. If health responds, inspect the browser Network panel for the registration request and its OPTIONS preflight; configure `CLIENT_ORIGIN` to exactly match the page origin. A validation, duplicate-account, or database error should arrive as an HTTP response; it is different from a browser-level fetch failure. The app does not need Supabase configured to register or log in.

## Tests and build

Install dependencies first, then run:

```powershell
npm test
npm run build
```

The server integration tests use `mongodb-memory-server`; its first run may need to download a MongoDB test binary. They use a fake storage adapter and test-only data. Tests do not connect to production services or MongoDB Atlas. The security suite checks password hashing, session authentication, CORS preflight, workspace isolation, direct API role restrictions, document grants, expiration, and denied access after revocation. It does not validate live Supabase, Atlas credentials, Atlas network access, or production deployment settings.

## Safe three-role demo accounts

Use a dedicated demo workspace, test-only identities, and synthetic documents (for example, a one-page PDF containing invented text). Do not use confidential files or real personal data. There is no email delivery integration, so the administrator must copy each invitation code and provide it to the intended test user through a private channel.

1. From the deployed frontend, choose **Create an account** and create the demo **Administrator**. This creates a new workspace. Use an email address you control for testing and a unique, strong password that is not used elsewhere.
2. In **Workspace members**, invite a separate test identity as `owner`. Copy the one-time invitation code, then use **Join with a code** as that invited identity. Repeat with a third identity and the `viewer` role.
3. As the `owner`, upload a harmless synthetic PDF or image. Open its details and grant the `viewer` the `view` permission (or `edit` for the metadata-edit demonstration). Do not select an identity from a different workspace.
4. Sign in as the `viewer` and confirm only the explicitly shared document is visible. With `view`, preview should work while download and metadata editing are denied. With `edit`, change only the document name/category; download, delete, and permission management remain denied.
5. As the `owner`, revoke the grant and verify the next viewer request is denied. As the `Administrator`, inspect workspace audit activity and member roles.

Keep passwords and invitation codes out of slides, source control, logs, and this repository. Production demo accounts and test documents persist until explicitly cleaned up: owners/admins can delete documents and admins can remove members, but this MVP has no workspace/account deletion flow. Plan the demo workspace accordingly.

See [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for a timed five-minute walkthrough and [SUBMISSION.md](SUBMISSION.md) for the concise challenge summary.

## API

All endpoints are prefixed with `/api`. Authentication uses an HttpOnly cookie; the browser client sends it with credentials. See [docs/API.md](docs/API.md) for complete endpoint authorization rules and behavior.

| Method | Endpoint | Access |
| --- | --- | --- |
| GET | `/health` | Public health check |
| POST | `/auth/register` | Public; creates a workspace admin |
| POST | `/auth/accept-invite` | Public; consumes a matching invitation code |
| POST | `/auth/login` | Public, rate-limited |
| POST | `/auth/logout` | Authenticated |
| GET | `/auth/me` | Authenticated |
| GET | `/workspaces/current` | Authenticated |
| GET | `/workspaces/current/members` | Admin |
| DELETE | `/workspaces/current/members/:userId` | Admin; revokes the member's active grants |
| POST | `/workspaces/current/invitations` | Admin |
| POST | `/documents` | Owner or admin; multipart field `file` |
| GET | `/documents` | Authenticated; only accessible documents |
| GET | `/documents/:id` | Owner, admin, or member with an active grant |
| GET | `/documents/:id/download` | Owner/admin or user with an active download grant |
| PATCH | `/documents/:id` | Owner/admin or member with an active edit grant; set `name` and/or `category` |
| DELETE | `/documents/:id` | Owner or admin |
| POST | `/documents/:id/permissions` | Owner or admin; `{ "email", "level", "expiresAt?" }` |
| GET | `/documents/:id/permissions` | Owner or admin |
| DELETE | `/documents/:id/permissions/:permissionId` | Owner or admin |
| GET | `/audit-logs` | Admin, own company only |
| GET | `/audit-logs/documents/:id` | Document owner or admin |

Permission `level` is `view`, `download`, or `edit`. An edit grant allows metadata edits and preview, but not downloads, deletion, permission management, or workspace-role changes. Expiration is an ISO-8601 timestamp. Invitation codes are bearer secrets: transfer them only to the intended email recipient using a trusted channel. The invitee selects “Join with a code” on the sign-in screen.

## Audit and reliability notes

Audit events are generated by trusted server handlers and authentication middleware, never accepted from client activity claims, and there are no API endpoints for creating, editing, or deleting them. Direct unauthenticated requests for an existing document are recorded as denied events with no actor; the event is associated with that document's workspace, and request tokens are never recorded. Before that lookup, an IP-based limit allows 30 unauthenticated document requests per 15 minutes by default. Configure `UNAUTH_DOCUMENT_AUDIT_LIMIT` and `UNAUTH_DOCUMENT_AUDIT_WINDOW_MS` in the server environment to change those values. The built-in limiter keeps counters in each server process; restarts reset them, and multiple instances need a shared rate-limit store for a global limit. Passwords, JWTs, storage keys, and document contents are excluded. Each event includes MongoDB's event ID, UTC creation timestamp, actor/workspace/document where known, action, outcome, safe HTTP method/route metadata, and request correlation ID. Requests for unknown documents cannot be associated with a workspace and are not shown in workspace audit views. This is application-level append-only behavior, not tamper-proof storage: a database administrator or compromised server credential can alter records.

Audit writes are awaited and failures are returned as errors rather than silently treated as success. MongoDB and object storage do not share a transaction: a process crash or service failure between a storage change, metadata update, and audit insert can still leave a partial operation or an incomplete trail. Downloads are audited when the backend successfully reads and serves the file; a client disconnect after that point cannot be distinguished from a completed download. Configure MongoDB backups and monitoring for stronger operational durability.

## Deployment

### Backend on Render

1. The deployed backend URL is [https://trustvault-api-pnvi.onrender.com/](https://trustvault-api-pnvi.onrender.com/). Its health endpoint, [https://trustvault-api-pnvi.onrender.com/api/health](https://trustvault-api-pnvi.onrender.com/api/health), returned `{"status":"ok"}` on 2026-10-25. For a new deployment, create a Render web service for the repository using `render.yaml` (or select `server/` as its root directory).
2. Configure `MONGODB_URI` to an Atlas database as described in [MongoDB Atlas setup](#mongodb-atlas-setup) and allow the Render service to reach it. Restrict Atlas network access as tightly as your hosting setup allows.
3. Create a **private** Supabase Storage bucket (public access disabled). Set backend-only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_BUCKET` in the server environment. The API checks bucket privacy before each file operation. Never put the service-role key in `client/.env` or a `VITE_` variable. The repository's `server/.env.example` contains placeholders; replace them only in an ignored local `server/.env` or hosting secret settings.
4. Set `CLIENT_ORIGIN` to the exact deployed frontend origin, without a trailing slash.
5. Set the frontend `VITE_API_URL` to `https://<your-render-service>/api` and the backend `CLIENT_ORIGIN` to the exact frontend origin. Verify `GET https://<your-render-service>/api/health` and the CORS preflight from the deployed frontend origin. Health alone does not verify registration, storage, or document authorization; run the documented smoke checks with test accounts before using real documents.

### Frontend on Vercel

1. The deployed frontend URL is [https://trust-vault-ecru.vercel.app/](https://trust-vault-ecru.vercel.app/); it returned the TrustVault page title on 2026-10-25. For a new deployment, import the repository and set the Vercel project root directory to `client/`.
2. Use `npm run build` as the build command and `dist` as the output directory.
3. Add `VITE_API_URL=https://<your-render-service>/api`.
4. Set the backend's `CLIENT_ORIGIN` to the exact Vercel deployment origin, then redeploy the backend. In production the cookie is Secure and SameSite=None for the separate frontend/backend origins; unsafe requests with a mismatched browser Origin are rejected. `TRUST_PROXY=1` is configured in `render.yaml` so rate limiting uses the client IP behind Render's proxy.
5. Test registration, invitation acceptance, file upload, share, revoke, download, and audit visibility with separate test workspaces. Do not claim deployment readiness until these checks pass.

`render.yaml` can provision service settings, but it cannot create accounts, configure an Atlas allowlist, make a Supabase bucket private, or verify a live deployment. Those actions require the project owner.

## Known limitations and honest submission notes

- The deployed frontend page and backend health endpoint were reachable, but full production user journeys have not been verified by this documentation check. Health availability does not prove upload, sharing, permission enforcement, or audit behavior works against production services.
- Automated integration tests use MongoDB Memory Server and fake Supabase storage. They do not validate live Supabase bucket configuration, production document contents, Atlas administrative/network settings, or the complete deployed flows. Any credential previously exposed outside its secure environment should be treated as compromised and rotated before use with real data.
- There is no email delivery service; admins must send one-time invitation codes to the matching email out-of-band.
- User accounts are limited to one workspace in the current interface and API.
- Only PDF, PNG, and JPEG are accepted. Signature validation is not malware scanning.
- Document search is server-side by name, workspace member owner name/email, category, and inclusive UTC upload-date range. The filtered list is capped at 200 results; pagination, audit export, and password-reset/email-verification workflows are not implemented.
- A short-lived signed URL is not used: downloads are proxied through the API to permit an authorization check on every request. This uses server bandwidth and buffers files up to the configured 10 MB limit.
- During implementation, the workspace router was initially mounted at a path that duplicated `/current`; the mount was corrected to `/api/workspaces` so the defined `/current` endpoints compose correctly. The session cookie was also updated to include an authentication version so logout invalidates the token server-side.
- Before submission, run the documented tests and build, fix any failures, and demonstrate the production flows with safe test identities and synthetic files. Do not claim flows were verified unless they were exercised.

## Hackathon submission details

- **Title:** TrustVault — Secure Document Sharing with a Real Audit Trail
- **Summary:** A secure, multi-tenant document-sharing platform with explicit document permissions, server-side access control, and an auditable record of document activity.
- **Implemented:** See the feature list above. Basic deployed-page and health endpoint availability were verified; complete production functionality was not verified by the documentation pass.
- **AI tools used:** This implementation was developed with an AI assistant using Copilot SDK in VS Code.
- **Live website:** [https://trust-vault-ecru.vercel.app/](https://trust-vault-ecru.vercel.app/).
- **Backend health:** [https://trustvault-api-pnvi.onrender.com/api/health](https://trustvault-api-pnvi.onrender.com/api/health).
- **Public repository:** [github.com/mv-harshitha/TrustVault](https://github.com/mv-harshitha/TrustVault).
