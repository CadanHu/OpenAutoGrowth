/**
 * OpenAutoGrowth — Main Entry Point
 *
 * Responsibilities:
 *   1. Boot the multi-agent system (Memory, EventBus, Orchestrator, Agents)
 *   2. Expose system references on window.OAG for page modules
 *   3. Register routes and start the AppShell + Router
 *
 * UI controllers now live in src/ui/pages/*.js (see docs/frontend/).
 */

// ── Core support layer ────────────────────────────────────────────
import { Memory, ToolRegistry }  from './src/core/Memory.js';
import { globalEventBus }        from './src/core/EventBus.js';
import { RuleEngine }            from './src/core/RuleEngine.js';

// ── Intelligence layer ────────────────────────────────────────────
import { Orchestrator }          from './src/agents/Orchestrator.js';
import { Planner }               from './src/agents/Planner.js';

// ── Execution agents ──────────────────────────────────────────────
import { ContentGenAgent }       from './src/agents/ContentGen.js';
import { MultimodalAgent }       from './src/agents/Multimodal.js';
import { StrategyAgent }         from './src/agents/Strategy.js';
import { ChannelExecAgent }      from './src/agents/ChannelExec.js';

// ── Feedback agents ───────────────────────────────────────────────
import { AnalysisAgent }         from './src/agents/Analysis.js';
import { OptimizerAgent }        from './src/agents/Optimizer.js';

// ── API layer ─────────────────────────────────────────────────────
import { CampaignAPI }           from './src/api/routes.js';
import { wsBroadcaster }         from './src/api/websocket.js';

// ── i18n ──────────────────────────────────────────────────────────
import { i18n }                  from './src/i18n/index.js';

// ── UI shell + router ─────────────────────────────────────────────
import './src/ui/components.css';
import { router }    from './src/ui/router.js';
import { AppShell }  from './src/ui/shell.js';

// ══════════════════════════════════════════════════════════════════
// SYSTEM BOOTSTRAP
// ══════════════════════════════════════════════════════════════════

const memory       = new Memory();
const toolRegistry = new ToolRegistry();
const ruleEngine   = new RuleEngine();

const planner      = new Planner();
const orchestrator = new Orchestrator({ planner, memory, ruleEngine });

orchestrator.registerAgent('Strategy',    new StrategyAgent());
orchestrator.registerAgent('ContentGen',  new ContentGenAgent());
orchestrator.registerAgent('Multimodal',  new MultimodalAgent());
orchestrator.registerAgent('ChannelExec', new ChannelExecAgent());
orchestrator.registerAgent('Analysis',    new AnalysisAgent());
orchestrator.registerAgent('Optimizer',   new OptimizerAgent());

const api = new CampaignAPI({ orchestrator, memory });

// Expose refs for page modules (they read from window.OAG, avoiding
// circular imports between bootstrap and leaf pages).
window.OAG = {
  api,
  orchestrator,
  memory,
  ruleEngine,
  eventBus: globalEventBus,
  wsBroadcaster,
  i18n,
};

console.log('[System] OpenAutoGrowth initialized — 8 agents online.');

// ══════════════════════════════════════════════════════════════════
// ROUTER + SHELL
// ══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  const outlet = document.getElementById('app-outlet');
  if (!outlet) {
    console.error('[main] #app-outlet missing in index.html');
    return;
  }

  router.setOutlet(outlet);

  router
    .register('/',                     () => import('./src/ui/pages/hub.js'))
    .register('/campaigns',             () => import('./src/ui/pages/campaigns.js'))
    .register('/agents/:id',            () => import('./src/ui/pages/agent-placeholder.js'))
    .setFallback('/');

  const shell = new AppShell();
  shell.mount();

  router.start();
  i18n.updateUI();
});
