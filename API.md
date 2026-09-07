# STERNOIR application API

Node 24, no dependencies. Run `node server.mjs`; test `node --test tests/backend.test.mjs`.

## Deployment

- `PORT`: supplied by Railway, local default 3000.
- `DATA_DIR`: mount a persistent Railway volume at `/data` and set this variable to `/data`. SQLite WAL stores users, sessions, cars, bookings, estimates, messages and immutable events. A container filesystem without a volume is not durable across deployments.
- `NODE_ENV=production`: Secure session cookie, HSTS. Behind Railway HTTPS.
- `APP_URL=https://mercedes.tetss.com`: canonical request Origin. Set to the generated Railway HTTPS origin until the custom domain is ready. Mutating requests from alternate hostnames will intentionally fail once the canonical origin is set.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD`: owner bootstrap credentials supplied only through Railway secrets. No default or seeded account. Password at least 14 characters. Existing customer accounts cannot be promoted through these variables. A changed bootstrap password updates the admin password on process startup. Avoid putting secrets in repository, reports, logs or client code.
- `public/`: static document root. Non-file routes fall back to `index.html`. Static media supports HTTP byte ranges. HTML and all API responses are not cached. The entire site sends `X-Robots-Tag: noindex, nofollow` during project preparation.

All requests and responses are JSON. Mutations require `Content-Type: application/json` and an `Origin` matching `APP_URL` (or request host during local development). Same-origin browser fetch supplies the Origin automatically. Session cookie is HttpOnly, SameSite=Lax, seven-day expiry, and Secure in production. API responses use `Cache-Control: no-store`. Errors: `{error: "Readable Russian explanation"}` with an appropriate HTTP status.

## Authentication

| Method and path | Body | Result |
| --- | --- | --- |
| GET `/api/auth/me` | — | `{user}`; user is null if anonymous |
| POST `/api/auth/register` | `{name,email,password,phone?}` | 201 `{user}` and authenticated cookie |
| POST `/api/auth/login` | `{email,password}` | `{user}` and authenticated cookie |
| POST `/api/auth/logout` | `{}` | `{ok:true}` and revoked cookie |

User: `{id,name,email,phone,role}`. Role is `customer` or `admin`. Registration requires name ≥2 characters, valid email, password 10–128 characters. Email is normalized to lowercase. Passwords use salted scrypt; only session token hashes are stored. Registration cannot choose a role. Login and registration are rate limited. Email verification, password-reset mail, SMS and messenger delivery are not connected and must not be advertised as active.

## Booking and customer account

| Method and path | Body | Result |
| --- | --- | --- |
| POST `/api/bookings` | `{name,phone,model,service,symptom?,consent:true,carId?}` | 201 `{booking: Order}` |
| GET `/api/account` | — | `{user,cars,orders,reminders:[]}` |
| POST `/api/cars` | `{model,year?,registration?,vin?,remindersEnabled?}` | 201 `{car}` |
| PATCH `/api/cars/:id` | any writable car fields | `{car}` |
| DELETE `/api/cars/:id` | `{}` | `{ok:true}` |
| POST `/api/orders/:id/messages` | `{body}` | 201 `{order}` |
| POST `/api/orders/:id/approve` | `{quoteId}` | `{order}` |
| POST `/api/orders/:id/reject` | `{quoteId,reason}` | `{order}` |

Anonymous bookings are accepted and stored. A booking attaches to the authenticated account at creation. An administrator can link an anonymous order to a selected existing customer after independently identifying the customer; there is no insecure automatic claim by phone/email. Appointments are requests until confirmed by staff. Customers can access only their own orders and cars. `remindersEnabled` stores a preference; no delivery scheduler is implemented and no outgoing notifications are sent.

Car: `{id,model,year,registration,vin,remindersEnabled,createdAt}`. Year, registration and VIN are strings. Cars are limited to 30 per account.

Order:

```json
{
  "id": "uuid", "publicId": "SN-2026-ABC12345", "customerId": "uuid or null",
  "carId": "uuid or null", "carReminderPreference": false, "name": "Customer", "phone": "+70000000000",
  "model": "E 200 W213", "service": "Двигатель", "symptom": "Description",
  "status": "new", "scheduledAt": null, "createdAt": "ISO date", "updatedAt": "ISO date",
  "quote": null, "quotes": [], "messages": [], "events": []
}
```

`carReminderPreference` reflects the current linked car preference only when the car belongs to the order customer; false if no matching car exists. It tells the advisor to discuss reminders and does not mean automated notifications are enabled.

`quote` is the latest estimate; `quotes` contains version history, newest first. Estimate: `{id,version,items:[{title,quantity,unitPrice}],total,note,status,createdAt,approvedAt}`. **All prices are integer Russian rubles.** Quantity is an integer 1–100. Estimate status: `pending`, `approved`, `rejected`, `superseded`. Total is always calculated on the server from line items; a client-provided total is ignored. Approval requires the latest pending quote ID and an authenticated order owner. Approval is not payment. A repeated or stale approval is rejected. Approved estimates and audit events cannot be rewritten or deleted through SQL updates due to database triggers.

Messages: `{id,authorRole,body,createdAt}`. Events: `{id,type,body,createdAt}`. Admin notes in the order timeline are **visible to its customer**, not private CRM notes.

## Administration

All routes require admin role. Customers and anonymous visitors cannot list leads or write estimates/statuses.

| Method and path | Body | Result |
| --- | --- | --- |
| GET `/api/admin` | — | `{user,orders,customers}` |
| PATCH `/api/admin/orders/:id` | `{status?,scheduledAt?,customerId?,note?,reason?}` | `{order}` |
| POST `/api/admin/orders/:id/quote` | `{items:[{title,quantity,unitPrice}],note?}` | 201 `{order}` |
| POST `/api/admin/orders/:id/messages` | `{body}` | 201 `{order}` |

`customerId` can be assigned once to an anonymous order and must identify an existing customer. It cannot reassign another customer's order. `scheduledAt` is an ISO date or null. Creating an estimate is allowed during diagnostics or approval; it moves the order to awaiting approval. Creating a revision supersedes a previous pending estimate without rewriting prior versions. An order may have at most 50 estimate line items, total 1–100,000,000 ₽.

Allowed transitions:

- `new` → `contacted`, `scheduled`, `cancelled`
- `contacted` → `scheduled`, `diagnostics`, `cancelled`
- `scheduled` → `diagnostics`, `cancelled`
- `diagnostics` → `awaiting_approval`, `cancelled`
- `awaiting_approval` → `in_progress`, `diagnostics`, `cancelled`
- `in_progress` → `ready`, `diagnostics` (pause requires a nonempty `note` or `reason`)
- `ready` → `completed`, `in_progress`
- `completed` and `cancelled` are final

Entering `in_progress` requires approval of the latest estimate; administrators cannot approve on a customer's behalf. Entering `awaiting_approval` requires a pending estimate. Rejecting a pending estimate returns the order to diagnostics for discussion. To investigate additional work after repair has started, an administrator must pause the repair by moving `in_progress` to `diagnostics` with a nonempty `note` or `reason`. This creates a customer-visible immutable pause event. A new estimate must then be prepared and approved before returning to work; previous approved versions remain immutable in history. Status and visit event descriptions are localized to Russian; appointment event times use Europe/Moscow.

## Operational limits

This is one Node process and one SQLite database on one persistent volume. Do not horizontally scale several independent application copies with separate volumes. Arrange encrypted off-service backups and test restores before collecting genuine customer data; volume persistence alone is not a backup. In-memory abuse limits reset on restart. Messages update on account reload; no real-time channel or external notifications are currently connected. There is no payment processing or invented repair data. A public health check is available at GET `/api/health` and reveals only `{ok:true}`.
