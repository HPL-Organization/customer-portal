# Autopay Flow

This document describes the current stock-change autopay flow for queueing, grouping, notifying, charging, callback handling, and the customer-level Express Pay preference that selects the autopay payment instrument.

## Express Pay Preference

Customer preference fields:

- `customer_information.express_pay`
- `customer_information.express_pay_updated_at`

Portal entry points:

- [src/app/(portal)/express-pay/page.tsx](customer-portal/src/app/(portal)/express-pay/page.tsx)
- [src/app/(portal)/payment/page.tsx](customer-portal/src/app/(portal)/payment/page.tsx)
- [src/app/(portal)/invoices/page.tsx](customer-portal/src/app/(portal)/invoices/page.tsx)

Supporting provider and read path:

- [src/components/providers/PaymentMethodsProvider.tsx](customer-portal/src/components/providers/PaymentMethodsProvider.tsx)
- [src/app/api/supabase/get-customer-info/route.ts](customer-portal/src/app/api/supabase/get-customer-info/route.ts)

Preference mutation routes:

- [src/app/api/netsuite/set-preferred-autopay-method/route.ts](customer-portal/src/app/api/netsuite/set-preferred-autopay-method/route.ts)
- [src/app/api/netsuite/delete-token/route.ts](customer-portal/src/app/api/netsuite/delete-token/route.ts)
- [src/app/api/admin/sync-payment-instruments/route.ts](customer-portal/src/app/api/admin/sync-payment-instruments/route.ts)

Current behavior:

- customers can choose one saved payment instrument as their Express Pay method
- `get-payment-method` decorates the selected instrument with `preferredAutopayMethod`
- the payment-method UI shows the current Express Pay method and links users into the dedicated `/express-pay` page
- the invoices page includes an Express Pay CTA
- when Express Pay is turned off, the portal sends an empty string to NetSuite Writes for `custentity_hpl_express_pay` instead of JSON `null`
- every local preference change updates `express_pay_updated_at`
- if the selected instrument is deleted or soft-deleted, the portal clears `express_pay` and stamps `express_pay_updated_at` with the clear time

Customer sync protection:

- [src/app/api/admin/sync-customer-info/route.ts](customer-portal/src/app/api/admin/sync-customer-info/route.ts) reads the customer manifest `generated_at`
- if `express_pay_updated_at > manifest.generated_at`, sync preserves the local `express_pay` and `express_pay_updated_at`
- if the manifest is newer, sync accepts the NetSuite snapshot and clears the local override timestamp
- this follows the same general protection pattern already used for `invoices.payment_processing_started_at`

## Entry Point

Main cron route:

- [src/app/api/admin/autopay-cron/route.ts](customer-portal/src/app/api/admin/autopay-cron/route.ts)

This route is protected by `x-admin-secret` using `ADMIN_SYNC_SECRET`.

It supports:

- `dry=1` or `dryRun=1`
- `debug=1`
- `customerId=<netsuite customer id>`
- `soId=<sales order id>`
- `queueIds=1,2,3`
- `maxGroups=<n>`
- `skipGrouping=1`
- `skipNotifications=1`
- `skipCharges=1`

Debug mode requires at least one scope filter (`customerId`, `soId`, or `queueIds`).

## Queue Source

Queue rows are created by:

- [src/app/api/admin/sync-sales-order/route.ts](customer-portal/src/app/api/admin/sync-sales-order/route.ts)

That sync inserts rows into:

- `autopayment_queue_stock_change`

It also refreshes:

- `sales_order_invoice_line_links`

Those links are used later to map SO line changes to invoices.

## High-Level Stages

Cron orchestration is in:

- [src/lib/autopay/process-groups.ts](customer-portal/src/lib/autopay/process-groups.ts)

The stages are:

1. Group pending queue rows to invoices
2. Send one warning email per group
3. Submit one NetSuite payment job per group

## Stage 1: Grouping

Grouping logic:

- [src/lib/autopay/group-stock-changes.ts](customer-portal/src/lib/autopay/group-stock-changes.ts)

What it does:

- loads queue rows with `status = 'pending'` and `group_id is null`
- finds matching rows in `sales_order_invoice_line_links`
- resolves the linked invoice from `invoices`
- validates customer consistency
- assigns:
  - `invoice_id`
  - `invoice_ns_line_id`
  - `customer_id`
  - `group_id`

Current grouping model:

- one queue row must map to exactly one invoice-line link
- if no link exists, row is moved to `needs_review`
- if multiple links exist, row is moved to `needs_review`

Group ID generation:

- deterministic hash based on invoice id, customer id, and queue row ids
- this same `group_id` is used as the payment idempotency key

## Stage 2: Notification

Notification logic:

- [src/lib/autopay/send-group-notification.ts](customer-portal/src/lib/autopay/send-group-notification.ts)

Email template:

- [src/lib/email/templates/autopay-pending-charge.ts](customer-portal/src/lib/email/templates/autopay-pending-charge.ts)

What it does:

- loads grouped rows where:
  - `status = 'pending'`
  - `group_id is not null`
  - `email_sent_at is null`
  - `charge_submitted_at is null`
- groups by `group_id`
- requires `customer_information.express_pay` to be present
- uses `customer_information.email` as the notification address
- sends one email per group

