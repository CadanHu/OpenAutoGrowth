import './style.css'
import { Orchestrator } from './src/agents/Orchestrator.js'
import { Planner } from './src/agents/Planner.js'
import { Optimizer } from './src/agents/Optimizer.js'
import { Memory } from './src/core/Systems.js'

// Initialize Support Layer
const memory = new Memory();

// Initialize Intelligence Layer
const planner = new Planner();
const orchestrator = new Orchestrator(planner, memory);

// Register Agents (Mock implementations for UI)
orchestrator.registerAgent('ContentGen', {
    run: async (params) => {
        updateStatus('gen-count', 'Generating...');
        await new Promise(r => setTimeout(r, 2000));
        updateStatus('gen-count', '1,312');
        return { content: 'Perfect growth copy' };
    }
});

orchestrator.registerAgent('Strategy', {
    run: async (params) => {
        console.log('Strategy agent running...');
        return { strategy: 'Focus on Gen Z' };
    }
});

orchestrator.registerAgent('Execution', {
    run: async (params) => {
        updateStatus('exec-reach', 'Syncing...');
        await new Promise(r => setTimeout(r, 1500));
        updateStatus('exec-reach', '87.4%');
        const feed = document.getElementById('exec-feed');
        const item = document.createElement('div');
        item.className = 'feed-item';
        item.textContent = `✓ Auto-posted to ${params.channel}`;
        feed.prepend(item);
        return { status: 'success' };
    }
});

orchestrator.registerAgent('Analysis', {
    run: async (params) => {
        console.log('Analysis agent pulling data...');
        return { ctr: 0.042 };
    }
});

orchestrator.registerAgent('Optimizer', new Optimizer());

// UI Helpers
function updateStatus(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// Global scope for button clicks
window.startProcess = async () => {
    const btn = document.querySelector('.hero .btn.primary') || { textContent: '' };
    const originalText = btn.textContent;
    btn.textContent = 'Synergy in Progress...';
    
    await orchestrator.processGoal('Increase SaaS engagement');
    
    btn.textContent = originalText;
    alert('Closed-loop cycle complete! Strategies have been optimized.');
};

// Add event listener to the main hero button
document.addEventListener('DOMContentLoaded', () => {
    const mainBtn = document.querySelector('.hero .btn.primary');
    if (mainBtn) {
        mainBtn.addEventListener('click', window.startProcess);
    }
});

console.log('OpenAutoGrowth System Initialized');
