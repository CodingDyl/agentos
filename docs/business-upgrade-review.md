# Business upgrade: CRM review and proposed rollout

Reviewed 3 October 2026. Status: Setup foundation implemented; quote/invoice authoring and recurring billing are the next phase.

## Setup implementation — 3 October 2026

- Added **Business → Setup & import** with a CRM preview, reconciliation checks, a searchable local inventory, and ledger backup downloads.
- Added a private SQLite ledger at `~/.agentos-ui/business/ledger.db` (or the configured `AGENTOS_UI_DIR`), with typed client, project, service, quote, invoice, payment, and expense contracts. Monetary values use integer cents.
- Imports preserve normalized source records and identifiers, are transactional, save a pre-import backup, and update the same source record instead of duplicating it. They retain previously imported records absent from a subsequent source read. Expired, stale, failed-source, skipped-record, truncated-source, and conflicting previews cannot be committed.
- Backups are validated before restore. The restore flow only applies to an empty ledger for the same business; it never overwrites existing financial records. Backups cover local ledger records, not workspace-link settings, connection secrets, or source PDFs.
- Imported the available live CRM summaries: **11 clients, 17 projects, 14 quotes, and 5 service drafts**. All service drafts require explicit setup; a completed project does not imply a cancelled recurring service.
- Found and fixed legacy CRM quote fields: `total_amount`, `created_at`, `project_id`, `project_type`, and `client_id`. Eleven older quotes now retain their amounts/dates. Twelve legacy client links can be resolved from exact project IDs. The pending quote value reconciles to **R44,500**.
- Original invoices, payment histories, expenses, PDF files, contact phones, and document numbers are not exposed by the existing CRM connector and were not imported. The import screen identifies this scope explicitly. Current operational Business screens still use the CRM; the local ledger is a migration foundation, not a completed cutover.
- Verification includes store/API/normalizer/business tests, build/type checking, lint, and live browser import/filter checks. Backup tests preserve invoice numbers, payment dates, and expense amounts when those records are present in a supported ledger backup.

Next phase: extend the migration source for full financial records, then add client/service editing, quote and invoice authoring with PDF output, payment/expense workflows, and recurring draft billing. Confirm each service's amount, cadence, and first billing period before activating it.

## Objective

Make Agentos the day-to-day home for Virtara's clients, quotes, invoices, recurring services, expenses, and cash flow. Replace the existing CRM gradually. The user confirmed that payments and expenses are currently recorded in the CRM and that the scope includes quotes, invoices, and monthly billing.

## Evidence from the current system

The signed-in CRM was reviewed at https://virtec-crm.vercel.app/dashboard: Overview, Generate Quote, Quotes, Expenses and its unsaved entry form, Maintenance Table, Subscriptions, and Aureya's workspace and maintenance configuration. No business records were changed.

- The CRM lists 14 quotes: 10 accepted, two pending, and two rejected. Pending quotes total R44,500. Agentos's entity summary reported R40,000 while its imported revenue summary reported R44,500. Reconcile these definitions and records before using a consolidated KPI.
- The maintenance table reports 50 invoices, all marked paid. This is the CRM's recorded status, not independent bank verification.
- Aureya's maintenance project has paid R500 hosting invoices but says "No schedule yet" and has an amount per cycle of R0. Its frequency form displays Monthly even though the summary says the billing frequency is not set. Three older invoices are unlinked to a project. Recurrence cannot safely be inferred from a form default or historical invoice alone.
- The CRM overview reports three active maintenance customers and R0 monthly recurring maintenance. Agentos's current business endpoint returns no retainers, while a separate client flag yields five maintenance clients. These are different measures and should have explicit definitions.
- Expenses already support vendor, date, category, recurrence, payment method, project allocation, notes, receipt attachment, and tax-related flags. Four expense records from July produce roughly R1,401 fixed monthly burn, while October recorded spending is R0. Expected recurring costs and actual payments need distinct records and labels.
- The CRM's "Subscriptions" page contains newsletter subscribers, not paying recurring-service customers. Keep marketing subscribers in Growth and use "Recurring services" for client billing.
- The quote generator offers company/project selection, hours, hourly rate, complexity, urgency, feature checkboxes, discounts, and a calculated preview. Preserve estimation as an optional helper, while supporting editable fixed-price and recurring service lines.
- The maintenance table primarily identifies contacts: both Aureya and Vaja appear as Tyler. Company and serviced website should be prominent so separate clients are easy to distinguish.

Agentos already imports clients, quote summaries, agreements, maintenance fields, follow-ups, and revenue summaries. It links clients to project workspaces and email threads and supports Gmail draft creation. The current integration does not expose quote creation, full invoices/payments, or expenses. Its Business state file stores entity/workspace links rather than the financial records themselves.