On success it updates all rows in the group:

- `status = 'notified'`
- `email_sent_at = now()`
- `charge_after = now() + 2 days`

If:

- customer information is missing, or
- customer email is missing, or
- `customer_information.express_pay` is missing

then:

- group rows move to `needs_review`

## Stage 3: Charge Submission

Charge logic:

- [src/lib/autopay/submit-group-payment.ts](customer-portal/src/lib/autopay/submit-group-payment.ts)

Shared autopay payment helper:

- [src/lib/autopay/submit-autopay-record-payment.ts](customer-portal/src/lib/autopay/submit-autopay-record-payment.ts)

Shared NetSuite writes enqueue helper:

- [src/lib/netsuite/enqueueRecordPayment.ts](customer-portal/src/lib/netsuite/enqueueRecordPayment.ts)

What it does:

- loads grouped rows where:
  - `status = 'notified'`
  - `email_sent_at is not null`
  - `charge_submitted_at is null`
  - `charge_after <= now()`
- resolves customer payment instruments from `payment_instruments`
- chooses the eligible instrument whose `instrument_id` matches `customer_information.express_pay`
- uses `instrument_id` as `paymentOptionId`
- submits one NetSuite payment job per group

On success it updates all rows in the group:

- `status = 'submitted'`
- `charge_submitted_at = now()`
- `netsuite_job_id = <job id from NetSuite Writes>`

It also marks the linked invoice as processing:

- `invoices.payment_processing = true`
- `invoices.payment_processing_started_at = now()`

If:

- no preferred eligible instrument exists, or
- instrument id is invalid

then the group moves to `needs_review`.

If enqueue fails:

- rows stay in `notified`
- `last_error` and `notes` are updated
- retry is possible on later cron runs

Important:

- the cron flow no longer calls a public HTTP route for autopay submission
- it uses the shared server helper directly

## NetSuite Writes Callback Split

Normal customer payment callback:

- [src/app/api/callbacks/record-payment-callback/route.ts](customer-portal/src/app/api/callbacks/record-payment-callback/route.ts)

Autopay-only callback:

- [src/app/api/callbacks/record-payment-autopay-callback/route.ts](customer-portal/src/app/api/callbacks/record-payment-autopay-callback/route.ts)

Autopay callback URL is injected per request by:

- [src/lib/autopay/submit-autopay-record-payment.ts](customer-portal/src/lib/autopay/submit-autopay-record-payment.ts)

Callback base URL resolution:

- `PORTAL_CALLBACK_BASE_URL`
- else `NEXT_PUBLIC_SITE_URL`
- else `PORTAL_BASE_URL`
- else `https://portal.hplapidary.com`

Callback signing secret:

- `NSWRITES_WEBHOOK_SECRET`
- fallback `PORTAL_CALLBACK_SECRET`

## Autopay Callback Behavior

Autopay callback route:

- verifies `x-job-signature`
- validates payload type is `record_payment`
- updates `autopayment_queue_stock_change` by `netsuite_job_id`
- clears:
  - `invoices.payment_processing`
  - `invoices.payment_processing_started_at`

On success payload:

- `status = 'paid'`
- `payment_id = result.paymentId`
- `callback_received_at = now()`
- `last_callback_status = 'done'`
- `last_error = null`
- `callback_payload = full callback payload`

On failed payload:

- `status = 'failed'`
- `callback_received_at = now()`
- `last_callback_status = 'failed'`
- `last_error = serialized callback error`
- `callback_payload = full callback payload`

The autopay callback route is intentionally separate from the normal callback route so autopay failures do not risk changing normal customer payment behavior.

## Route Separation

Normal customer payment route:

- [src/app/api/netsuite/record-payment/route.ts](customer-portal/src/app/api/netsuite/record-payment/route.ts)

Autopay does not use that route.

There is also an autopay HTTP route:

- [src/app/api/netsuite/record-payment-autopay/route.ts](customer-portal/src/app/api/netsuite/record-payment-autopay/route.ts)

This route is currently just a protected wrapper around the shared autopay helper and is not required by the cron flow itself.

## Queue Status Meanings

Current practical meanings:

- `pending`
  grouping complete or incomplete, but not yet notified
- `notified`
  warning email sent, waiting for `charge_after`
- `submitted`
  payment job sent to NetSuite Writes, waiting for callback
- `paid`
  callback reported success
- `failed`
  callback reported failure
- `needs_review`
  flow could not safely continue automatically

## Main Failure Cases

Rows move to `needs_review` when:

- queue row has no `charge_amount`
- SO line has no invoice link
- SO line maps to multiple invoice links
- linked invoice header is missing
- linked invoice customer is missing
- queue customer and invoice customer mismatch
- no customer email for notification
- no eligible saved payment instrument
- instrument id is not numeric

## Notes For Future Devs

- `group_id` is the idempotency key for autopay payment submission
- `netsuite_job_id` is the key used to reconcile callback to queue rows
- the current implementation assumes one queue row maps to one invoice-line link
- if business logic changes so one SO line can split across multiple invoices, grouping logic must be revisited
- if you want a cleaner environment setup, set `PORTAL_CALLBACK_BASE_URL` explicitly for callback URL generation
