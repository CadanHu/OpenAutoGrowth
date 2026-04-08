/**
 * Orchestrator Agent (The Manager)
 * Responsible for high-level goal interpretation and agent coordination.
 */
export class Orchestrator {
    constructor(planner, memory) {
        this.planner = planner;
        this.memory = memory;
        this.agents = {};
    }

    registerAgent(name, agent) {
        this.agents[name] = agent;
    }

    async processGoal(goal) {
        console.log(`[Orchestrator] Interpreting goal: ${goal}`);
        this.memory.save('goal', goal);

        // 1. Plan the tasks
        const plan = await this.planner.createPlan(goal);
        console.log(`[Orchestrator] Plan generated with ${plan.tasks.length} tasks.`);

        // 2. Execute plan dynamically
        return await this.executePlan(plan);
    }

    async executePlan(plan) {
        const results = [];
        for (const task of plan.tasks) {
            const agent = this.agents[task.agentType];
            if (agent) {
                console.log(`[Orchestrator] Dispatching task "${task.id}" to ${task.agentType}`);
                const result = await agent.run(task.params);
                results.push({ task: task.id, result });
                this.memory.save(`result_${task.id}`, result);
            }
        }
        return results;
    }
}
