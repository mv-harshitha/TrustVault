# TrustVault — Live Verification Report

**Verification date:** 2026-10-25
**Repository revision:** `202a8ac3dda34b744c2d01ea091c320c7115f677` (`main`, matched `origin/main` at verification start)
**Scope:** Read-only deployment checks plus the explicitly approved, isolated production API test plan. No application code, deployment settings, or pre-existing production records were intentionally changed. No authorized deletion or cleanup was performed.

## A. Executive summary

**Overall: PARTIALLY READY.**

The deployed frontend and API were reachable, and 85/85 controlled API checks passed using four newly created synthetic identities across two new workspaces and one invented-content PDF. These checks exercised registration, login/logout, current role checks, document upload, storage-backed preview/download, filters, permissions, edit boundaries, revocation, cross-workspace isolation, and audit visibility. The client build and all 25 local automated tests also passed.

This is strong evidence for the tested HTTP flows, not a full production certification. Authenticated browser UI workflows were not exercised; no video or reusable demo credentials were verified; no large-file boundary or expiry behavior was tested against production; and database/storage administrators can still alter or remove infrastructure records. The new production test records remain present as described in Section I.

## B. Requirement-by-requirement checklist

| Requirement | Status | Evidence | Remaining action |
| --- | --- | --- | --- |
| Public repository and current Git history | PASS | GitHub repository page was publicly readable; local `main` and `origin/main` both resolved to `202a8ac3dda34b744c2d01ea091c320c7115f677`; worktree was clean before this report. | None for source publication. |
| Frontend and backend HTTPS availability | PASS | Frontend and API checks below returned successful responses. | None for basic reachability. |
| Registration, invitations, and authentication | PASS | Production registration and invite acceptance returned 201; valid login 200; invalid login 401; logout 204 followed by 401 on the logged-out session. | None for these tested API flows. |
| Workspace roles and administrator restrictions | PASS | Admin member/audit reads succeeded; owner/viewer admin operations were rejected; invitee-supplied role did not override the invitation role. | Authenticated UI presentation remains unverified. |
| Document upload and search | PARTIAL | One synthetic PDF-signature-accepted payload uploaded; owner/admin saw it; viewer/outsider did not before a grant; name, owner, category, and date filters found it. | Structural PDF validity/rendering and the file-size boundary were not verified in production. |
| View/download/edit grants and revocation | PASS | View and download behaved independently; edit changed only metadata; each revoked grant failed on subsequent relevant requests. | Expiration tested only by the local suite, not production. |
| Workspace isolation | PASS | A separate workspace administrator received 404 for the test document and did not see it in the workspace list. | No unrelated workspace or existing resource was queried. |
| Origin and CORS requirements | PASS / PARTIAL | Trusted browser-origin fetch succeeded; an `example.com` browser fetch was blocked by CORS; missing/hostile Origin logout requests without a session returned 403. See Section E for an untrusted preflight detail. | Authenticated mutation with missing/hostile Origin was not separately attempted. |
| Private storage and database-backed behavior | PASS for tested flow | Registration, metadata, upload, preview, download, permissions, and audit reads all succeeded. The stored file bytes matched the synthetic source hash. | No direct provider console/IAM review or independent database administration check. |
| Audit event creation and API access | PASS | Test document audit history contained the required successful and denied action/outcome pairs; owner/admin visibility succeeded; viewer access and audit mutation routes were rejected. | Not tamper-proof against privileged database/server access. |
| Threat model and AI work history | PASS for repository evidence | `THREATS.md` exists; `PROMPTS.md` contains 10 dated entries and 9 commit links. Linked history was reviewed against Git. | AI work-log evidence is not independent human review. |
| API reference, schema, setup, deployment, safe demo instructions | PASS | `docs/API.md` and `README.md` cover route access, permission scope, Origin rules, data relationships, setup, deployments, and demo-account safety. | None for these documented items. |
| Five-minute demo script and submission write-up | PASS | `DEMO_SCRIPT.md` and `SUBMISSION.md` are present. | A script is not a demo recording. |
| Actual demo video | NOT VERIFIED | No video file is tracked in the repository. | Confirm separately whether a video exists outside the repository; record one if required. |
| Reusable demo access supplied securely | NOT VERIFIED | No reusable credentials were provided or saved. The production verification credentials were ephemeral and are not in this report. | Prepare judge/demo access through a secure channel if required. |
| Automated tests and production build | PASS | `npm test`: 20 server + 5 client tests passed. `npm run build`: passed. | Mutation testing was not performed. |
| No secrets exposed | PASS for performed scan/scope | No `.env` file was read, and no credentials/cookies/invitation codes were included in this report. Production test passwords remained in memory during execution and were not printed. | Continue keeping environment files and credentials private. |

