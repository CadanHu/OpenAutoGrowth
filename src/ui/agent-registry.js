/*
 * Agent Registry — single source of truth for Agent metadata consumed by
 * the Hub page, placeholder pages, navbar dropdown, and future agent pages.
 *
 * See: docs/frontend/05-agent-page-template.md §6
 */

export const AGENTS = {
  orchestrator: {
    id: 'orchestrator',
    name: 'Orchestrator',
    nameKey: 'agent_orchestrator_name',
    description: '总控大脑，管理 Campaign 生命周期与状态流转。',
    descriptionKey: 'agent_orchestrator_desc',
    color: 'var(--agent-orchestrator)',
    icon: 'network',
    layer: 'intelligence',
    nodeId: 'node-orchestrator',
  },
  planner: {
    id: 'planner',
    name: 'Planner',
    nameKey: 'agent_planner_name',
    description: '动态生成任务 DAG，拆解目标为可执行步骤。',
    descriptionKey: 'agent_planner_desc',
    color: 'var(--agent-planner)',
    icon: 'map',
    layer: 'intelligence',
    nodeId: 'node-planner',
  },
  strategy: {
    id: 'strategy',
    name: 'Strategy',
    nameKey: 'agent_strategy_name',
    description: '结合用户画像与渠道特性生成投放策略。',
    descriptionKey: 'agent_strategy_desc',
    color: 'var(--agent-strategy)',
    icon: 'trending-up',
    layer: 'execution',
    nodeId: 'node-strategy',
  },
  'content-gen': {
    id: 'content-gen',
    name: 'ContentGen',
    nameKey: 'agent_contentgen_name',
    description: '文案生成：Hook、Headline、A/B 变体。',
    descriptionKey: 'agent_contentgen_desc',
    color: 'var(--agent-contentgen)',
    icon: 'pen-line',
    layer: 'execution',
    nodeId: 'node-contentgen',
  },
  multimodal: {
    id: 'multimodal',
    name: 'Multimodal',
    nameKey: 'agent_multimodal_name',
    description: '视觉素材生成：图片、短视频、横板海报。',
    descriptionKey: 'agent_multimodal_desc',
    color: 'var(--agent-multimodal)',
    icon: 'image',
    layer: 'execution',
    nodeId: 'node-multimodal',
  },
  'channel-exec': {
    id: 'channel-exec',
    name: 'ChannelExec',
    nameKey: 'agent_channelexec_name',
    description: '多渠道 API 执行：Meta / Google / TikTok / 知乎。',
    descriptionKey: 'agent_channelexec_desc',
    color: 'var(--agent-channelexec)',
    icon: 'radio-tower',
    layer: 'execution',
    nodeId: 'node-channelexec',
  },
  analysis: {
    id: 'analysis',
    name: 'Analysis',
    nameKey: 'agent_analysis_name',
    description: '拉取归因数据，生成绩效报告与异常检测。',
    descriptionKey: 'agent_analysis_desc',
    color: 'var(--agent-analysis)',
    icon: 'bar-chart',
    layer: 'feedback',
    // NB: current DOM id is 'node-analysis' for the Optimizer slot (legacy).
    // Analysis shares that node visually; spec §3.3 tracks the rename TODO.
    nodeId: 'node-analysis',
  },
  optimizer: {
    id: 'optimizer',
    name: 'Optimizer',
    nameKey: 'agent_optimizer_name',
    description: '基于规则与 A/B 结果驱动闭环优化。',
    descriptionKey: 'agent_optimizer_desc',
    color: 'var(--agent-optimizer)',
    icon: 'settings',
    layer: 'feedback',
    nodeId: 'node-optimizer',
  },
};

export const AGENT_ORDER = [
  'orchestrator', 'planner', 'strategy', 'content-gen',
  'multimodal', 'channel-exec', 'analysis', 'optimizer',
];

export const LAYER_LABELS = {
  intelligence: { zh: '智能层', en: 'Intelligence' },
  execution:    { zh: '执行层', en: 'Execution' },
  feedback:     { zh: '反馈层', en: 'Feedback' },
};

export function getAgent(id) {
  return AGENTS[id] || null;
}

export function listAgentsByLayer() {
  const groups = { intelligence: [], execution: [], feedback: [] };
  for (const id of AGENT_ORDER) groups[AGENTS[id].layer].push(AGENTS[id]);
  return groups;
}
