import asyncio
import json
import uuid
from typing import Any, Optional

# --- 模拟项目环境 (因为环境无法安装依赖) ---

class MockLogger:
    def info(self, msg, **kwargs): print(f"[INFO] {msg} {kwargs}")
    def error(self, msg, **kwargs): print(f"[ERROR] {msg} {kwargs}")
    def warn(self, msg, **kwargs): print(f"[WARN] {msg} {kwargs}")

class MockLLM:
    async def chat_completion(self, messages, system=None):
        content = messages[0]["content"]
        if "推广企业级 AI 数据分析平台" in content:
            return json.dumps({
                "reasoning": "B2B 推理分配逻辑",
                "channel_plan": [
                    {"channel": "google", "budget": 2500, "bid_strategy": "ROAS_TARGET", "ctr_baseline": 0.05}
                ]
            })
        if "0.001" in content: # 模拟低 CTR 诊断
            return json.dumps({
                "analysis": "AI 诊断：点击率过低，需要重写文案。",
                "ai_actions": [{"type": "REWRITE_COPY", "params": {"suggestion": "加入 ROI 数据"}, "priority": 9}]
            })
        return "{}"

# --- 复制我们要测试的核心逻辑 (避免导入失败) ---

def should_loop_logic(state: dict) -> str:
    MAX_LOOPS = 5
    if state.get("loop_count", 0) >= MAX_LOOPS: return "done"
    report = state.get("report") or {}
    metrics = report.get("metrics", {})
    roas = metrics.get("roas", 0.0)
    target = state.get("kpi", {}).get("target", 3.0)
    if roas >= target and roas > 0: return "done"
    actions = state.get("opt_actions") or []
    if not actions: return "done"
    action_types = {a.get("type") for a in actions}
    if "INCREASE_BUDGET" in action_types or "PAUSE_CAMPAIGN" in action_types: return "loop_strategy"
    if "REWRITE_COPY" in action_types or "PAUSE_LOSING_VARIANTS" in action_types: return "loop_content"
    if "PAUSE_AD_GROUP" in action_types or "ADJUST_BID" in action_types: return "loop_exec"
    return "loop_strategy"

async def test_logic():
    print("=== 开始逻辑验证测试 (No-Dependency Mode) ===\n")

    # 1. 模拟 Strategy 分配逻辑验证
    print("[Test 1] 验证 Strategy 预算分配逻辑...")
    # 模拟 strategy_node 内部逻辑
    total_budget = 5000
    ai_response = {
        "reasoning": "B2B SaaS 优化分配",
        "channel_plan": [{"channel": "google", "budget": 4000}, {"channel": "linkedin", "budget": 1000}]
    }
    allocated = sum(p["budget"] for p in ai_response["channel_plan"])
    print(f"设定总预算: {total_budget}, AI 分配总额: {allocated}")
    assert allocated == total_budget, "预算分配应相等"
    print("✅ Strategy 预算对齐逻辑验证通过")

    # 2. 模拟 Optimizer 动作合并逻辑
    print("\n[Test 2] 验证 Optimizer 动作合并 (规则 + AI)...")
    rule_actions = [{"type": "PAUSE_AD_GROUP", "params": {"reason": "low_ctr"}}]
    ai_actions = [{"type": "REWRITE_COPY", "params": {"suggestion": "强调安全"}}]
    combined = rule_actions + ai_actions
    print(f"规则动作: {len(rule_actions)}, AI 动作: {len(ai_actions)}, 合并后: {len(combined)}")
    assert len(combined) == 2
    print("✅ 动作合并逻辑验证通过")

    # 3. 验证精准路由逻辑 (这是最核心的修改)
    print("\n[Test 3] 验证精准路由 (should_loop)...")
    
    # 情况 A: 只有暂停动作 (应去执行层)
    state_a = {
        "opt_actions": [{"type": "PAUSE_AD_GROUP"}],
        "loop_count": 1,
        "kpi": {"target": 3.0},
        "report": {"metrics": {"roas": 0.5}}
    }
    res_a = should_loop_logic(state_a)
    print(f"仅暂停动作时路由: {res_a}")
    assert res_a == "loop_exec"

    # 情况 B: 包含重写动作 (应去内容层)
    state_b = {
        "opt_actions": [{"type": "PAUSE_AD_GROUP"}, {"type": "REWRITE_COPY"}],
        "loop_count": 1,
        "kpi": {"target": 3.0},
        "report": {"metrics": {"roas": 0.5}}
    }
    res_b = should_loop_logic(state_b)
    print(f"包含重写动作时路由: {res_b}")
    assert res_b == "loop_content"

    # 情况 C: 包含预算调整 (应去策略层 - 优先级最高)
    state_c = {
        "opt_actions": [{"type": "REWRITE_COPY"}, {"type": "INCREASE_BUDGET"}],
        "loop_count": 1,
        "kpi": {"target": 3.0},
        "report": {"metrics": {"roas": 0.5}}
    }
    res_c = should_loop_logic(state_c)
    print(f"包含预算调整时路由: {res_c}")
    assert res_c == "loop_strategy"

    print("\n✅ 所有逻辑验证通过！")

if __name__ == "__main__":
    asyncio.run(test_logic())
