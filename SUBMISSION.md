# TrustVault — Snovasys Fresher Hiring Challenge 2026

## Project overview

TrustVault is a full-stack secure document-sharing MVP for company workspaces. It combines a React/Vite frontend with an Express API, MongoDB/Mongoose metadata, and private Supabase Storage objects. The API derives identity and workspace membership from an authenticated HttpOnly session and applies authorization to document operations server-side.

- **Frontend:** [https://trust-vault-ecru.vercel.app/](https://trust-vault-ecru.vercel.app/)
- **Backend health:** [https://trustvault-api-pnvi.onrender.com/api/health](https://trustvault-api-pnvi.onrender.com/api/health)
- **Source repository:** [https://github.com/mv-harshitha/TrustVault](https://github.com/mv-harshitha/TrustVault)
- **Five-minute walkthrough:** [DEMO_SCRIPT.md](DEMO_SCRIPT.md)
- **API reference:** [docs/API.md](docs/API.md)
- **Threat model and residual risks:** [THREATS.md](THREATS.md)

At the latest documented availability check, the frontend returned the TrustVault page title and the backend health endpoint returned `{"status":"ok"}`. These checks do not establish that production registration, document operations, private storage, or audit workflows have been exercised successfully. Demonstrate those flows with disposable accounts and synthetic documents before presenting them as production-verified.

## Permission model

### Workspace roles

| Role | Workspace capability |
| --- | --- |
| `admin` | Manage workspace members and invitations; access workspace documents and audit activity; perform administrator document operations. |
| `owner` | Upload documents and manage documents that they own, including sharing and revoking document grants. |
| `viewer` | Access only documents explicitly granted to that user. |

The current MVP supports one workspace membership per user. Workspace roles do not replace document-level authorization: being a workspace `owner` does not make a member owner of another user's document.

### Per-document grants

| Grant | Read metadata / preview | Download | Edit name/category | Delete / manage grants |
| --- | --- | --- | --- | --- |
| `view` | Yes | No | No | No |
| `download` | Yes | Yes | No | No |
| `edit` | Yes | No | Yes | No |

Grants are named-user, workspace-scoped, may expire, and can be revoked. The API checks current access on each applicable request. An edit grant never makes its recipient a document owner, workspace administrator, or permission manager. State-changing browser API requests also require an exact trusted `Origin` matching the server's configured frontend origin; missing and untrusted origins are rejected.

## Data and audit trail

MongoDB stores workspace, user, membership, document metadata, permission, invitation, and audit-event records. Private file bytes are stored in Supabase Storage. The application stores invitation-code hashes, not the invitation codes, and stores document object paths as non-public metadata. Server handlers create audit events for relevant successes and denials; application routes do not expose audit-event mutation.

See the schema/relationship guide in [README.md](README.md#database-schema-and-relationships) for model relationships and indexes.

## AI usage

AI assistance was used during implementation, security review, testing support, and documentation. The historical prompt/work record is [PROMPTS.md](PROMPTS.md); commit references there are reconciled with repository history. AI-generated work is not independent security certification. Human review and live deployment verification remain necessary, especially for secrets, cloud policies, and authorization behavior.

## Verification and limitations

- Automated tests use MongoDB Memory Server and fake storage adapters; they do not prove production Atlas or Supabase configuration.
- The API health check is availability evidence, not a database CRUD, upload, permission, or end-to-end workflow test.
- Supabase bucket privacy is checked by the server, but live bucket access and cloud IAM were not verified in the documentation pass.
- Document lists are capped at 200 and audit lists at the latest 100 entries; pagination is not implemented.
- Invitation delivery is manual. Codes are bearer secrets and must be sent privately to the intended identity.
- File signature validation does not provide malware scanning; accepted file types are limited.
- Audit data is append-through-application, not tamper-proof against a database administrator or compromised server credentials. Database and object-storage operations cannot be committed atomically.
- Revocation affects subsequent authorization checks; it cannot recall previously downloaded/copied files or cancel a request already authorized and in progress.
- The MVP has no workspace/account deletion flow and supports only one workspace membership per user.

For safe demo identities, synthetic files, and cleanup considerations, follow [README.md](README.md#safe-three-role-demo-accounts) and [DEMO_SCRIPT.md](DEMO_SCRIPT.md).