## C. Production test results

All 85 API checks below used the newly created test identities only. “Expected → actual” includes the HTTP status; each check passed. Response bodies, cookies, passwords, and invitation codes were not printed. For binary content checks, only equality of the SHA-256 digest to the source PDF was reported.

| Test ID | Endpoint/action | Test identity / role | Expected → actual | Sanitized evidence |
| --- | --- | --- | --- | --- |
| ORIGIN-MISSING-LOGOUT | `POST /api/auth/logout`, no Origin | No session | 403 → 403 PASS | Rejected before authentication; no session to invalidate. |
| ORIGIN-HOSTILE-LOGOUT | `POST /api/auth/logout`, hostile Origin | No session | 403 → 403 PASS | Rejected. |
| ORIGIN-TRUSTED-NOSESSION | `POST /api/auth/logout`, trusted Origin | No session | 401 → 401 PASS | Trusted Origin proceeded to authentication. |
| AUTH-UNAUTH-ME | `GET /api/auth/me` | No session | 401 → 401 PASS | Authentication required. |
| AUTH-REGISTER-ADMIN | `POST /api/auth/register` | New workspace A admin | 201/admin → 201/admin PASS | New synthetic workspace and account created. |
| COOKIE-PRODUCTION-ATTRIBUTES | Registration `Set-Cookie` attributes | Workspace A admin | HttpOnly, Secure, SameSite=None, 8-hour Max-Age → all present PASS | Attribute booleans only; cookie value withheld. |
| INVITE-OWNER | `POST /api/workspaces/current/invitations` | Workspace A admin | 201 → 201 PASS | Owner invitation created; code withheld. |
| AUTH-ACCEPT-OWNER | `POST /api/auth/accept-invite` | Owner | 201/owner despite submitted role field → 201/owner PASS | Stored invitation role governed membership. |
| INVITE-VIEWER | `POST /api/workspaces/current/invitations` | Workspace A admin | 201 → 201 PASS | Viewer invitation created; code withheld. |
| AUTH-ACCEPT-VIEWER | `POST /api/auth/accept-invite` | Viewer | 201/viewer despite submitted role field → 201/viewer PASS | Stored invitation role governed membership. |
| AUTH-REGISTER-OUTSIDER-WORKSPACE | `POST /api/auth/register` | Separate workspace B admin | 201/admin → 201/admin PASS | Created isolated second workspace. |
| AUTH-LOGIN-VALID | `POST /api/auth/login` | Workspace A admin | 200/admin → 200/admin PASS | Valid credentials accepted; values withheld. |
| AUTH-LOGIN-INVALID | `POST /api/auth/login` | Workspace A admin identity, wrong password | 401 → 401 PASS | Invalid login rejected. |
| ROLE-OWNER-CURRENT | `GET /api/workspaces/current` | Owner | 200/owner → 200/owner PASS | Server-reported role matched. |
| ROLE-VIEWER-CURRENT | `GET /api/workspaces/current` | Viewer | 200/viewer → 200/viewer PASS | Server-reported role matched. |
| ADMIN-MEMBER-LIST | `GET /api/workspaces/current/members` | Workspace A admin | 200 → 200 PASS | Admin member listing returned. |
| OWNER-CANNOT-LIST-MEMBERS | Same endpoint | Owner | 403 → 403 PASS | Admin-only route denied. |
| VIEWER-CANNOT-LIST-MEMBERS | Same endpoint | Viewer | 403 → 403 PASS | Admin-only route denied. |
| OWNER-CANNOT-INVITE | `POST /api/workspaces/current/invitations` | Owner | 403 → 403 PASS | No invitation created. |
| VIEWER-CANNOT-INVITE | Same endpoint | Viewer | 403 → 403 PASS | No invitation created. |
| DOCUMENT-UPLOAD-PDF | `POST /api/documents` | Owner | 201 / detected `application/pdf` → 201 PASS | Synthetic PDF-signature payload uploaded; forged owner/company form fields did not change the response owner. Structural PDF validity/rendering was not checked. |
| DOCUMENT-LIST-OWNER | `GET /api/documents` | Owner | Test document present → present PASS | Listed in owner workspace. |
| DOCUMENT-LIST-ADMIN | Same endpoint | Workspace A admin | Test document present → present PASS | Listed in admin workspace. |
| DOCUMENT-LIST-VIEWER-UNSHARED | Same endpoint | Viewer | Test document absent → absent PASS | No implicit workspace-wide viewer access. |
| DOCUMENT-LIST-OUTSIDER | Same endpoint | Workspace B admin | Test document absent → absent PASS | No cross-workspace listing. |
| CROSS-WORKSPACE-METADATA | `GET /api/documents/:id` | Workspace B admin | 404 → 404 PASS | Cross-workspace document hidden. |
| CROSS-WORKSPACE-DOWNLOAD | `GET /api/documents/:id/download` | Workspace B admin | 404 → 404 PASS | Cross-workspace document hidden. |
| DOCUMENT-SEARCH-NAME | `GET /api/documents?name=...` | Owner | Match → match PASS | Test document found. |
| DOCUMENT-SEARCH-OWNER | `GET /api/documents?owner=...` | Workspace A admin | Match → match PASS | Test document found by owner. |
| DOCUMENT-SEARCH-CATEGORY | `GET /api/documents?category=Other` | Owner | Match → match PASS | Test document found by category. |
| DOCUMENT-SEARCH-DATE | `GET /api/documents?dateFrom=...&dateTo=...` | Owner | Match → match PASS | Test document found within its UTC date. |
| VIEWER-METADATA-UNSHARED | `GET /api/documents/:id` | Unshared viewer | 403 → 403 PASS | Denied. |
| VIEWER-DOWNLOAD-UNSHARED | `GET /api/documents/:id/download` | Unshared viewer | 403 → 403 PASS | Denied. |
| VIEWER-EDIT-UNSHARED | `PATCH /api/documents/:id` | Unshared viewer | 403 → 403 PASS | Denied. |
| GRANT-VIEW | `POST /api/documents/:id/permissions` | Owner | 201/view → 201/view PASS | Named-user grant created. |
| VIEWER-READ-WITH-VIEW | `GET /api/documents/:id` | Viewer with view | 200, no download capability → 200 PASS | Metadata allowed, download flag false. |
| VIEWER-PREVIEW-WITH-VIEW | `GET /api/documents/:id/view` | Viewer with view | 200 → 200 PASS | Preview bytes served through API. |
| VIEW-CONTENT-MATCH | Compare preview bytes to source | Viewer with view | SHA-256 equal → equal PASS | Synthetic file content matched. |
| VIEWER-CANNOT-DOWNLOAD-VIEW | `GET /api/documents/:id/download` | Viewer with view | 403 → 403 PASS | View does not imply download. |
| VIEWER-CANNOT-EDIT-VIEW | `PATCH /api/documents/:id` | Viewer with view | 403 → 403 PASS | View does not imply edit. |
| OWNER-CAN-LIST-PERMISSIONS | `GET /api/documents/:id/permissions` | Owner | 200 → 200 PASS | Owner permission list returned. |
| VIEWER-CANNOT-LIST-PERMISSIONS | Same endpoint | Viewer with view | 403 → 403 PASS | Denied. |
| VIEWER-CANNOT-GRANT | `POST /api/documents/:id/permissions` | Viewer with view | 403 → 403 PASS | Denied. |
| VIEWER-CANNOT-REVOKE | `DELETE /api/documents/:id/permissions/:permissionId` | Viewer with view | 403 → 403 PASS | Denied. |
| VIEWER-CANNOT-DELETE-SYNTHETIC | `DELETE /api/documents/:id` | Viewer with view | 403 → 403 PASS | Only the synthetic test document was targeted; no deletion occurred. |
| OUTSIDER-WORKSPACE | `GET /api/workspaces/current` | Workspace B admin | 200 → 200 PASS | Separate workspace confirmed. |
| WORKSPACE-SEPARATION | Compare workspace identifiers | Workspace A vs B admins | Distinct → distinct PASS | Two separate workspaces. |
| ORIGIN-REVOKE-VIEW | `DELETE /api/documents/:id/permissions/:permissionId` | Owner | 204 → 204 PASS | View grant revoked. |
| REVOKED-VIEW-METADATA | `GET /api/documents/:id` | Viewer after revocation | 403 → 403 PASS | Next request denied. |
| REVOKED-VIEW-PREVIEW | `GET /api/documents/:id/view` | Viewer after revocation | 403 → 403 PASS | Next request denied. |
| GRANT-DOWNLOAD | Permission POST with `level=download` | Owner | 201/download → 201/download PASS | Separate download grant created. |
| VIEWER-DOWNLOAD-WITH-GRANT | `GET /api/documents/:id/download` | Viewer with download | 200 → 200 PASS | File served by backend. |
| DOWNLOAD-CONTENT-MATCH | Compare downloaded bytes to source | Viewer with download | SHA-256 equal → equal PASS | Synthetic file content matched. |
| DOWNLOAD-NO-STORE | Inspect response cache header | Viewer with download | `private, no-store` → exact match PASS | Response is not cacheable as a public resource. |
| DOWNLOAD-HAS-NO-STORAGE-URL | `GET /api/documents/:id` | Viewer with download | No storage path → absent PASS | Metadata response contained no `storagePath`; source review found no client-facing signed/public URL generation. |
| DOWNLOAD-GRANT-CANNOT-EDIT | `PATCH /api/documents/:id` | Viewer with download | 403 → 403 PASS | Download does not imply edit. |
| ORIGIN-REVOKE-DOWNLOAD | Permission DELETE | Owner | 204 → 204 PASS | Download grant revoked. |
| REVOKED-DOWNLOAD | `GET /api/documents/:id/download` | Viewer after revocation | 403 → 403 PASS | Next request denied. |
| GRANT-EDIT | Permission POST with `level=edit` | Owner | 201/edit → 201/edit PASS | Named-user edit grant created. |
| VIEWER-READ-WITH-EDIT | `GET /api/documents/:id` | Viewer with edit | 200, canEdit true/canDownload false → 200 PASS | Edit scope reflected in response. |
| VIEWER-EDIT-METADATA | `PATCH /api/documents/:id` name/category | Viewer with edit | 200/updated metadata → 200 PASS | Metadata changed; file bytes were not edited. |
| VIEWER-CANNOT-DOWNLOAD-EDIT | `GET /api/documents/:id/download` | Viewer with edit | 403 → 403 PASS | Edit does not imply download. |
| VIEWER-CANNOT-DELETE-EDIT | `DELETE /api/documents/:id` | Viewer with edit | 403 → 403 PASS | No deletion occurred. |
| VIEWER-CANNOT-MANAGE-EDIT | `GET /api/documents/:id/permissions` | Viewer with edit | 403 → 403 PASS | Denied. |
| VIEWER-CANNOT-GRANT-EDIT | Permission POST | Viewer with edit | 403 → 403 PASS | Denied. |
| VIEWER-CANNOT-REVOKE-EDIT | Permission DELETE | Viewer with edit | 403 → 403 PASS | Denied. |
| EDIT-CANNOT-ELEVATE-ROLE | PATCH with extra `role=admin` | Viewer with edit | 400 → 400 PASS | Strict input validation rejected extra field. |
| EDIT-CANNOT-FORGE-OWNER | PATCH with extra `ownerId` | Viewer with edit | 400 → 400 PASS | Strict input validation rejected extra field. |
| EDIT-ROLE-UNCHANGED | `GET /api/auth/me` | Viewer with edit | 200/viewer → 200/viewer PASS | Workspace role remained viewer. |
| VIEWER-CANNOT-ADMIN-AUDIT | `GET /api/audit-logs` | Viewer | 403 → 403 PASS | Admin-only route denied. |
| OWNER-CANNOT-ADMIN-AUDIT | Same endpoint | Owner | 403 → 403 PASS | Admin-only route denied. |
| ADMIN-CAN-ADMIN-AUDIT | Same endpoint | Workspace A admin | 200 → 200 PASS | Workspace audit listing returned. |
| VIEWER-CANNOT-MEMBERS-AFTER-EDIT | `GET /api/workspaces/current/members` | Viewer with edit | 403 → 403 PASS | Edit did not grant admin access. |
| ORIGIN-REVOKE-EDIT | Permission DELETE | Owner | 204 → 204 PASS | Edit grant revoked. |
| REVOKED-EDIT-METADATA | PATCH after revocation | Viewer | 403 → 403 PASS | Next edit denied. |
| REVOKED-EDIT-READ | `GET /api/documents/:id` after revocation | Viewer | 403 → 403 PASS | Next read denied. |
| REVOKED-EDIT-PREVIEW | `GET /api/documents/:id/view` after revocation | Viewer | 403 → 403 PASS | Next preview denied. |
| UPLOAD-INVALID-SIGNATURE | Upload small text body claiming PDF | Owner | 400 → 400 PASS | Invalid signature rejected; no test document created by this request. |
| AUTH-LOGIN-FOR-LOGOUT | `POST /api/auth/login` | Viewer | 200 → 200 PASS | Separate logout-test session established. |
| AUTH-LOGOUT | `POST /api/auth/logout` | Viewer | 204 → 204 PASS | Session invalidated. |
| AUTH-LOGOUT-REVOKES-SESSION | `GET /api/auth/me` after logout | Viewer, logged-out session | 401 → 401 PASS | Revocation effective. |
| AUDIT-DOC-HISTORY-OWNER | `GET /api/audit-logs/documents/:id` | Owner | 200 → 200 PASS | Document event history returned. |
| AUDIT-REQUIRED-EVENTS | Inspect returned event pairs | Owner | Required success/denial pairs present → present PASS | Upload, view, download, edit, permission grant/revoke, and denied access actions recorded. |
| AUDIT-EVENT-ATTRIBUTES | Inspect successful events | Owner | Actor/document/company/timestamp present → present PASS | Required fields present in successful events. |
| AUDIT-NO-MUTATION-ROUTE | `POST /api/audit-logs` | Workspace A admin | 404 → 404 PASS | No audit-create route. |