Relevant code: `shared/business-types.ts`, `server/business/business.ts`, `server/business/store.ts`, `server/virtec/client.ts`, `src/features/business/business-page.tsx`, `src/features/business/business-sections.tsx`, and `src/lib/agentos/business.ts`. Agentos also has an existing SQLite-backed Finance module and transaction import infrastructure that should be evaluated for reuse without mixing personal and business totals.

## Document review

All three supplied documents are maintenance invoices, not quotations. Each is a one-page Virtara document with a dark header, cyan accent, client block, item table, total, unique invoice number, and 30-day payment terms.

| Source | Invoice | Item | Total |
|---|---|---|---:|
| Monthly-hosting-aureya-09-25_11-00-42_invoice.pdf | VRT-2026-0038 | Monthly Hosting | R500 |
| Monthly-hosting-vaja-09-25_11-00-42_invoice.pdf | VRT-2026-0039 | Monthly Hosting | R500 |
| MPower_maintenance_and_doc_update.pdf | VRT-2026-0040 | Standard Maintenance Fee | R750 |

Source directory: `/Volumes/DylanSSD/Documents/Business/Virtara/invoices/Sept:Oct/`.

Preserve this visual identity. Improve the document model with explicit billing periods, due dates, payment references, configurable business/payment details, and units suitable for the service. Hosting should support a monthly unit rather than requiring a fictional hour. The MPower filename mentions document updates, but its invoice only itemizes a standard maintenance fee; future invoices should capture the actual agreed scope in their line descriptions. Do not infer additional charges from filenames.

An existing quotation PDF should be inspected before finalizing the quotation-specific layout. Quote validity, scope, exclusions, optional items, deposits, and acceptance details belong in the quote template. Tax settings must be configured from the business's actual circumstances; no registration or entitlement is assumed.

## Proposed Business navigation

| Area | Main job |
|---|---|
| Overview | Cash received, expenses paid, net cash movement, outstanding invoices, expected recurring revenue, and work due |
| Clients | Company/contact records with services, projects, documents, balances, and communication history |
| Quotes & invoices | Create, revise, preview, export, track status, convert accepted quotes, and record payments |
| Recurring services | Hosting, maintenance, and SEO contracts; pricing, billing periods, next dates, paused/cancelled state, and delivery checklists |
| Expenses | Actual expenses, receipts, recurring commitments, and client/project cost allocation |
| Reports | Monthly comparisons, cash forecasts, collection aging, client contribution, and export |

Keep agreements inside the relevant client/project and follow-ups in the overview action queue. Growth can retain its existing acquisition workflows without cluttering billing.

## Core workflows

### Quotes and invoices

Choose client -> select service template -> edit scope and line items -> review totals and PDF -> save draft -> issue deliberately. Accepted quote -> create linked project and/or recurring service -> create deposit, milestone, or final invoice without retyping the client and scope.

Support fixed fees, hours, quantities, recurring lines, discounts, configurable taxes, notes, validity, and payment terms. Preserve issued versions; use revisions and credits rather than silently changing historic documents. Store money as integer cents and recalculate totals on the server. Reserve unique document numbers transactionally and retain imported numbers.

Payments need amount, received date, method/reference, and invoice allocation. Support partial payments and a payment covering more than one invoice. Legacy "paid" flags without a reliable payment date must remain marked as historical/unverified rather than fabricating a receipt date.

### Recurring clients

Model a service agreement independently of a project: client, website/project link, service type, price, cadence, billing anchor, period, start/end dates, next invoice date, and status. Multiple services can belong to one client. Show billed, paid, overdue, and delivery state independently.

Generate one draft invoice per service and billing period, with duplicate prevention and a review step. When Agentos is reopened after being offline, show missed periods for review rather than silently issuing a backlog. Price changes take effect from a chosen future period. Never classify an invoice as paid merely because it was generated or sent.

### Money in versus money out

Use actual recorded receipts and expenses for monthly cash movement. Show invoiced revenue, outstanding receivables, and scheduled recurring revenue separately. Accepted quote value belongs to sales pipeline, not cash received. Transfers and owner contributions need separate classifications.

Reuse suitable Finance import mechanics for CSV/bank matching. Match imported payments to existing entries instead of counting them twice. Allocate direct costs to clients/projects; label contribution after direct costs separately from business-wide profit. Keep overhead and personal spending visibly separate.

## Additional high-value improvements

