# STERNOIR — Mercedes-Benz club service

Full Russian-language service website and persistent customer/admin workflow. Target: https://mercedes.tetss.com. Independent service; no dealer affiliation.

## Runtime

Node 24, no npm dependencies. `npm start`; `npm test`; `npm run check`. Docker and Railway config included. SQLite requires a persistent volume mounted at `/data`, with `DATA_DIR=/data`. One application replica; SQLite is not configured for concurrent multi-host deployment.

Set `NODE_ENV=production`, canonical `APP_URL=https://mercedes.tetss.com`, and owner-managed `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 14 characters) through Railway Variables. Never commit credentials. The password is hashed in the database; changing its environment value and restarting revokes existing administrator sessions. No default administrator credentials.

## Pages and workflows

Home with a full-width G 63 forest-road film, 12 service directions, 22 model families and 61 generation pages, club, workshop/team, price explanation, parts, repair process, journal, contacts, image credits and data information. Client registration, garage, requests, versioned quotes, approval/rejection, messages and audit history. Administrator queue, actual counters, search, scheduling, controlled states, quote editor and verified assignment of guest requests.

## Important launch conditions

Per project instruction contact numbers are zeroes. Space and staff are generated visual concepts and identified as such; there are no invented verified reviews, credentials, service histories or stock claims. The site remains noindex until business identity, contact details, operator/privacy basis, hosting location and service conditions are established. This is an operational application but these business facts are not established by code.

Email/SMS delivery, online payments, email password recovery and external CRM are not connected. Reminder preference is recorded for discussion with a service advisor, not an automatic message promise. Backups must be configured and restore-tested in Railway before real customer records. Read API.md and reports for validation and limitations.

## Assets and previous concepts

All production media and fonts are local to the repository; no image hotlinks or advertising trackers. Image authors, sources and licenses are on `/credits`, with source metadata in docs. Generated workshop images use one consistent architectural reference. Visible license plates in published photographs use white STERNOIR lettering on black; image edits and preserved original hashes are recorded in `docs/plate-assets-2026-09-08.json`. The owner-provided G 63 video is edited into an 8.54-second loop; see `docs/video-loop.md` for the exact edit, ultrawide presentation and remaining blend limitations.

The previous ChatGPT Site export is preserved in archive/previous-concepts.tar.gz, excluded from the production Docker image. Copyright and third-party image licenses remain separate from application code. Public source repository does not grant a stock-photo redistribution license beyond each source's terms.
