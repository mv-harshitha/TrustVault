# TrustVault threat model

## Scope and assets

This model covers the local MVP: the React/Vite client, Express API, MongoDB records, session cookies, permission records, audit events, and private Supabase Storage objects. It describes implemented server-side controls and their limits; it is not a production security certification.

Assets include account credentials, workspace membership, document metadata and bytes, permission grants, invitation codes, and audit history. Threat actors include unauthenticated callers, authenticated members of another workspace, viewers without a document grant, and members attempting operations outside their role.

## Security boundaries and controls

- The API verifies the signed HttpOnly session, compares its authentication version with the user record, and reloads the user's workspace membership from MongoDB for each authenticated request.
- Registration and invitation acceptance validate input and hash passwords with bcrypt before storing them. Login verifies the hash. Password hashes are excluded from normal user queries and API responses.
- Unsafe cross-origin requests are rejected by the trusted-origin middleware. CORS allows credentials only for the configured `CLIENT_ORIGIN` (local default: `http://localhost:5173`).
- Document reads, previews, downloads, permission changes, and deletes run in Express handlers. Document queries are scoped by the authenticated workspace; ownership comes from the document record, and sharing comes from active MongoDB permission records.
- Administrators can access documents in their workspace. A document owner can manage their own document. Other members require an unexpired, unrevoked view or download grant. A view grant cannot download. The storage object is fetched through the API only after authorization, so a later request after revocation is checked against the new grant state.
- Viewers cannot upload, grant or revoke permissions, or delete documents. Workspace admins can remove members; their active document grants are revoked.
- Uploaded object paths are generated server-side and do not contain the supplied filename. The display filename is stripped of path separators and control characters. The API validates file signatures and restricts uploads to PDF, PNG, or JPEG up to 10 MB.
- Before upload, download, or delete, the server checks that its configured Supabase bucket exists and is private (`public: false`). Objects are never exposed with public or signed URLs; downloads are mediated by an authenticated API request with fresh authorization.
- Server handlers write audit events for document upload/view/download/edit/delete, permission grant/revoke, and denied access/permission attempts. Audit APIs are read-only; workspace-wide activity is admin-only and document activity is owner/admin-only.
- Security integration tests use direct HTTP requests through Supertest and MongoDB Memory Server. Storage is a fake adapter in these tests.

## Verified behavior and evidence

Run `npm test` for executable evidence of registration, bcrypt hashing and login, session revocation, CORS preflight, cross-workspace isolation, role restrictions, ignored client-supplied identity/role fields, denied direct view/download/delete/update requests, permission levels, expiration, revocation on subsequent reads, private-bucket enforcement with a fake storage adapter, audit event creation, and read-only audit APIs. Run `npm run build` for the client production build. These checks do not validate a deployed service or live Supabase configuration.

## Known risks and limits

- Production MongoDB, Supabase, CORS, TLS, proxy, and cookie settings must be configured and verified by the operator. Create a private Supabase Storage bucket, then set backend-only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_BUCKET`; the server rejects buckets that Supabase reports as public. The service-role key bypasses Supabase Storage RLS and belongs only in the backend environment; never commit it or send it to the client.
- Integration tests replace Supabase with a fake adapter; they prove the application refuses a bucket reported as public, but they do not prove cloud IAM policy or live storage behavior. No live Supabase bucket was verified during this phase.
- File signature validation is not malware scanning. Only PDF, PNG, and JPEG are accepted.
- MongoDB and object storage do not share a transaction. A crash between storage, metadata, and audit operations can leave partial state; for example, a failed metadata deletion after object removal is reported and audited as a failure, but requires operator reconciliation. Audit-write failures cannot make two systems atomic.
- Registration creates one workspace per user in the current MVP. Invitation codes are bearer credentials and must be delivered to the intended email recipient over a trusted channel; no email delivery is implemented.
- Document metadata edits are limited to the owner/admin name-edit endpoint. Document deletion and downloads are mediated by the backend, which buffers files up to the configured size limit.
- A successful local test suite is not evidence of a production deployment or of protection against infrastructure compromise, compromised administrator accounts, or malicious files.

## Audit integrity limits

The application exposes audit events through read-only routes and enforces workspace administrator access for workspace-wide activity. This is not tamper-proof storage: a MongoDB administrator or compromised server credential can change or delete records, and ordinary backups do not independently establish event integrity. Stronger assurance requires a separately controlled append-only/WORM destination, restricted database roles, backups, and external integrity monitoring. Audit writes and document/storage changes cannot share an atomic transaction; a failure between systems can leave partial state, which should be reconciled operationally.
