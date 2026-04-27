# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.js >> Campaigns: empty state when no campaigns exist
- Location: tests-e2e/smoke.spec.js:580:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.dag-empty')
Expected substring: "No campaigns yet"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for locator('.dag-empty')

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - navigation "Main navigation" [ref=e3]:
    - generic [ref=e4]:
      - link "OpenAutoGrowth Home" [ref=e5] [cursor=pointer]:
        - /url: "#/"
        - img [ref=e7]
        - generic [ref=e11]: OpenAutoGrowth
      - navigation "Primary" [ref=e12]:
        - link "Hub" [ref=e13] [cursor=pointer]:
          - /url: "#/"
        - button "Agents" [ref=e15] [cursor=pointer]:
          - text: Agents
          - img [ref=e16]
        - link "Campaigns" [ref=e18] [cursor=pointer]:
          - /url: "#/campaigns"
      - generic [ref=e19]:
        - tablist [ref=e20]:
          - tab "ZH" [ref=e21] [cursor=pointer]
          - tab "EN" [selected] [ref=e22] [cursor=pointer]
        - generic [ref=e23]: NO CAMPAIGN
        - generic "8 Agents Online" [ref=e24]:
          - generic [ref=e26]: 8 Agents Online
  - main [ref=e27]:
    - navigation "Breadcrumb" [ref=e28]:
      - link "Hub" [ref=e29] [cursor=pointer]:
        - /url: "#/"
      - img [ref=e30]
      - generic [ref=e32]: Campaigns
    - generic [ref=e33]:
      - heading "Campaigns" [active] [level=1] [ref=e34]
      - paragraph [ref=e35]: "Each row expands into the per-agent data flow: what each agent received, executed, and where the result was sent."
    - generic [ref=e36]:
      - generic [ref=e37]: ID
      - generic [ref=e38]: Goal
      - generic [ref=e39]: Status
      - generic [ref=e40]: Budget
      - generic [ref=e41]: KPI
      - generic [ref=e42]: Loops
      - generic [ref=e43]: Last activity
    - generic [ref=e44]:
      - article [ref=e45]:
        - generic [ref=e46]:
          - button [ref=e47] [cursor=pointer]:
            - img [ref=e48]
          - link "3e7c6675-077c-48a4-8d0c-2c07ce6db565" [ref=e50] [cursor=pointer]:
            - /url: "#/campaigns/3e7c6675-077c-48a4-8d0c-2c07ce6db565"
          - 'generic "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch eco water bottle in US. URL: https://amazon.com/dp/B0CTEST1. Region: US." [ref=e51]': "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch eco water…"
          - generic [ref=e52]: PLANNING
          - generic [ref=e53]: —
          - generic [ref=e54]: —
          - generic [ref=e55]: "0"
          - generic [ref=e56]: —
      - article [ref=e57]:
        - generic [ref=e58]:
          - button [ref=e59] [cursor=pointer]:
            - img [ref=e60]
          - link "3c6d5723-e271-499b-b831-8384a3bab838" [ref=e62] [cursor=pointer]:
            - /url: "#/campaigns/3c6d5723-e271-499b-b831-8384a3bab838"
          - 'generic "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS bridge test. URL: https://amazon.com/dp/B0WSBRIDGE. Region: US." [ref=e63]': "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS br…"
          - generic [ref=e64]: PLANNING
          - generic [ref=e65]: —
          - generic [ref=e66]: —
          - generic [ref=e67]: "0"
          - generic [ref=e68]: —
      - article [ref=e69]:
        - generic [ref=e70]:
          - button [ref=e71] [cursor=pointer]:
            - img [ref=e72]
          - link "567e7c7c-e841-4e75-a83a-73b6f5c8fa93" [ref=e74] [cursor=pointer]:
            - /url: "#/campaigns/567e7c7c-e841-4e75-a83a-73b6f5c8fa93"
          - generic "新品冷启动 launch test bridge" [ref=e75]
          - generic [ref=e76]: PLANNING
          - generic [ref=e77]: —
          - generic [ref=e78]: —
          - generic [ref=e79]: "0"
          - generic [ref=e80]: —
      - article [ref=e81]:
        - generic [ref=e82]:
          - button [ref=e83] [cursor=pointer]:
            - img [ref=e84]
          - link "bf299e85-9a82-4a95-aa35-7ac87e0142ac" [ref=e86] [cursor=pointer]:
            - /url: "#/campaigns/bf299e85-9a82-4a95-aa35-7ac87e0142ac"
          - 'generic "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS bridge test. URL: https://amazon.com/dp/B0WSBRIDGE. Region: US." [ref=e87]': "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS br…"
          - generic [ref=e88]: PLANNING
          - generic [ref=e89]: —
          - generic [ref=e90]: —
          - generic [ref=e91]: "0"
          - generic [ref=e92]: —
      - article [ref=e93]:
        - generic [ref=e94]:
          - button [ref=e95] [cursor=pointer]:
            - img [ref=e96]
          - link "f4b5f8b1-fac4-43f8-81e2-db8c20033a70" [ref=e98] [cursor=pointer]:
            - /url: "#/campaigns/f4b5f8b1-fac4-43f8-81e2-db8c20033a70"
          - 'generic "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS bridge test. URL: https://amazon.com/dp/B0WSBRIDGE. Region: US." [ref=e99]': "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS br…"
          - generic [ref=e100]: PLANNING
          - generic [ref=e101]: —
          - generic [ref=e102]: —
          - generic [ref=e103]: "0"
          - generic [ref=e104]: —
      - article [ref=e105]:
        - generic [ref=e106]:
          - button [ref=e107] [cursor=pointer]:
            - img [ref=e108]
          - link "cb0f3991-e841-4e13-92eb-2ce4c0e32378" [ref=e110] [cursor=pointer]:
            - /url: "#/campaigns/cb0f3991-e841-4e13-92eb-2ce4c0e32378"
          - generic "新品 launch fix verify" [ref=e111]
          - generic [ref=e112]: PLANNING
          - generic [ref=e113]: —
          - generic [ref=e114]: —
          - generic [ref=e115]: "0"
          - generic [ref=e116]: —
      - article [ref=e117]:
        - generic [ref=e118]:
          - button [ref=e119] [cursor=pointer]:
            - img [ref=e120]
          - link "c3b61306-7b47-49ce-8b14-8b1dd21a1578" [ref=e122] [cursor=pointer]:
            - /url: "#/campaigns/c3b61306-7b47-49ce-8b14-8b1dd21a1578"
          - 'generic "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS bridge test. URL: https://amazon.com/dp/B0WSBRIDGE. Region: US." [ref=e123]': "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS br…"
          - generic [ref=e124]: PLANNING
          - generic [ref=e125]: —
          - generic [ref=e126]: —
          - generic [ref=e127]: "0"
          - generic [ref=e128]: —
      - article [ref=e129]:
        - generic [ref=e130]:
          - button [ref=e131] [cursor=pointer]:
            - img [ref=e132]
          - link "8b1ab09e-ec9f-41b5-84c0-b9dad42d5f92" [ref=e134] [cursor=pointer]:
            - /url: "#/campaigns/8b1ab09e-ec9f-41b5-84c0-b9dad42d5f92"
          - generic "新品 launch fix verify v2" [ref=e135]
          - generic [ref=e136]: PLANNING
          - generic [ref=e137]: —
          - generic [ref=e138]: —
          - generic [ref=e139]: "0"
          - generic [ref=e140]: —
      - article [ref=e141]:
        - generic [ref=e142]:
          - button [ref=e143] [cursor=pointer]:
            - img [ref=e144]
          - link "d2058c41-9672-4c05-b9a6-1ad4b617af46" [ref=e146] [cursor=pointer]:
            - /url: "#/campaigns/d2058c41-9672-4c05-b9a6-1ad4b617af46"
          - generic "新品 verify pubsub" [ref=e147]
          - generic [ref=e148]: PLANNING
          - generic [ref=e149]: —
          - generic [ref=e150]: —
          - generic [ref=e151]: "0"
          - generic [ref=e152]: —
      - article [ref=e153]:
        - generic [ref=e154]:
          - button [ref=e155] [cursor=pointer]:
            - img [ref=e156]
          - link "ccf89d7c-37ab-4bdd-bc27-d1394acf1d11" [ref=e158] [cursor=pointer]:
            - /url: "#/campaigns/ccf89d7c-37ab-4bdd-bc27-d1394acf1d11"
          - generic "新品 launch fallback verify" [ref=e159]
          - generic [ref=e160]: PLANNING
          - generic [ref=e161]: —
          - generic [ref=e162]: —
          - generic [ref=e163]: "0"
          - generic [ref=e164]: —
      - article [ref=e165]:
        - generic [ref=e166]:
          - button [ref=e167] [cursor=pointer]:
            - img [ref=e168]
          - link "fec750d3-6a72-4af6-befc-8b79beaaebbd" [ref=e170] [cursor=pointer]:
            - /url: "#/campaigns/fec750d3-6a72-4af6-befc-8b79beaaebbd"
          - 'generic "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS bridge test. URL: https://amazon.com/dp/B0WSBRIDGE. Region: US." [ref=e171]': "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS br…"
          - generic [ref=e172]: PLANNING
          - generic [ref=e173]: —
          - generic [ref=e174]: —
          - generic [ref=e175]: "0"
          - generic [ref=e176]: —
      - article [ref=e177]:
        - generic [ref=e178]:
          - button [ref=e179] [cursor=pointer]:
            - img [ref=e180]
          - link "1c1c89bb-c7bf-4d98-be35-ea64aa91a556" [ref=e182] [cursor=pointer]:
            - /url: "#/campaigns/1c1c89bb-c7bf-4d98-be35-ea64aa91a556"
          - 'generic "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS bridge test. URL: https://amazon.com/dp/B0WSBRIDGE. Region: US." [ref=e183]': "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS br…"
          - generic [ref=e184]: PLANNING
          - generic [ref=e185]: —
          - generic [ref=e186]: —
          - generic [ref=e187]: "0"
          - generic [ref=e188]: —
      - article [ref=e189]:
        - generic [ref=e190]:
          - button [ref=e191] [cursor=pointer]:
            - img [ref=e192]
          - link "2d7c3f8f-3af4-442d-9a3f-0045428e58f5" [ref=e194] [cursor=pointer]:
            - /url: "#/campaigns/2d7c3f8f-3af4-442d-9a3f-0045428e58f5"
          - 'generic "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS bridge test. URL: https://amazon.com/dp/B0WSBRIDGE. Region: US." [ref=e195]': "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS br…"
          - generic [ref=e196]: PLANNING
          - generic [ref=e197]: —
          - generic [ref=e198]: —
          - generic [ref=e199]: "0"
          - generic [ref=e200]: —
      - article [ref=e201]:
        - generic [ref=e202]:
          - button [ref=e203] [cursor=pointer]:
            - img [ref=e204]
          - link "2b990248-ef15-41be-9f83-ab7a4a9f8bbf" [ref=e206] [cursor=pointer]:
            - /url: "#/campaigns/2b990248-ef15-41be-9f83-ab7a4a9f8bbf"
          - 'generic "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS bridge test. URL: https://amazon.com/dp/B0WSBRIDGE. Region: US." [ref=e207]': "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS br…"
          - generic [ref=e208]: PLANNING
          - generic [ref=e209]: —
          - generic [ref=e210]: —
          - generic [ref=e211]: "0"
          - generic [ref=e212]: —
      - article [ref=e213]:
        - generic [ref=e214]:
          - button [ref=e215] [cursor=pointer]:
            - img [ref=e216]
          - link "3ebb2027-c1a7-4b00-9eac-bac0c73a4a6e" [ref=e218] [cursor=pointer]:
            - /url: "#/campaigns/3ebb2027-c1a7-4b00-9eac-bac0c73a4a6e"
          - 'generic "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS bridge test. URL: https://amazon.com/dp/B0WSBRIDGE. Region: US." [ref=e219]': "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS br…"
          - generic [ref=e220]: PLANNING
          - generic [ref=e221]: —
          - generic [ref=e222]: —
          - generic [ref=e223]: "0"
          - generic [ref=e224]: —
      - article [ref=e225]:
        - generic [ref=e226]:
          - button [ref=e227] [cursor=pointer]:
            - img [ref=e228]
          - link "9780d4f8-f7ca-4e52-9d24-9c3dee7d3080" [ref=e230] [cursor=pointer]:
            - /url: "#/campaigns/9780d4f8-f7ca-4e52-9d24-9c3dee7d3080"
          - 'generic "[Type: ECOM] Objective: conversion. Desc: 推广面向开发者的 SaaS 效率工具，可免费注册试用。重点强调多端同步与插件生态。. URL: https://github.com/example/saas-tool. Region: US." [ref=e231]': "[Type: ECOM] Objective: conversion. Desc: 推广面向开发者的 SaaS 效率工具…"
          - generic [ref=e232]: PLANNING
          - generic [ref=e233]: —
          - generic [ref=e234]: —
          - generic [ref=e235]: "0"
          - generic [ref=e236]: —
      - article [ref=e237]:
        - generic [ref=e238]:
          - button [ref=e239] [cursor=pointer]:
            - img [ref=e240]
          - link "c4e1fee6-1311-433e-9f3f-4bf832e06ddd" [ref=e242] [cursor=pointer]:
            - /url: "#/campaigns/c4e1fee6-1311-433e-9f3f-4bf832e06ddd"
          - 'generic "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS bridge test. URL: https://amazon.com/dp/B0WSBRIDGE. Region: US." [ref=e243]': "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS br…"
          - generic [ref=e244]: PLANNING
          - generic [ref=e245]: —
          - generic [ref=e246]: —
          - generic [ref=e247]: "0"
          - generic [ref=e248]: —
      - article [ref=e249]:
        - generic [ref=e250]:
          - button [ref=e251] [cursor=pointer]:
            - img [ref=e252]
          - link "72c46f1c-6cda-4a9c-9c45-c2abe1282aa1" [ref=e254] [cursor=pointer]:
            - /url: "#/campaigns/72c46f1c-6cda-4a9c-9c45-c2abe1282aa1"
          - 'generic "[Type: ECOM] Objective: conversion. Desc: 推广新款智能手表，主打长续航与健康监测。受众为年轻白领。强调首发优惠 20%。. URL: https://example.com/product/smart-watch. Region: US." [ref=e255]': "[Type: ECOM] Objective: conversion. Desc: 推广新款智能手表，主打长续航与健康监…"
          - generic [ref=e256]: PLANNING
          - generic [ref=e257]: —
          - generic [ref=e258]: —
          - generic [ref=e259]: "0"
          - generic [ref=e260]: —
      - article [ref=e261]:
        - generic [ref=e262]:
          - button [ref=e263] [cursor=pointer]:
            - img [ref=e264]
          - link "e5cbb3f5-99f6-4893-9582-63f07a8efc02" [ref=e266] [cursor=pointer]:
            - /url: "#/campaigns/e5cbb3f5-99f6-4893-9582-63f07a8efc02"
          - 'generic "[Type: ECOM] Objective: conversion. Desc: 推广新款智能手表，主打长续航与健康监测。受众为年轻白领。强调首发优惠 20%。. URL: https://example.com/product/smart-watch. Region: US." [ref=e267]': "[Type: ECOM] Objective: conversion. Desc: 推广新款智能手表，主打长续航与健康监…"
          - generic [ref=e268]: PLANNING
          - generic [ref=e269]: —
          - generic [ref=e270]: —
          - generic [ref=e271]: "0"
          - generic [ref=e272]: —
      - article [ref=e273]:
        - generic [ref=e274]:
          - button [ref=e275] [cursor=pointer]:
            - img [ref=e276]
          - link "20836f29-b0f8-4a92-bb99-73bf0e640914" [ref=e278] [cursor=pointer]:
            - /url: "#/campaigns/20836f29-b0f8-4a92-bb99-73bf0e640914"
          - 'generic "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS bridge test. URL: https://amazon.com/dp/B0WSBRIDGE. Region: US." [ref=e279]': "[Type: ECOM] Objective: growth. Desc: 新品冷启动 launch via WS br…"
          - generic [ref=e280]: PLANNING
          - generic [ref=e281]: —
          - generic [ref=e282]: —
          - generic [ref=e283]: "0"
          - generic [ref=e284]: —
  - contentinfo [ref=e285]:
    - generic [ref=e286]: © 2026 OpenAutoGrowth · Multi-Agent Closed-Loop Growth Engine
