const fs = require('fs');

const agentFiles = [
    { file: 'agent-planner.js', event: 'AGENT_EVENT', def: 'const events = planEvents();' },
    { file: 'agent-strategy.js', event: 'AGENT_EVENT', def: 'const events = (getCtx().eventBus?.history || []).filter(e => e.event_type === AGENT_EVENT);' },
    { file: 'agent-content-gen.js', event: 'AGENT_EVENT', def: 'const events = (getCtx().eventBus?.history || []).filter(e => e.event_type === AGENT_EVENT);' },
    { file: 'agent-multimodal.js', event: 'AGENT_EVENT', def: 'const events = (getCtx().eventBus?.history || []).filter(e => e.event_type === AGENT_EVENT);' },
    { file: 'agent-channel-exec.js', event: 'AGENT_EVENT', def: 'const events = (getCtx().eventBus?.history || []).filter(e => e.event_type === AGENT_EVENT);' },
    { file: 'agent-analysis.js', event: "['ReportGenerated', 'AnomalyDetected']", def: 'const events = analysisEvents();' },
    { file: 'agent-optimizer.js', event: 'AGENT_EVENT', def: 'const events = (getCtx().eventBus?.history || []).filter(e => e.event_type === AGENT_EVENT);' },
    { file: 'agent-orchestrator.js', event: "'*'", def: 'const events = getCtx().eventBus?.history || [];' },
];

for (const agent of agentFiles) {
    const path = \`/Users/huyitao/OpenAutoGrowth/src/ui/pages/\${agent.file}\`;
    let content = fs.readFileSync(path, 'utf-8');
    
    // Find the renderLogs function block
    const funcRegex = /function renderLogs\(panel\) \{([\s\S]*?)(?:return \(\) => .*?;\s*\n\}|return \(\) => .*?\}?\n\})/m;
    const match = content.match(funcRegex);
    if (!match) {
        console.log("Could not find renderLogs in " + agent.file);
        continue;
    }
    
    // Extract the HTML string inside paint()
    const htmlRegex = /panel\.innerHTML = \`([\s\S]*?)\`;/m;
    const htmlMatch = match[1].match(htmlRegex);
    if (!htmlMatch) {
        console.log("Could not find panel.innerHTML in " + agent.file);
        continue;
    }
    
    let originalHtml = htmlMatch[1];
    
    // The conditional mapping part looks like ${events.length ? events... : `<p...`}
    const mappingRegex = /\$\{events\.length[\s\S]*?\?(.*?):[\s\S]*?<\/p>`\}/m;
    const mapMatch = originalHtml.match(mappingRegex);
    
    let mappingLogic = "events.slice().reverse().map(e => `<div class=\"log-line\">...</div>`).join('')";
    if (mapMatch) {
        mappingLogic = mapMatch[1].trim();
    }
    
    // Create the loading template
    let loadingHtml = originalHtml.replace(mappingRegex, "<div id=\"logs-container\"><p class=\"muted\">Loading historical logs...</p></div>");
    
    // If it was agent-orchestrator, it didn't have events.length conditional in the same way, or maybe it did.
    // Ensure we have a container.
    if (!loadingHtml.includes("logs-container")) {
        loadingHtml = loadingHtml.replace(/<div class="logs-view[^"]*">/, '<div class="logs-view" id="logs-container">');
    }
    
    const eventsArg = agent.event === "'*'" ? "[]" : (agent.event.startsWith("[") ? agent.event : `[${agent.event}]`);
    
    let newFunc = `function renderLogs(panel) {
  let mounted = true;
  async function paint() {
    if (!mounted) return;
    const ctx = getCtx();
    ${agent.def.replace('const events', 'let events')}
    
    panel.innerHTML = \`${loadingHtml}\`;
    
    try {
        if (ctx.api?.getSystemEvents) {
            const remoteEvents = await ctx.api.getSystemEvents(${eventsArg});
            if (!mounted) return;
            const eventsById = new Map();
            [...remoteEvents, ...events].forEach(e => eventsById.set(e.id || String(e.occurred_at), e));
            events = Array.from(eventsById.values()).sort((a,b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
        }
    } catch(e) {}
    
    const container = panel.querySelector('#logs-container') || panel.querySelector('.logs-view');
    if (container) {
        container.innerHTML = events.length 
            ? ${mappingLogic}
            : \`<p class="muted">\${t('no_recent_event', 'No recent event')}</p>\`;
    }
  }
  paint();
  const ctx = getCtx();
  if (!ctx.eventBus) return;
`;
    
    if (agent.file === 'agent-orchestrator.js') {
        newFunc += "  const unsub = ctx.eventBus.subscribe('*', paint);\n";
        newFunc += "  return () => { mounted = false; try { unsub(); } catch {} };\n}";
    } else if (agent.file === 'agent-analysis.js') {
        newFunc += "  const unsub1 = ctx.eventBus.subscribe('ReportGenerated', paint);\n";
        newFunc += "  const unsub2 = ctx.eventBus.subscribe('AnomalyDetected', paint);\n";
        newFunc += "  return () => { mounted = false; try { unsub1(); unsub2(); } catch {} };\n}";
    } else {
        newFunc += `  const unsub = ctx.eventBus.subscribe(${agent.event}, paint);\n`;
        newFunc += "  return () => { mounted = false; try { unsub(); } catch {} };\n}";
    }
    
    const newContent = content.replace(funcRegex, newFunc);
    fs.writeFileSync(path, newContent, 'utf-8');
    console.log("Updated " + agent.file);
}
