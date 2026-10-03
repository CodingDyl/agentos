# Business ledger setup

The local ledger is a migration foundation. The existing CRM continues to supply the operational Business screens until each module is explicitly moved to local ownership.

## Use

Open Business → Setup & import, select the business, and choose **Preview CRM import**. Review source coverage, pending quote totals, billing setup warnings, and proposed record changes. **Import reviewed records** applies exactly that preview, with no outgoing client messages or billing actions.

Only summaries available through the current connector are imported. Invoice history, payments, expenses, original PDF documents, and original document numbers require a subsequent source extension. Imported services are drafts even if their associated project is completed. Prices and billing dates are never inferred from a past invoice.

Re-importing the same source updates no record values and creates no duplicates. Changed source-owned records can be updated; records absent from later reads are retained. A preview expires after 30 minutes and becomes unusable if another import changes the ledger first.

## Storage and recovery

- Database: `business/ledger.db` under `AGENTOS_UI_DIR`, defaulting to `~/.agentos-ui`.
- The schema is versioned and created transactionally. WAL mode is enabled; do not copy only the live `.db` file while the server is running.
- **Download ledger backup** exports the selected business's validated records and source metadata as JSON.
- **Download pre-import backup** exports its state immediately before the latest applied import.
- To restore, use the same business ID with an empty local ledger, choose the JSON backup, review the preview, and apply it. The API rejects cross-business data, duplicate identifiers/numbers, broken references, over-allocated payments, and replacement of an existing ledger.
- Restore deliberately does not merge into a populated ledger. For recovery of a populated installation, preserve the original state directory and start Agentos with a separate recovery `AGENTOS_UI_DIR` containing the matching business entity configuration. Then use the restore UI, reconcile the result, and only switch directories after verifying it. Do not delete the original database as a restore step.
- These backups do not include original PDFs, external CRM data not yet imported, workspace settings, or connector credentials.

## API

All paths start with `/api/business/ledger/:entityId` and require an existing configured business entity. Local-host/origin checks protect this surface; mutations require JSON.

| Method / suffix | Behavior |
|---|---|
| `GET /` | Counts, current records, revision, and latest import summary |
| `POST /preview` | Read fresh CRM sources and prepare a server-stored preview |
| `POST /commit` | Apply `{ "previewId": "..." }` atomically |
| `GET /backup` | Download a current ledger backup |
| `GET /backup?previous=1` | Download the latest pre-import backup |
| `POST /restore-preview` | Validate a backup and prepare an empty-ledger restore |

No request can select an arbitrary database path. Import commits use prepared SQL statements and a transaction covering record changes, the previous-state backup, the audit entry, and the ledger revision. A failed commit rolls back all these writes.

## Verification

```sh
npm run build
npm exec -- tsx --test server/business/__tests__/*.test.ts server/virtec/__tests__/*.test.ts src/features/business/__tests__/*.test.ts
```

Tests use temporary state directories and never write live financial records. They exercise repeated imports, exact project linking, unknown amounts, source failures, stale/expired previews, record collisions, business isolation, database reopening, export/restore, payment allocations, document numbering, HTTP validation, and legacy quote fields.

## Core billing tools (3 October 2026)

Open **Business → Billing & cash flow**. This workspace operates on the local ledger; the other Business views continue to show CRM data during migration.

- Create or edit local clients and imported client details.
- Create quotes and invoices with whole-number quantities, rand rates, explicit dates, issuer name and payment instructions. Totals are calculated on the server in integer cents.
- Issue a draft to assign an `AG-Q-YYYY-00001` or `AG-I-YYYY-00001` number and freeze the document. Issuing does not send it. Record quote acceptance, then convert once to an invoice draft.
- Use **Print / PDF** to open an escaped, print-ready document and save it through the browser's print dialog. The layout uses a dark header and cyan accent inspired by the provided invoices. Issued documents snapshot the client and issuer names.
- Review imported service drafts, set their client, price, cadence and next invoice date, then activate them. **Generate next invoice drafts** generates one due period per active service per run. Repeated runs can catch up older periods. Dates retain the original day across short months; service/period pairs cannot be duplicated. Each invoice still needs review and issue.
- Record actual payments, either allocated to one issued invoice (partial payments supported) or as unallocated client credit. Over-allocation and cross-client references are rejected.
- Record paid expenses with vendor, category, date and note. Month-filtered cash flow uses actual payment/expense dates. Outstanding invoices and recurring monthly forecasts are displayed separately.
- Edits to imported records are retained during subsequent CRM imports. Global revisions reject stale saves. All writes are transactional and validated against the full business ledger.

### Current limits

This is a local billing workspace, not a completed CRM replacement. Historical invoices, expenses and payments are still in the CRM; its maintenance invoices use a separate Firestore collection that the configured summary connector does not expose. Do not enter opening balances by guessing from paid invoice flags.

The core phase originally excluded VAT and correction workflows; these are implemented in the next-phase section below. Email delivery, payment collection, scheduling, receipts, discounts, fractional quantities, refunds and credit notes remain outside the current scope. Posted payments/expenses and issued documents cannot be edited in this UI. Review inputs before saving. Quotes may be recorded as accepted only when the client has actually accepted them. No external contract acceptance or email is performed by that button.

Native writes: `POST /api/business/ledger/:entityId/operate` with the current `revision` and an action (`save`, `issue`, `accept`, `convert`, `generate`). Print: `GET /api/business/ledger/:entityId/documents/:id/print`. The existing host/origin/JSON guards also protect these routes. Printed content is escaped and protected by a restrictive CSP.

