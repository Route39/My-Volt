# MyVolt — Fleet & Rental Operations Platform (Route39 / Attendy)

## Original Problem Statement
Standalone Fleet + Rentals + Service operations platform for Route39's prepaid EV rental fleet
across Tiruppur, Coimbatore, Chennai, Bangalore. Must feel like a modern fleet command center,
NOT an ERP. Explicitly EXCLUDES trips, passengers, fares, ride dispatch, trip revenue/earnings.

## Architecture
- Frontend: React 19 + Tailwind + shadcn/ui + recharts + framer/CSS animations. Dark "obsidian" command-center theme (Outfit + IBM Plex Sans).
- Backend: FastAPI (single server.py) + Motor/MongoDB. All routes under /api.
- Auth: JWT (httpOnly cookie `access_token` 12h) + bcrypt; Bearer fallback via localStorage `mv_token`. Brute-force lockout (5 fails → 429).
- Multi-tenant: every doc scoped by `organization_id` (route39-org). City-level scoping for city_manager.
- Collections: users, vehicles, drivers, driver_vehicle_assignments, rental_plans, rentals, rental_payments, vehicle_handovers, vehicle_returns, service_requests, vehicle_services, locations, documents, incidents, notifications, audit_logs, vehicle_transfers, login_attempts.

## Roles
admin (all), operations_manager, city_manager (own city only), service_manager, staff. Enforced backend (require_role + org_filter) and reflected in sidebar nav gating.

## Test Accounts (password Route39@2026)
support@route39.in (admin), ops@route39.in, chennai@route39.in (city mgr), service@route39.in, staff@route39.in

## Implemented (2026-06)
- Auth + roles + org/city isolation + brute-force lockout.
- Dashboard command center: animated KPI cards, fleet-status donut, city cards, rental snapshot, Needs Attention (deep links), Recent Operations timeline.
- Fleet: grid/list, status/city filters, search, pagination (load more), vehicle cards (battery bar), vehicle profile (7 tabs), status change, transfer, handover & return workflows.
- Drivers: cards/list, profile with tabs, create, vehicle assignment + assignment history.
- Rentals: sectioned list, 7-step create wizard, rental profile with payment ledger, activate/renew/suspend/close, rental plans (Settings).
- Service Requests: drag/drop Kanban (6 stages) + detail + timeline. Vehicle Service records with completion syncing vehicle status.
- Locations (capacity bars), Documents (expiry status), Incidents (workflow), Vehicle Health, Reports (recharts), Global command search, Notifications center, Quick Action menu, mobile bottom nav + FAB.
- Rich demo seed: ~278 vehicles + drivers/rentals/payments/SRs/services/docs/incidents across 4 cities.

## Verified
Testing agent iteration_1: backend 39/42 pytest pass; frontend all 12 routes + wizard + CRUD. Post-fixes (curl-verified): pending_payment deep link (80), suspend/close 404 guards, suspend no-body 200, Fleet pagination, nav role gating, city-manager city lock, EV fleet hero image, brute-force lockout.

## Industry Configuration (multi-industry)
MyVolt is now industry-configurable. `organizations` collection holds `{org_id, name, industry, modules, max_file_mb}`. `/auth/me` + login attach `industry`, `org_name`, `modules` to the user. Frontend switches nav, branding, dashboard, reports, quick actions, global search and route guards by `user.industry`.
- **Route39** — industry `fleet` (unchanged).
- **Nayara Studio** — industry `fabric_order_management`. Simple order management only (no manufacturing/BOM/QC). Org-isolated `orders` + `customers` collections.

### Nayara modules (implemented 2026-06)
- Dashboard: 6 KPIs, Order Pipeline, Today's/Due Soon/Recently Completed/Needs Attention.
- Orders: Kanban (Received → Processing → On Hold → Completed) with working drag-and-drop + List view, filters, search, create dialog.
- Order detail: status + Complete, editable Notes, Payment, base64 Attachments (thumbnails + lightbox), Activity Timeline.
- Customers: list/create + profile with order counts/history. Reports: by status/assignee/customer/month.
- Isolation verified (backend org_filter + frontend route guards).

### Nayara test accounts (password Nayara@2026)
admin@nayara.studio (admin), nandhini@nayara.studio (staff), priya@nayara.studio (staff)

## Platform Admin (SaaS layer) — added 2026-06
Generic, industry-neutral login ("Manage your work. All in one platform." + abstract SaaS visual, MyVolt/BY ATTENDY). New role `platform_admin` (org `platform`) with its own light shell + routes at `/platform/*`: Dashboard (KPIs: total/active/trial companies, total users, active subscriptions + Companies Overview table), Companies (search/industry/status filters), Add Company, Company Profile (details + enabled modules), and placeholder pages (Subscriptions, Industries, Platform Users, Settings). Backend `/api/platform/*` guarded by `require_platform` (non-platform users → 403). Company orgs carry plan/status/contact/created_at. Existing Route39 + Nayara apps and logins untouched. Login: platform@myvolt.app / Platform@2026.

## Company Onboarding (Add Company + first admin) — 2026-06 ✅ verified (iteration_4)
`POST /api/platform/companies` creates an organization AND its first `company_admin` together in one call:
- Company fields: name, code (auto-slugified server-side via regex, sanitized + unique), industry, plan, status.
- First admin (nested `admin` object): name, email, phone, temp password (manual entry, min 6 chars client-side).
- Server-side: assigns industry default modules (fleet → full Route39 nav; fabric_order_management → dashboard/orders/customers/reports/settings), links user to org SERVER-SIDE (never accepts organization_id from frontend), hashes password (bcrypt $2b$12$), rejects duplicate company code (400) and duplicate admin email (400), returns safe `{company, admin}` (no hash).
- Frontend AddCompany (`PlatformApp.jsx`): two-section form (Company / First Administrator), code auto-fills from name & stays editable, client validation toasts, masked password field, premium light **success screen** (company/industry/admin name+email + Open Company / Back to Companies).
- New admin logs in via generic login → auto-routed to correct industry dashboard (fleet → Route39 fleet dashboard; fabric → Nayara). Org isolation intact (new tenants see 0 orders/vehicles); company admins blocked from `/platform/*`.
- Multi-tenant branding fix: AppShell + Dashboard/Fleet/Drivers/Rentals + Nayara pages now use `user.org_name` instead of hardcoded "Route39"/"Nayara Studio", so each onboarded company sees its own name.
- Deep-link fix: `App.js` Shell gates on `auth.loading` before rendering the catch-all redirect, so `/platform/*` URLs survive hard refresh.
- Verified: testing agent iteration_4 — backend 14/14 pytest pass, frontend onboarding E2E 100%. All QA test data cleaned from Mongo.

## Backlog / Next (P1/P2)
- P1: Company Profile — list/show the company's users (currently no view of the created admin from profile page).
- P1: Route39 — Handover-vs-Return visual diff; photo upload UI; service reminders scheduler.
- P1: Nayara — shadcn date picker + data-testids in New Order dialog; title-case order selects; industry-aware Settings roles.
- P2: server-side Pydantic model for /platform/companies (EmailStr + min password len); atomic org+user rollback; explicit CORS_ORIGINS; responsive Add Company grid on mobile.
- P2: split server.py into routers; dashboard aggregation; unique indexes for codes; attachments to object storage; silence pre-auth 401 noise.
- P2 (pre-existing Route39): rentals pending_payment KPI/filter parity; /api/vehicles pagination.
