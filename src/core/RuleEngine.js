/**
 * RuleEngine — 规则引擎
 * 处理确定性的 Optimizer 决策 & Review Gate 审批
 * OpenAutoGrowth Core
 */
export class RuleEngine {
    constructor() {
        // 内置规则集（匹配 docs/architecture/05-rule-engine.md）
        this.rules = this._loadDefaultRules();
        this.cooldownTracker = new Map(); // Map<"campaignId:ruleId", lastFiredTimestamp>
    }

    /**
     * 执行规则引擎，返回 OptAction[]
     * @param {object} context - { metrics, campaign, ab_test, anomalies, kpi }
     * @param {string} campaignId
     * @returns {Array} actions
     */
    evaluate(context, campaignId) {
        const sortedRules = [...this.rules].sort((a, b) => a.priority - b.priority);
        const actions = [];

        for (const rule of sortedRules) {
            if (!rule.enabled) continue;
            if (this._isOnCooldown(campaignId, rule.id, rule.cooldown_ms)) continue;

            if (this._evaluateCondition(rule.condition, context)) {
                console.log(`[RuleEngine] ✅ Rule fired: ${rule.name}`);
                actions.push({ rule_id: rule.id, ...rule.action });
                this._recordFire(campaignId, rule.id);
            }
        }

        // 去重：同类型 action 只保留优先级最高的
        return this._deduplicateActions(actions);
    }

    /**
     * 递归评估 Condition 表达式
     */
    _evaluateCondition(condition, context) {
        if ('field' in condition) {
            return this._evaluatePredicate(condition, context);
        }

        const results = condition.children.map(c => this._evaluateCondition(c, context));
        switch (condition.operator) {
            case 'AND': return results.every(Boolean);
            case 'OR':  return results.some(Boolean);
            case 'NOT': return !results[0];
            default:    return false;
        }
    }

    _evaluatePredicate({ field, op, value }, context) {
        const actual = this._getFieldValue(field, context);
        if (actual === undefined || actual === null) return false;

        switch (op) {
            case '>':    return actual > value;
            case '<':    return actual < value;
            case '>=':   return actual >= value;
            case '<=':   return actual <= value;
            case '==':   return actual === value;
            case 'IN':   return Array.isArray(value) && value.includes(actual);
            case 'NOT_IN': return Array.isArray(value) && !value.includes(actual);
            default:     return false;
        }
    }

    _getFieldValue(fieldPath, context) {
        return fieldPath.split('.').reduce((obj, key) => obj?.[key], context);
    }

    _isOnCooldown(campaignId, ruleId, cooldownMs) {
        const key = `${campaignId}:${ruleId}`;
        const lastFired = this.cooldownTracker.get(key);
        return lastFired && (Date.now() - lastFired) < cooldownMs;
    }

    _recordFire(campaignId, ruleId) {
        this.cooldownTracker.set(`${campaignId}:${ruleId}`, Date.now());
    }

    _deduplicateActions(actions) {
        const seen = new Set();
        return actions.filter(a => {
            const key = a.type + (a.params?.target || '');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    _loadDefaultRules() {
        return [
            {
                id: 'R005', name: '异常告警 - 人工介入',
                priority: 0, enabled: true, cooldown_ms: 3600000,
                condition: {
                    operator: 'OR', children: [
                        { field: 'anomalies.cpm_surge_pct',  op: '>=', value: 0.5 },
                        { field: 'anomalies.ctr_drop_pct',   op: '>=', value: 0.4 },
                    ]
                },
                action: { type: 'ALERT_HUMAN', params: { pause_campaign: true } }
            },
            {
                id: 'R001', name: 'A/B 裁决 - 置信度达标',
                priority: 1, enabled: true, cooldown_ms: 86400000,
                condition: {
                    operator: 'AND', children: [
                        { field: 'ab_test.winner_confidence',    op: '>=', value: 0.95 },
                        { field: 'ab_test.min_sample_size_met', op: '==', value: true },
                    ]
                },
                action: { type: 'PAUSE_VARIANT', params: { target: 'loser_variant_id' } }
            },
            {
                id: 'R002', name: 'CTR 严重低于基准',
                priority: 2, enabled: true, cooldown_ms: 43200000,
                condition: {
                    operator: 'AND', children: [
                        { field: 'metrics.ctr_below_baseline_70pct', op: '==', value: true },
                        { field: 'metrics.impressions',              op: '>=', value: 1000 },
                    ]
                },
                action: { type: 'TRIGGER_REWRITE', params: { agent: 'ContentGen', urgency: 'HIGH' } }
            },
            {
                id: 'R003', name: 'ROAS 不达标 - 预算收缩',
                priority: 3, enabled: true, cooldown_ms: 21600000,
                condition: {
                    operator: 'AND', children: [
                        { field: 'metrics.roas',         op: '<',  value: 2.0 },
                        { field: 'campaign.loop_count',  op: '<',  value: 5 },
                    ]
                },
                action: { type: 'REALLOCATE_BUDGET', params: { shrink_pct: 0.3, reallocate_to: 'best_channel' } }
            },
            {
                id: 'R004', name: 'ROI 超额 - 提速扩量',
                priority: 4, enabled: true, cooldown_ms: 43200000,
                condition: { field: 'metrics.roas_exceeds_target_120pct', op: '==', value: true },
                action: { type: 'SCALE_BUDGET', params: { scale_pct: 0.2 } }
            },
        ];
    }
}