1. **Billing and delivery queue:** due invoices, late payments, expiring domains, upcoming renewals, missing receipts, and overdue maintenance/SEO tasks.
2. **Client profitability:** compare fees received with allocated hosting/tools, contractor costs, and optionally time spent; flag clients needing a pricing review.
3. **Service catalogue:** reusable hosting, maintenance, SEO, and development packages with editable descriptions and prices.
4. **Monthly service report:** assemble completed maintenance, backups, uptime, and SEO work into a client-ready draft using available evidence.
5. **Cash forecast:** expected collections and scheduled costs over the next 30/60/90 days, clearly distinguished from actual cash.
6. **Drafting assistance:** prepare scope, quote descriptions, and reminder drafts from client/project context, while keeping amounts and final communications reviewable.
7. **Business backups and exports:** recoverable snapshots, document archives, CSV exports, and a tested restore path.

## Replacement approach

| Option | Advantages | Drawbacks |
|---|---|---|
| Keep CRM as permanent backend | Fastest initial extension; preserves current workflows | Ongoing dependency and two applications to maintain |
| Replace everything in one cutover | One system immediately afterward | Highest migration and financial-history risk; delays useful improvements |
| Replace module by module — recommended | Useful capabilities arrive incrementally; each migration is verifiable | Requires explicit ownership and temporary compatibility code |

Each migrated module gets one authoritative writer. Preserve CRM source IDs, old document numbers, original PDFs, and import provenance. Reconcile counts, totals, dates, and client links before switching ownership. Re-running an import must not duplicate records. Keep a backup/export of the old CRM and retain rollback access until the migrated modules are verified.

For local financial storage, the existing SQLite pattern is the leading candidate, subject to the foundation review:

| Storage option | Advantages | Drawbacks |
|---|---|---|
| Extend JSON files | Minimal initial setup | Weak fit for linked payments, concurrent numbering, and atomic billing operations |
| SQLite — recommended for the current local app | Transactions, uniqueness constraints, relational queries, existing repo precedent | Requires backups and a separate strategy if multi-device access becomes necessary |
| Hosted relational database | Supports multiple users/devices centrally | Adds hosting, authentication, connectivity, and migration work before these are requested |

Keep typed contracts, persistence, document generation, billing, imports, and UI in separate modules. Client-visible totals should come from server calculations. Retain server-only connector credentials and existing authorization checks; validate entity ownership on all financial record operations.

## Staged implementation

### 1. Setup: dependable business records

Design and implement client, service, document, payment, and expense contracts/storage. Add a reviewable CRM import with original identifiers, reconciliation, and missing-data reports. Investigate the R40,000/R44,500 quote discrepancy and the missing maintenance schedules. Preserve current read access during migration.

Exit criteria: imports are repeatable, source counts/totals reconcile or exceptions are explicit, historic numbers survive, no data is invented, and backup/restore works.

### 2. Core features: run the business from Agentos

Build the quote/invoice editor and branded PDF preview/export, recurring-service management and draft billing, payments/expense entry, and an overview using correctly defined money totals. Link each record to clients and existing project workspaces.

Exit criteria: a client can be quoted, invoiced, partially paid, fully paid, and billed for the next service period without duplicate records; expenses affect the correct month/entity; PDF totals match saved records; recurring forecasts never masquerade as receipts.

### 3. Stretch goals: less administration

Add payment matching, renewal reminders, service-delivery reports, profitability, forecasts, and assisted drafting. Consider client portals and multi-device access only after the core workflow is reliable.

Per the user's staged workflow preference, complete review first and wait for "next" before beginning Setup; review each phase before advancing.

### Core Features implemented — 3 October 2026

The new Billing & cash flow workspace includes native client editing, line-item quotes/invoices, issuance and numbering, quote acceptance/conversion, print-to-PDF documents, recurring service configuration and on-demand invoice drafts, partial payment recording, expense entry, monthly cash flow and outstanding balances. This phase retains CRM views for comparison and protects local edits from reimport. See `business-ledger-setup.md` for the workflow and explicit limitations.

Further migration needs an export/read integration for the CRM's maintenance invoices and expense collections. Core billing does not infer payment transactions from invoice status. Next-phase candidates: reviewed historical migration, corrections/credit notes, VAT/company profile, receipts, email delivery and scheduled draft generation.

### Corrections, VAT and migration tooling implemented

Added audited voids, payment reallocation, idempotent native requests, business profiles, explicit inclusive/exclusive VAT, frozen printable supplier details, version-two backups, and a strict reviewed historical-billing import format. Historical paid flags do not create cash receipts. The actual CRM history still needs an authorized export; the configured summary connector does not expose it. Automatic sending/scheduling and tax credit notes remain future work. See `business-ledger-setup.md` for the complete workflow and recovery limits.
