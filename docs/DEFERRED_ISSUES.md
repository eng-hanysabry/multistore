# Deferred issues

| ID | Issue | Status | Evidence kept (not counted as success) | Return to |
|---|---|---|---|---|
| DI-1 | GitHub Scheduled Retry (automatic outbox retry about every 5 minutes) | **Pending / Deferred**. NOT verified, NOT completed. | Secrets API_BASE_URL and CRON_SECRET set 26 Nov 2026. One manual run succeeded (status 200, {"sent":0,"passes":1}): https://github.com/eng-hanysabry/multistore/actions/runs/45807200065. Zero `schedule` runs observed in about 2 hours after setup (checked 3:09 PM Cairo). Cause unknown. | Recheck about 6 PM Cairo 26 Nov, then before IP-9. Alternatives (external cron) need the user's explicit approval; none added. |

Decision source: user message relayed by main, Telegram 21297475, 26 Nov 2026.
