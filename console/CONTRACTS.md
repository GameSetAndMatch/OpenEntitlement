# Customer contracts and PDF evidence

Contracts are an optional feature of the self-hosted service and console. They are not part of OEREP or the SDK contract. Evaluation continues to resolve entitlements independently of these records.

Configure distinct `OE_ADMIN_TOKEN` and `OE_EVAL_TOKEN` values before using contracts. Enter the admin token under **Connection settings**, select an organization, and use **Contracts & source documents** to:

1. Create an agreement record with a title, contract reference, and optional external system reference (for example, a Stripe subscription ID).
2. Attach a PDF copy of the agreement or SLA.
3. Link an existing override or grant to the agreement, optionally selecting a PDF, page number, and clause note.
4. Record the agreement's status and effective dates. Every change requires a reason and records the actor in the contract history.

An external reference is a reference only; it does not synchronize billing. Documents are not parsed into entitlement values. Contract status and dates do not activate, expire, or revoke entitlements. Apply those changes explicitly through plans, overrides, and grants. A page citation is entered by the administrator; the service does not verify its contents or page count.

## Storage and access

Memory mode loses contracts and PDFs on restart. PostgreSQL stores metadata and PDF bytes in the same database, with transactional updates. Include both `oe_console_contracts` and `oe_console_contract_documents` in backups. PDFs are not baked into the Docker image or written to the public website.

The administrative bearer token controls the entire instance, including all customer documents. This feature does not provide per-organization roles. Evaluation tokens cannot read contracts or PDFs. Contracts are disabled when no admin token is configured.

Uploads are limited to 10 MiB each and 20 PDFs per contract. The service checks the MIME type, filename extension, PDF header and end marker; this is basic format checking, not malware scanning or full PDF validation. Downloads require admin authentication and are served as attachments with caching disabled. Use TLS when hosting remotely and handle downloaded documents according to your organization's policies.

The initial feature supports adding documents and evidence, and updating agreement status/dates. It does not include deletion, document replacement, automated extraction, or billing synchronization. Contract history is separate from the entitlement mutation audit feed.

## Terms

- **Contract:** an organization's agreement record, including references, dates, documents, and history.
- **Source document:** a private PDF attached to a contract, with a SHA-256 digest identifying its uploaded bytes.
- **Evidence link:** provenance connecting an existing override or grant to a contract, optionally to a document page and clause.
- **External reference:** an identifier in another system; it does not change how entitlement evaluation works.