```

# Test source

```ts
  484 |   // If the backend ARQ worker is broken (separate pre-existing concern),
  485 |   // no event will ever arrive — skip rather than time out for 30s.
  486 |   let arrived = false;
  487 |   try {
  488 |     await page.waitForFunction(() =>
  489 |       (window.OAG?.eventBus?.history || []).some(e => e.event_type === 'PlanGenerated'),
  490 |       null,
  491 |       { timeout: 30000 },
  492 |     );
  493 |     arrived = true;
  494 |   } catch {}
  495 |   if (!arrived) {
  496 |     const dump = await page.evaluate(() => ({
  497 |       historyTypes: (window.OAG?.eventBus?.history || []).map(e => e.event_type),
  498 |       wsConns: window.OAG?.wsBroadcaster?._connections?.size ?? 'n/a',
  499 |     }));
  500 |     console.log('[debug] no PlanGenerated within 30s:', JSON.stringify(dump));
  501 |   }
  502 |   test.skip(!arrived, 'backend pipeline did not publish PlanGenerated within 30s — likely an unrelated backend job failure (check `arq:result:*` in Redis db=1)');
  503 | 
  504 |   // Now visit Planner — DAG should render the backend-driven plan
  505 |   await page.goto('/#/agents/planner');
  506 |   await expect(page.locator('.dag-node').first()).toBeVisible({ timeout: 5000 });
  507 | 
  508 |   const nodeCount = await page.locator('.dag-node').count();
  509 |   expect(nodeCount).toBeGreaterThanOrEqual(3);  // backend LLM may emit fewer tasks
  510 | 
  511 |   // Scenario chip should be non-empty. Backend path uses an LLM-driven free-form
  512 |   // scenario string (e.g. "Growth-driven e-commerce launch ..."), unlike the
  513 |   // in-browser planner which uses fixed constants — both are acceptable here.
  514 |   const chipText = (await page.locator('.scenario-chip').first().innerText()).trim();
  515 |   expect(chipText.length).toBeGreaterThan(2);
  516 | });
  517 | 
  518 | // ──────────────────────────────────────────────────────────────────
  519 | // 9. Orchestrator page: empty state, populated overview, FSM highlighting
  520 | // ──────────────────────────────────────────────────────────────────
  521 | test('Orchestrator: empty state when no campaigns exist', async ({ page }) => {
  522 |   await resetLocale(page, 'en');
  523 |   await page.goto('/#/agents/orchestrator');
  524 | 
  525 |   // Should show empty state message
  526 |   await expect(page.locator('.dag-empty')).toContainText('No campaigns yet');
  527 | 
  528 |   // FSM view should also be empty
  529 |   await page.click('button[data-tab="fsm"]');
  530 |   await expect(page.locator('.dag-empty')).toContainText('No campaigns yet');
  531 | });
  532 | 
  533 | test('Orchestrator: seeded campaign renders FSM and Logs', async ({ page }) => {
  534 |   await resetLocale(page, 'en');
  535 |   await page.goto('/');
  536 |   await page.waitForFunction(() => !!window.OAG?.orchestrator);
  537 | 
  538 |   // Seed a campaign in Orchestrator
  539 |   await page.evaluate(() => {
  540 |     const cid = 'test-camp-orch';
  541 |     window.OAG.orchestrator.campaigns.set(cid, {
  542 |       campaign_id: cid,
  543 |       name: 'Smoke Test Campaign',
  544 |       status: 'PLANNING',
  545 |       loop_count: 0
  546 |     });
  547 |     window.OAG.eventBus.publish('PlanGenerated', {
  548 |       campaign_id: cid,
  549 |       plan: { tasks: [] }
  550 |     }, cid);
  551 |   });
  552 | 
  553 |   await page.goto('/#/agents/orchestrator');
  554 | 
  555 |   // Overview table should render 1 row
  556 |   await expect(page.locator('.attr-table tbody tr')).toHaveCount(1);
  557 |   await expect(page.locator('.attr-table')).toContainText('test-camp-orch');
  558 |   // At this point status is PENDING_REVIEW due to EventBus trigger in Orchestrator._onPlanGenerated
  559 |   await expect(page.locator('.attr-table')).toContainText('PENDING_REVIEW');
  560 | 
  561 |   // FSM View
  562 |   await page.click('button[data-tab="fsm"]');
  563 |   // Sidebar should have the campaign
  564 |   await expect(page.locator('.fsm-sidebar-item')).toHaveCount(1);
  565 |   await expect(page.locator('.fsm-sidebar-item')).toHaveClass(/active/);
  566 |   // Canvas should show nodes
  567 |   await expect(page.locator('.fsm-node')).toHaveCount(9);
  568 |   // PENDING_REVIEW node should be active
  569 |   const activeNode = page.locator('.fsm-node.active .fsm-node-box');
  570 |   await expect(activeNode).toContainText('PENDING_REVIEW');
  571 | 
  572 |   // Logs View
  573 |   await page.click('button[data-tab="logs"]');
  574 |   await expect(page.locator('.log-line')).not.toHaveCount(0);
  575 | });
  576 | 
  577 | // ──────────────────────────────────────────────────────────────────
  578 | // 10. Campaigns page & Detail page
  579 | // ──────────────────────────────────────────────────────────────────
  580 | test('Campaigns: empty state when no campaigns exist', async ({ page }) => {
  581 |   await resetLocale(page, 'en');
  582 |   await page.goto('/#/campaigns');
  583 | 
> 584 |   await expect(page.locator('.dag-empty')).toContainText('No campaigns yet');
      |                                            ^ Error: expect(locator).toContainText(expected) failed
  585 | });
  586 | 
  587 | test('Campaigns: seeded campaign shows in list and navigates to detail', async ({ page }) => {
  588 |   await resetLocale(page, 'en');
  589 |   await page.goto('/');
  590 |   await page.waitForFunction(() => !!window.OAG?.orchestrator);
  591 | 
  592 |   // Seed a campaign
  593 |   await page.evaluate(() => {
  594 |     const cid = 'test-camp-list';
  595 |     window.OAG.orchestrator.campaigns.set(cid, {
  596 |       campaign_id: cid,
  597 |       name: 'List Test Campaign',
  598 |       status: 'PLANNING',
  599 |       loop_count: 2,
  600 |       budget: { currency: 'USD', total: 1000 },
  601 |       kpi: { metric: 'ROAS', target: '2.5' },
  602 |       active_tasks: ['task-1', 'task-2']
  603 |     });
  604 |   });
  605 | 
  606 |   await page.goto('/#/campaigns');
  607 | 
  608 |   // Should render 1 row in the table
  609 |   const row = page.locator('.attr-table tbody tr');
  610 |   await expect(row).toHaveCount(1);
  611 |   await expect(row).toContainText('test-camp-list');
  612 |   await expect(row).toContainText('List Test Campaign');
  613 |   await expect(row).toContainText('USD 1000');
  614 |   await expect(row).toContainText('ROAS 2.5');
  615 | 
  616 |   // Click on the campaign ID to navigate to details
  617 |   await row.locator('a').click();
  618 |   await expect(page).toHaveURL(/#\/campaigns\/test-camp-list/);
  619 | 
  620 |   // Detail page assertions
  621 |   await expect(page.locator('h1')).toContainText('List Test Campaign');
  622 |   // Check metric boxes
  623 |   await expect(page.locator('.metric-value').nth(0)).toContainText('PLANNING');
  624 |   await expect(page.locator('.metric-value').nth(1)).toContainText('USD 1000');
  625 |   await expect(page.locator('.metric-value').nth(2)).toContainText('ROAS 2.5');
  626 |   
  627 |   // Check tasks list
  628 |   await expect(page.locator('.fsm-node')).toHaveCount(2);
  629 |   await expect(page.locator('.fsm-node').nth(0)).toContainText('task-1');
  630 | });
  631 | 
```