### Document output choice

| Option | Benefit | Trade-off |
| --- | --- | --- |
| Browser print-to-PDF (implemented) | Uses the existing app/browser; private rendering and selectable text | User chooses Save as PDF; pagination depends on the browser |
| Server PDF renderer | Deterministic downloadable files | Adds a rendering dependency and deployment maintenance |
| External document service | Managed templates and delivery | Sends business/client data to another provider and adds cost |

## Corrections, VAT and historical import (next phase)

### Correcting mistakes

Use **Void incorrect entry** for a data-entry mistake in a payment, expense, quote or invoice. Supply a reason. The original amounts and references remain in the ledger and the voided record is excluded from cash-flow and balance calculations. This corrects the original transaction period; it is not a current-period refund. Voids are not tax credit notes. An invoice with payment allocations cannot be voided until those allocations are removed or the erroneous payment itself is voided. A quote with an active converted invoice cannot be voided first.

**Manage allocations** on a payment can assign previously unallocated credit or redistribute it among issued invoices for the same client. It replaces the displayed allocation set without changing the payment amount or received date; the server checks both payment and invoice limits. Each change requires a reason.

**Change history** includes native saves, issuance, corrections, conversions, generation and business-profile changes made since this upgrade. Each change retains a downloadable prior-state backup. Requests can carry an optional UUID `requestId`; repeating an identical request returns the current ledger without applying the operation twice. A reused ID with different input is rejected. Earlier work from before this upgrade is not retroactively audited.

### Business details and VAT

Under **Billing & cash flow → Business details & VAT**, enter the supplier name, address, email, payment instructions and default terms. VAT is disabled until explicitly enabled. Registration requires a supplier address and VAT registration number. New documents can use inclusive or exclusive prices and a rate in hundredths of a percent. Totals use integer arithmetic, rounded half-up once per document. Only one VAT rate/basis per document is currently supported; there is no tax-return calculation or automatic expense input-VAT deduction.

VAT document issuance requires a client billing address. Client records also support an optional VAT number. Printed VAT documents include supplier and client details, document number/date, line quantities, subtotal, VAT and total. Supplier and payment details are captured when the draft is saved; issued documents keep those snapshots after later profile edits. Existing drafts do not silently gain VAT when a profile is enabled. Recurring services retain an explicit tax choice.

The field design was checked against the [SARS tax-invoice checklist](https://www.sars.gov.za/businesses-and-employers/government/tax-invoices/) and [VAT 404 vendor guide](https://www.sars.gov.za/legal-pub-guide-vat404-vat-404-guide-for-vendors/). The app does not validate registration with SARS or determine whether a supply qualifies for a particular rate.

### Historical billing files

**Setup & import → Import billing history** accepts the version-one `agentos-billing-history` JSON format. Download its empty template and expand the on-screen mapping guide. This is a reviewed export contract, not a direct Firestore connection. The CRM repository's `maintenance_invoices` and expense data need an authorized export and conversion into this format. No new cloud credentials or remote writes were added.

- Every record needs a stable original source ID and integer-cent amount. Payments need actual received dates and expenses need actual paid dates.
- Invoice/payment client source IDs must match imported CRM clients; unmatched records block the import.
- Pending invoices become issued summaries. Cancelled invoices do not enter outstanding totals. Historical paid invoices retain a special status and remain outside outstanding totals until **Review historical balance** is applied with a reason. Their paid flags never manufacture cash receipts.
- Actual payment rows may carry allocations against invoice source IDs. After reviewing payments, reconcile a historical invoice to include its verified remaining balance in receivables.
- Preview shows invoice/payment/expense totals and row amounts, dates and source IDs. Repeated files do not duplicate data. Conflicting changes to previously imported financial history block the preview; later local corrections remain protected.
- The strict input contract rejects arbitrary URLs and unknown fields. Do not include credentials, signed PDF URLs or projected recurring expenses.

History shares the existing reviewed-import transaction and pre-import backup. New routes: `POST /history-preview`, `GET /history-template`, `GET /audit/:id/backup`. New operation actions: `void`, `allocate`, `profile`, `reconcile`.

### Backup compatibility

Database schema 2 adds business profiles, audit entries and restore metadata, preserving schema-1 records transactionally. New downloadable backups are version 2 and include the profile, record corrections/VAT snapshots and audit summaries. Version-1 backups remain readable. Individual audit snapshots live in the local SQLite database and are downloadable separately; the combined backup exports audit summaries, not all historical snapshots. A restored audit summary therefore cannot download its original prior-state snapshot. Keep the original state directory when recovering.

### Architectural choices

| Decision | Chosen approach | Alternative | Alternative |
| --- | --- | --- | --- |
| Corrections | Retain records with void metadata and transactional prior-state snapshots: reversible by recovery, clear provenance | Delete/overwrite entries: simple but loses history | Full double-entry journal: stronger accounting model, substantially larger migration |
| Historical migration | Strict JSON contract with preview, exact source links and retained paid flags: reviewable and no new credentials | Direct Firestore reader: easier recurring import, needs authorized credentials and source schema work | Browser scraping: readily visible but incomplete and fragile |
| VAT math | Integer cents and basis points with one document rate: deterministic and testable | Decimal library: more complex tax/quantity handling, new dependency | External tax service: broader jurisdiction support, cost and financial-data disclosure |

Still outside this phase: automatic email delivery, payment collection, scheduled billing, original PDF/receipt migration, refunds, tax credit notes, mixed VAT rates, discounts and fractional quantities. No client messages were sent and no live VAT settings or financial records were changed during verification.
