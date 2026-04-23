import asyncio
import json
import uuid
from unittest.mock import AsyncMock, patch

# 导入被测节点和函数
from backend.app.agents.strategy import strategy_node
from backend.app.agents.optimizer import optimizer_node, should_loop
from backend.app.agents.state import CampaignState

# --- Mock 数据定义 ---

# 模拟 Strategy Agent 的 AI 回复
MOCK_STRATEGY_AI_RESPONSE = json.dumps({
    "reasoning": "对于 B2B SaaS 线索获取，Google 搜索广告具有最高意图，分配 50% 预算；LinkedIn 适合精准定向决策者，分配 30%；Meta 用于再营销和品牌曝光，分配 20%。",
    "channel_plan": [
        {"channel": "google", "budget": 2500, "bid_strategy": "ROAS_TARGET", "ctr_baseline": 0.05, "priority": "HIGH"},
        {"channel": "linkedin", "budget": 1500, "bid_strategy": "COST_CAP", "ctr_baseline": 0.015, "priority": "MEDIUM"},
        {"channel": "meta", "budget": 1000, "bid_strategy": "LOWEST_COST", "ctr_baseline": 0.03, "priority": "LOW"}
    ]
})

# 模拟 Optimizer Agent 的 AI 回复 (针对低 CTR)
MOCK_OPTIMIZER_AI_RESPONSE = json.dumps({
    "analysis": "当前点击率 (0.1%) 远低于基准，说明广告文案未能有效吸引 B2B 决策者，或者价值主张不够清晰。",
    "ai_actions": [
        {
            "type": "REWRITE_COPY",
            "params": {
                "reason": "CTR 过低 (0.1%)",
                "suggestion": "建议在文案中加入具体的 ROI 数据或客户案例。将卖点从‘功能丰富’转向‘效率提升 40%’。增加‘免费演示’作为强召唤词。"
            },
            "priority": 9
        }
    ]
})

async def run_test():
    print("=== 开始测试: OpenAutoGrowth AI 代理逻辑 (Mock LLM) ===\n")

    # 使用 patch 模拟 LLM 客户端
    with patch("backend.app.core.llm.llm_client.chat_completion", new_callable=AsyncMock) as mock_llm:
        
        # --- 阶段 1: 模拟初始策略生成 ---
        mock_llm.return_value = MOCK_STRATEGY_AI_RESPONSE
        
        print("[Step 1] 模拟初始 Campaign 提交...")
        initial_state: CampaignState = {
            "campaign_id": f"test_{uuid.uuid4().hex[:6]}",
            "goal": "推广企业级 AI 数据分析平台，获取 B2B 高质量线索。",
            "budget": {"total": 5000, "currency": "USD"},
            "kpi": {"metric": "cpa", "target": 50.0},
            "constraints": {"channels": ["google", "meta", "linkedin"]},
            "loop_count": 0,
            "completed_tasks": [],
            "status": "PLANNING",
            "errors": []
        }

        print("运行 Strategy Agent...")
        strategy_result = await strategy_node(initial_state)
        
        print(f"策略生成成功！")
        print(f"AI 推理理由: {strategy_result['strategy'].get('reasoning', 'N/A')}")
        print("渠道分配计划:")
        for p in strategy_result['strategy']['channel_plan']:
            print(f" - {p['channel']}: ${p['budget']} (优先级: {p.get('priority', 'N/A')})")
        print("-" * 40)

        # --- 阶段 2: 模拟低 CTR 表现 ---
        mock_llm.return_value = MOCK_OPTIMIZER_AI_RESPONSE
        
        print("\n[Step 2] 模拟投放一周后，注入低 CTR (0.1%) 数据...")
        updated_state = {**initial_state, **strategy_result}
        updated_state["report"] = {
            "metrics": {
                "impressions": 50000,
                "clicks": 50,
                "ctr": 0.001,
                "spend": 1000,
                "conversions": 0,
                "cpa": 1000.0,
                "roas": 0.0
            }
        }
        updated_state["loop_count"] = 1

        print("运行 Optimizer Agent...")
        optimizer_result = await optimizer_node(updated_state)
        
        actions = optimizer_result["opt_actions"]
        print(f"AI 诊断结果: {optimizer_result.get('analysis', 'N/A')}")
        print(f"优化器决策完成，共生成 {len(actions)} 个动作。")
        
        for a in actions:
            print(f" - 动作类型: {a['type']}")
            if "params" in a:
                print(f"   AI 建议: {a['params'].get('suggestion', 'N/A')}")

        # --- 阶段 3: 验证路由判定 ---
        print("\n[Step 3] 验证 LangGraph 路由判定...")
        final_state = {**updated_state, **optimizer_result}
        next_step = should_loop(final_state)
        
        print(f"最终判定跳转路径: {next_step}")
        
        if next_step == "loop_content":
            print("✅ 测试通过: 成功判定为需要重写文案 (loop_content)，符合低 CTR 的优化逻辑。")
        else:
            print(f"❌ 测试结论偏离预期: {next_step}")

if __name__ == "__main__":
    asyncio.run(run_test())
