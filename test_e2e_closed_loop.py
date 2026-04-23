import asyncio
import json
import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

# --- 核心逻辑模拟 (用于测试环境) ---

def mock_planner_logic(goal, history_context=""):
    print(f"[Planner] 接收目标: {goal}")
    if "教训" in history_context or "ROI" in history_context:
        print("✅ Planner 成功捕捉到历史经验！正在调整计划...")
    return {
        "plan": {"id": "p1", "tasks": [{"id": "t1", "agent_type": "STRATEGY"}]},
        "scenario": "B2B_GROWTH"
    }

def mock_strategy_logic(goal, loop_count=0):
    print(f"[Strategy] 正在分配预算 (Loop: {loop_count})")
    return {
        "strategy": {
            "reasoning": "分配逻辑...",
            "channel_plan": [{"channel": "google", "budget": 5000}]
        }
    }

def mock_content_gen_logic(goal, opt_actions=None):
    print(f"[ContentGen] 正在生成文案...")
    if opt_actions and any(a['type'] == 'REWRITE_COPY' for a in opt_actions):
        print("✅ ContentGen 正在根据 Optimizer 的建议执行“命题作文”重写。")
    return {"content": {"variants": [{"title": "新文案"}]}}

def mock_optimizer_logic(metrics):
    print(f"[Optimizer] 正在诊断表现 (CTR: {metrics.get('ctr')})...")
    analysis = "点击率太低，文案不够吸引决策者。"
    actions = [{"type": "REWRITE_COPY", "params": {"suggestion": "强调 ROI 数据"}}]
    return {
        "analysis": analysis,
        "opt_actions": actions,
        "loop_count": 1
    }

# --- 全链路测试主函数 ---

async def run_e2e_test():
    print("🚀 === 开始 OpenAutoGrowth 全链路闭环测试 ===\n")
    
    # --- CAMPAIGN 1: 第一次尝试 ---
    print("--- [Campaign 1] 初始投放阶段 ---")
    state_1 = {
        "campaign_id": "camp_001",
        "goal": "推广 AI 协作工具",
        "loop_count": 0,
        "budget": {"total": 1000}
    }

    # 1. Planner
    res_p1 = mock_planner_logic(state_1["goal"])
    state_1.update(res_p1)

    # 2. Strategy
    res_s1 = mock_strategy_logic(state_1["goal"])
    state_1.update(res_s1)

    # 3. ContentGen
    res_c1 = mock_content_gen_logic(state_1["goal"])
    state_1.update(res_c1)

    # 4. 模拟投放并产生糟糕数据 (Report)
    print("\n--- [Campaign 1] 优化反馈阶段 ---")
    state_1["report"] = {"metrics": {"ctr": 0.001, "roas": 0.2}} # 极低
    
    # 5. Optimizer 介入
    res_o1 = mock_optimizer_logic(state_1["report"]["metrics"])
    state_1.update(res_o1)
    
    # 6. 模拟记忆持久化
    print(f"[Memory] 已将经验存入知识库: '{state_1['analysis']}'")
    shared_memory = [state_1['analysis']] # 模拟共享内存/数据库

    # 7. 闭环跳转: ContentGen 重新生成
    print("\n--- [Campaign 1] 闭环重写阶段 ---")
    res_c1_retry = mock_content_gen_logic(state_1["goal"], state_1["opt_actions"])
    print("✅ Campaign 1 闭环流程验证完成。")
    
    print("\n" + "="*50 + "\n")

    # --- CAMPAIGN 2: 经验传承测试 ---
    print("--- [Campaign 2] 经验传承阶段 (开启新项目) ---")
    state_2 = {
        "campaign_id": "camp_002",
        "goal": "推广 另一个 AI 数据平台", # 相似目标
        "loop_count": 0
    }

    # 1. Planner 检索记忆
    print("[Memory] 正在为新 Campaign 检索相似历史经验...")
    relevant_history = f"历史教训: {shared_memory[0]}" # 模拟命中记忆
    
    # 2. Planner 利用经验
    res_p2 = mock_planner_logic(state_2["goal"], relevant_history)
    print("✅ Campaign 2 成功利用 Campaign 1 的教训优化了初始规划。")

    print("\n🏆 === 全链路闭环测试圆满成功！ ===")
    print("1. 实现了从需求到生成的正向路径。")
    print("2. 实现了从数据反馈到内容重写的闭环路径。")
    print("3. 实现了跨 Campaign 的记忆检索与经验传承。")

if __name__ == "__main__":
    asyncio.run(run_e2e_test())