## D. Security findings

**No exploitable authorization failure was confirmed in the bounded production tests.** All unauthorized operations against the new test document returned the expected denial, and no authorized deletion was made.

| Severity | Finding | Evidence / impact | Recommended action |
| --- | --- | --- | --- |
| Informational | Untrusted CORS preflight response includes the configured TrustVault `Access-Control-Allow-Origin` value rather than returning 403 or omitting the header. | The browser fetch from `https://example.com` was blocked because that value did not match the requesting origin. This did not provide the response to the untrusted browser. | No immediate vulnerability demonstrated; keep the exact Origin middleware for mutations and re-check browser CORS if CORS configuration changes. |
| Residual risk | Audit records are application-level append-through-handler, not tamper-proof. | The API has no audit mutation route, but privileged database/server access can alter records. | Use separately controlled append-only/WORM storage and backups if stronger assurance is required. |
| Residual risk | Revocation cannot recall content already obtained or stop an already-authorized in-flight request. | Fresh subsequent metadata, preview, and download requests were denied after revocation. | Document this boundary to users; use short-lived access where required. |
| Not tested | Large-file boundary, production expiry behavior, rate-limit thresholds, malware scanning, and authenticated browser UI flows. | These were outside the approved low-impact production checks; local tests cover some related behavior. | Keep claims limited to tested behavior; use local tests or a separately approved test window for remaining cases. |

