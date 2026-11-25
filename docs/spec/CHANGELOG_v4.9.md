# MultiStore spec v4.9 change log (docs only, on v4.8)

Source: instruction relayed by the main agent on 25 Nov 2026 as the user's Telegram message 16854956 (not independently verified by me) to apply `Spec_patch_note_NULLIF.md` fully plus the IP-4 security note. Baseline: `MultiStore_Final_Technical_Document_v4.8-46206bd5.md`. Result: `MultiStore_Final_Technical_Document_v4.9.md` (43 changed lines).

1. 6.2 policies and 5.6 sentence: `current_setting('app.tenant_id', true)::uuid` becomes `NULLIF(current_setting('app.tenant_id', true), '')::uuid` (5 places).
2. 6.2 personal-table policy and 6.7 Customer data row: `app.user_id` uses the same NULLIF form.
3. 6.2: new paragraph "Empty-string context" with the IP-1 measurement (v4.8 form: 64 of 67 checks; NULLIF form: 67 of 67, Supabase Transaction Pooler).
4. 6.4: missing-context row reworded; new checklist row (reused pooled connection with no context returns zero rows, incl. `/health/ready` canary; migration lint rejects uuid casts without NULLIF).
5. 10.7: canary/empty-context note.
6. 6.6 and IP-4 deliverables: `anon`, `authenticated`, `service_role` must have no privileges on application tables, with a grants-snapshot test.
7. 16.1 and 22.1 and 21.1: G-01 PASSED; Assumptions A and B PASSED (NULLIF form); IP-1 closed.
8. Title, version line and a "What changed from v4.8" block added at the top.

Not changed: all decisions and approvals, other checklist items, the test status register (section 23) totals, the `gen_random_uuid` spike-only note stays only in the spike code (5.6 already forbids DB-side defaults).

3. **Decision register updated (section 17):** D1 to D6 and P-1 to P-4 now show your approved IP-0 decisions (25 Nov 2026, Telegram 16854956): D1 A helmet; D2 A with D2a; D3 A 5 minutes; D4 90 days; D5 A; D6 A; P-1 approved with Phone, WhatsApp, Email; P-2 option B; P-3 approved; P-4 phase by phase. The 17.1 and 17.2 tables, the status vocabulary and the matching checklist row changed. Other sections were not rewritten; section 17 is the current status where they still say recommended or proposed.
