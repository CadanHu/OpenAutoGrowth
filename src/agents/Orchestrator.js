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
        const results = {};
        const pendingTasks = [...plan.tasks];
        
        while (pendingTasks.length > 0) {
            // Find tasks whose dependencies are met
            const readyTasks = pendingTasks.filter(task => 
                !task.dependencies || task.dependencies.every(depId => !!results[depId])
            );

            if (readyTasks.length === 0) {
                console.error('[Orchestrator] Circular dependency detected or no tasks ready.');
                break;
            }

            // Execute ready tasks in parallel
            const executing = readyTasks.map(async (task) => {
                const agent = this.agents[task.agentType];
                if (agent) {
                    console.log(`[Orchestrator] Dispatching task "${task.id}" to ${task.agentType}`);
                    const result = await agent.run({ ...task.params, context: results });
                    results[task.id] = result;
                    this.memory.save(`result_${task.id}`, result);
                }
                // Remove from pending
                const index = pendingTasks.indexOf(task);
                if (index > -1) pendingTasks.splice(index, 1);
            });

            await Promise.all(executing);
        }
        return results;
    }
}