## E. Deployment results

| Check | Result | Evidence |
| --- | --- | --- |
| Frontend HTTPS | PASS | `https://trust-vault-ecru.vercel.app/` returned HTTP 200 and title “TrustVault — Secure workspace”. |
| Frontend JavaScript/CSS | PASS | Current JavaScript and CSS assets each returned HTTP 200. |
| API URL wiring | PASS | The served JS bundle referenced `https://trustvault-api-pnvi.onrender.com/api`. |
| Backend HTTPS / health | PASS | `GET /api/health` returned HTTP 200 and `{"status":"ok"}`. |
| Database-dependent operations | PASS for tested paths | Registration, invitation acceptance, document metadata, permission changes, and audit reads succeeded. Health alone would not prove this. |
| Supabase-backed operations | PASS for tested file | Upload, preview, and download succeeded; preview/download SHA-256 matched the synthetic source. The route's private-bucket guard allowed the operation. No provider console or IAM review was performed. |
| Trusted-origin CORS | PASS | Browser fetch from the deployed frontend to API health resolved with HTTP 200. Trusted preflight returned HTTP 204, the exact frontend ACAO, and credentials enabled. |
| Untrusted-origin CORS | PASS in browser; raw preflight is noteworthy | Browser fetch from `https://example.com` failed with a CORS block. Raw preflight returned HTTP 204 and the configured TrustVault ACAO value, which is not equal to `example.com`; the browser enforced that mismatch. |
| API auth request from frontend | PASS for expected logged-out state | Browser's `/api/auth/me` request reached the API and returned 401 because no session was active. |
| Missing/hostile Origin on mutation | PASS in bounded no-session probes | `POST /api/auth/logout` returned 403 for absent and hostile Origin; trusted Origin without a session returned 401. An authenticated mutation with absent/hostile Origin was not attempted. |
| Production cookie attributes | PASS | Actual registration response included `HttpOnly`, `Secure`, `SameSite=None`, and `Max-Age=28800`; cookie contents were withheld. |
| Authenticated browser workflow | NOT VERIFIED | Browser inspected the login page and network behavior only. Role workflows were tested through HTTP APIs, not by automating a signed-in browser UI. |

