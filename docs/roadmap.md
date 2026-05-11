# OpenAutoGrowth — Roadmap

Snapshot of where the system is and what's deliberately deferred. Written
during the Phase 3 wrap-up (governance + HITL + SLA escalation complete).

The list is split by "ready to build" engineering work versus "decide what
this product should be" product-shape questions. They have very different
inputs.

---

## What's already shipped

| Phase | Scope | Status |
|---|---|---|
| Hub canvas fixes | Stop infinite animation on COMPLETED; only highlight current agent; parallel content_gen + multimodal both lit; review-rejected rebound; optimizer loop badge (L#N). | ✅ |
| Phase 0 — HITL | `governance_rules` / `revision_cases` / `revision_tasks`; `human_gate` LangGraph node; first rule `finance_high_budget`; case lifecycle (OPEN → RESOLVED/CANCELLED); resume via LangGraph checkpointer. | ✅ |
| Phase 1A — RBAC + audit | JWT (8h access + 14d refresh), bcrypt; `user_governance_roles` (multi-role); SQLAlchemy `before_flush` audit listener; `/v1/identity/{login, refresh, me, users, users/:id/grant}`. | ✅ |
| Phase 1B — Tenant + audit UI | `tenant_id` ContextVar middleware; auto-scoped queries on `governance / campaigns / audit`; ADMIN cross-tenant via `?tenant_id=`; WS auth + cross-tenant guard; Audit Log tab. | ✅ |
| B6 — User/tenant admin UI | `/users` page (ADMIN-only): tenant CRUD, user create, grant/revoke gov roles. | ✅ |
| Phase 2 — Notifications | `core/notify` dispatcher; SMTP / Slack / DingTalk adapters; Jinja2 templates (`approval_required`, `approval_resolved`, `approval_escalated`); per-user webhook prefs; `notifications` delivery log. | ✅ |
| Phase 3 — SLA escalation | `default_decision` column; `revision_tasks.escalation_level / escalated_at`; ARQ cron `scan_overdue_tasks` (every 5 min); chain `FINANCE/LEGAL/BRAND → MARKETING_DIRECTOR → ADMIN`; auto-decide on exhausted chain; resume campaign on case close. | ✅ |
| Sample rules | `finance_high_budget`, `legal_cross_border`, `brand_first_creative`, `director_loop_escalation` — wired to 4 distinct gate stages. | ✅ |
| Originating UX | Original "animation stuck" and "highlight only running agent" issues — root cause was end-of-pipeline event replay, now removed. | ✅ |

---

## Engineering work, ready to do (when triggered)

### #8 Real platform deployment (v0.0.3)

- **Effort**: 2-5 days per channel.
- **Real work**: replace `mock-cdn.oag.ai` URLs with real object storage (S3/OSS/COS); per-platform adapter (Meta Marketing API / TikTok Ads API / Google Ads API) with token refresh + retry + rate-limit handling; sandbox vs production mode toggle; verify the existing `R005` budget-exhausted optimizer rule actually pauses real spend.
- **Blockers**: ad-account approval (Meta/TikTok 7-30 days), ICP filing for CN, KYC.
- **Risk**: real money. Always sandbox-first; budget caps mandatory.
- **Order I'd pick**: Google Ads (instant test accounts) → Meta → TikTok → CN channels (WeChat / RED).
- **Trigger**: first paying customer ready to actually spend.

### #7 SSO / OIDC

- **Effort**: 1-2 days OIDC, +1-2 days SAML.
- **Real work**: `/v1/identity/oidc/login?provider=okta` → redirect to IdP → callback exchange → upsert local user by email → mint existing JWT. Multi-tenant: per-org IdP config table. Optional: SCIM for user sync.
- **Key decision**: keep a break-glass local admin (don't rely 100% on IdP). Avoid full SSO-only mode.
- **Risk**: low — worst case is login broken, no data effect.
- **Trigger**: first RFP that asks "do you support SSO" — usually procurement gate.

### Smaller engineering follow-ups

| Item | Source | Note |
|---|---|---|
| Per-rule escalation chain override | Phase 3 design | Currently global `ESCALATION_CHAIN` map. Add `governance_rules.escalation_chain text[]` to override. |
| AUTO_DEFAULTED dashboard surface | Phase 3 | Auto-defaulted tasks blend into the inbox; ops needs a "needs human triage" filter. |
| Notification retry queue + dead-letter | Phase 2 | Currently fire-and-forget. Move sends to ARQ jobs with retry/backoff. |
| WS reconnect hydration | Removed end-of-run replay | Client should pull DomainEvent history on reconnect, not rely on server-side replay. |
| Login-no-refresh UX | Phase 1A patch | Currently uses `location.reload()` after first login. Cleaner: subscribe `auth:login` and re-fetch per page. |
| Tour step 3 offscreen | Patched with clamp | Real fix needs placement-aware repositioning for full-screen modals. |
| "8 Agents Online" miscount | Pre-existing | `AGENT_ORDER` has 7. |

---

## Product-shape questions (don't engineer until decided)

These are not coding tasks. They're "what is this product?" decisions.

| Item | Nature | If we did it |
|---|---|---|
| **Cross-platform attribution / MMM** | Engineering-solvable, real differentiator | Build incremental-lift experiments or MMM. This is the **most defensible moat** among the B-tier items. |
| **CRM / LTV** | Integration, not build | `crm` adapter (Salesforce / HubSpot / 红圈); ChannelExec writes leads back; Analysis pulls LTV to recompute CAC budget. |
| **Inventory / supply chain** | Integration | Webhook into customer's ERP (SAP / 用友 / Shopify); SKU stock check before scaling spend; trigger `PAUSE_CAMPAIGN` on stockout. |
| **Service / retention / NPS** | Separate product | Don't build. Let customer use Intercom / Zendesk / 神策. |
| **Brand / PR / brand equity** | Not amenable to automation | Use the existing BRAND_LEAD workflow; don't add AI decisioning here. |
| **Market intel / competitor** | Add as an agent | New `MarketIntelAgent` node before Planner; uses Perplexity / scraping + LLM to summarize trends into `state.metadata.market_context`. Cheap win, real value. |
| **Channel compliance (ICP / GDPR / brand safety)** | Engineering + legal | Extend LEGAL gate predicates: industry-list match, region-list match, prohibited-claim regex. Most of the framework is already there. |

---

## Recommended sequencing

**Short term (0-3 months)** — graduate from demo to first onboardable client
- Connect ONE real channel (Google Ads is easiest). Without this the system can never bill anyone.
- Find a customer willing to spend even a few thousand RMB / USD on a real campaign.
- Observe which governance gates fire often, which are over-engineered.

**Medium term (3-6 months)** — sharpen the moat
- Add SSO (#7) when procurement asks.
- Build the Market Intel agent (small, high-leverage).
- Start a Cross-Platform Attribution v0 (incremental lift) — this is the differentiation.

**Long term (6 months+)** — driven by customer pull
- CRM / inventory integrations.
- Additional channels (Meta, TikTok, then CN platforms).
- Per-rule escalation override; retry/DLQ for notifications.

---

## The non-engineering thing that matters most

The thing that should drive the next 90 days is **not** any of the above —
it's **finding the first real customer**. Pick the smallest possible
engagement (one channel, one budget, one campaign), connect just enough of
#8 to make it work, and let real usage reveal which of the items above
matter. Building any more of this without customer signal will produce
correct-looking work that may turn out not to be what they need.
