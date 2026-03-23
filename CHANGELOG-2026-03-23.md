# Release Notes — 2026-03-23

## AUT-101: Update Supago Dashboard URL
**Type:** Task | **Priority:** High | **Component:** Backend, CE, Cookie-Sync | **Assignee:** daisy2582

Migrated all Supago URL references from `https://supago.services777.com` to `https://dashboard.supago.online/` across the entire stack.

**Changes:**
- **autoflow-backend:** `config.py`, `env.example`, `scraper_service.py`, `login_cookie_service.py`, `login_session_cookie.py`
- **autoflow-ce:** `manifest.json`, `content.js`, `popup/popup.js`, `README.md`, `WORKFLOW.md`
- **supago-cookie-sync:** `manifest.json`, `content.js`, `background.js`, `README.md`
- **DB Migration:** `update_cookie_domain_to_supago_online.sql` — updates existing `cookie_domain` values

---

## AUT-102: Auto-Open Mini Supago Window on Extension Start
**Type:** Feature | **Priority:** Medium | **Component:** CE | **Assignee:** daisy2582

Chrome Extension now automatically opens the Supago dashboard in a minimal-size browser window (100x100) when the extension is installed, updated, or the browser starts. If a Supago tab already exists, it resizes the existing window instead of creating a new one.

**Changes:**
- `background.js` — Added `openSupagoMiniWindow()` function, `windows` permission
- `manifest.json` — Added `windows` to permissions

---

## AUT-103: Identity Banner with Username and Website Label
**Type:** Feature | **Priority:** Medium | **Component:** CE | **Assignee:** daisy2582

Injected a fixed colored banner at the top of the Supago page displaying the logged-in username and website name (e.g., `SUPAGO | botauto1 | AUTOEXCHANGE`). Tab title is also updated for easy identification when multiple CE windows are open.

**Changes:**
- `content.js` — Added `injectIdentityBanner()` function with purple/blue gradient banner

---

## AUT-104: Navigate to Withdraw-Request Page for In-Process Only Logins
**Type:** Improvement | **Priority:** High | **Component:** CE | **Assignee:** daisy2582

Previously, the CE only navigated to the `/withdraw-request` page when the pending phase was needed. Logins configured with `handles_pending=false, handles_in_process=true` would never navigate to the withdrawal page, preventing mismatch order processing. Now navigation occurs whenever either pending or in-process phase is active.

**Changes:**
- `content.js` — Changed navigation condition from `if (needsPendingPhase)` to `if (needsPendingPhase || needsInProcessPhase)`

---

## AUT-105: Webhook Queue Infinite Retry Loop Prevention
**Type:** Improvement | **Priority:** Critical | **Component:** Backend | **Assignee:** daisy2582

Webhook queue processing had an infinite retry loop: failed webhooks were re-queued via `rpush`, then immediately popped again by the `while True` loop, causing hundreds of retries per second when login was rate-limited.

**Fix:**
- Added `retry_count` tracking per webhook (max 3 retries before dropping)
- Break out of queue processing loop on first failure — remaining webhooks will fail the same way
- Applied to both success-path and exception-path re-queue logic

**Changes:**
- `app/tasks.py` — Two re-queue blocks updated with retry counting and loop break

---

## AUT-106: Skip Login Attempts When Rate-Limited
**Type:** Improvement | **Priority:** High | **Component:** Backend | **Assignee:** daisy2582

When a login was rate-limited, the pending processor still attempted 3 login tries + 3 browser context resets every 10 seconds, all of which immediately hit the rate limit. Now it checks rate-limit status before entering the retry loop and skips immediately.

**Changes:**
- `app/services/browser_pool.py` — Added `is_rate_limited()` method
- `app/services/pending_processor_pool.py` — Added pre-check before login loop + early break on rate-limit during retries

---

## AUT-107: Post-Login Stabilization Wait
**Type:** Improvement | **Priority:** Medium | **Component:** Backend | **Assignee:** daisy2582

Added a 10-second wait after successful login in both the pending processor and webhook processor. This allows the Supago page to fully settle (React rendering, session cookies, redirects) before the bot attempts any scraping or button clicks.

**Changes:**
- `app/services/pending_processor_pool.py` — `await asyncio.sleep(10)` after login success
- `app/services/webhook_processor_pool.py` — `await asyncio.sleep(10)` after login success