The API's health endpoint reflects an available server process. The successful production registration and storage-backed document operations provide additional evidence that those particular database/storage paths worked during this run, not a guarantee of ongoing availability.

## F. Documentation results

- `README.md`, `THREATS.md`, `PROMPTS.md`, `docs/API.md`, `DEMO_SCRIPT.md`, and `SUBMISSION.md` are present.
- The README and API reference describe endpoint permissions, workspace/document roles, Origin requirements, schema relationships, setup, deployment, and safe demo instructions.
- `PROMPTS.md` has 10 dated entries and 9 commit links; the linked historical commits exist in repository history. Its current documentation-verification entry is intentionally not committed.
- `DEMO_SCRIPT.md` is a walkthrough, not evidence of a recorded video. No video file appears in tracked project files; external video availability is not known.
- No judge-ready/reusable credentials were provided or verified. The credentials generated for this API verification were ephemeral and are not recoverable from the report.
- The report includes limitations and distinguishes production API evidence from local tests and browser-only evidence.

## G. Estimated Snovasys readiness score

This is an evidence-based estimate, **not an official judge score**.

| Area | Available | Estimate | Rationale |
| --- | ---: | ---: | --- |
| Security | 35 | 31 | Production checks covered roles, isolation, grants, Origin, revocation, cookies, and audit behavior. No independent cloud/IAM review, authenticated browser workflow, or privileged-adversary assurance. |
| Threat thinking | 15 | 13 | Threat model explains mitigations and meaningful residual risks; infrastructure-level tamper resistance and malware scanning remain outside scope. |
| Functionality | 15 | 13 | Core API operations passed against production test resources; structural PDF rendering, several boundaries, and complete browser UI flows were not verified. |
| AI usage | 15 | 12 | Dated work log and real history references exist; AI attribution is documented, but it is not independent human validation. |
| Engineering quality | 10 | 9 | 25 local tests and production build passed; route-level authorization tests are present. No mutation testing was performed. |
| Documentation, deployment, and demo | 10 | 7 | Deployment and docs are present and availability is verified; video and reusable demo access remain unverified. |
| **Total** | **100** | **85** | **PARTIALLY READY** until remaining demo deliverables and authenticated browser demonstration are addressed. |

## H. Remaining actions

1. Record and verify the actual five-minute demo video if the challenge requires a video submission.
2. Arrange reusable demo accounts through a secure process; do not reuse the ephemeral verification credentials.
3. Manually demonstrate the authenticated frontend workflows with test identities. Do not represent the API-only checks as authenticated browser UI verification.
4. Decide separately whether to retain the verification workspaces/document or approve a cleanup plan. No cleanup was performed; workspace/account deletion is not implemented.
5. Keep production claims scoped to the evidence in this report and rerun availability checks near submission time.

## I. Test data inventory and production residue

Run identifier: `2610250742-3fd0`.

| Kind | Synthetic identifier | Count | State |
| --- | --- | ---: | --- |
| Workspace A | `TV QA Workspace A 2610250742-3fd0` | 1 | Remains in production. |
| Workspace B | `TV QA Workspace B 2610250742-3fd0` | 1 | Remains in production. |
| Workspace A administrator | `tvqa-2610250742-3fd0-admin@example.test` | 1 | Remains in production. Password was ephemeral and is not recorded. |
| Document owner | `tvqa-2610250742-3fd0-owner@example.test` | 1 | Remains in production. Password was ephemeral and is not recorded. |
| Viewer | `tvqa-2610250742-3fd0-viewer@example.test` | 1 | Remains in production. Password was ephemeral and is not recorded. |
| Workspace B administrator / outsider | `tvqa-2610250742-3fd0-outsider@example.test` | 1 | Remains in production. Password was ephemeral and is not recorded. |
| Synthetic PDF-signature test payload | `tvqa-synthetic-2610250742-3fd0.pdf`; document ID `6addb319eee414f18133593c` | 1 | Remains in production; metadata was renamed/category changed during edit testing. Its rendering in a PDF reader was not verified. No deletion was performed. |
| Permissions and audit events | Grants were created and revoked for view, download, and edit; successful/denied events were generated. | Several | Revoked grants and audit events remain in production. |
| Invitation codes / passwords / cookies | Not included | 0 in report | Not printed or stored in the repository. Generated passwords were discarded after the test process. |

The application does not provide workspace/account deletion. The PDF may be removable by its owner or a workspace administrator, and the invited members may be removable by the administrator, but those cleanup actions were **not** performed and require separate authorization. The two administrator accounts/workspaces may remain even if the document and invited memberships are later removed.

## Local verification

- `npm test` — **PASS**, 20 server tests and 5 client tests; 25 total, no failures.
- `npm run build` — **PASS**, Vite 6.4.5 production build; 29 modules transformed.
- Existing tests cover authentication, role restrictions, workspace isolation, grants, edit boundaries, revocation, denied access/audit, and Origin behavior. Assertions directly check expected API statuses. No test was run with an authorization check deliberately removed.
- No source code or production settings were changed for this verification. The only requested local artifact is this report.
