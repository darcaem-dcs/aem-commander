const AiHelper = require('./aiHelper.js');
const CostTracker = require('./costTracker.js');
const RuleCommander = require('./ruleCommander.js');
const { CommanderGate, computeSignatures } = require('./commanderGate.js');
const { buildBrief, strategicInventoryText } = require('./briefBuilder.js');
const { validateActions } = require('./orderValidator.js');
const { getSystemInstructions } = require('./commanderPrompt.js');
const logger = require('./log.js');

const DEFAULTS = {
    mode: 'hybrid',            // hybrid = AI + rule fallback | ai = AI only | rules = no AI at all
    provider: 'gemini',        // gemini | openai (any OpenAI-compatible endpoint)
    thinking: 'low',
    temperature: 0.1,
    maxTokens: 4096,
    heartbeatCycles: 6,        // force a review after this many quiet cycles
    cooldownCycles: 2,         // ignore own-force changes right after issuing orders
    maxGoals: 4,
    threatRadiusKm: 60,
    maxNewPerCycle: 2,
    fallbackMinutes: 10
};

class CommanderEngine {
    constructor(options = {}, deps = {}) {
        this.opts = { ...DEFAULTS, ...options };
        this.opts.models = { fast: options.modelFast || options.model || '', strong: options.modelStrong || '' };
        this.ui = deps.ui || (() => {});
        this.ai = deps.ai || new AiHelper();
        this.provider = deps.provider || null;
        this.gate = new CommanderGate({ heartbeatCycles: this.opts.heartbeatCycles, cooldownCycles: this.opts.cooldownCycles });
        this.cost = new CostTracker(this.opts);
        this.mem = {};
        this.rules = {};
        this.sysCache = {};
        this.failures = 0;
        this.fallbackUntil = 0;
        this.skippedCalls = 0;
    }

    _mem(side) {
        return this.mem[side] || (this.mem[side] = { cycle: 0, lastLog: '', recentOrders: [], feedback: [], rejectRetries: 0 });
    }

    _tier(ctx) {
        if (!this.opts.models.strong) return 'fast';
        const p = ctx.posture || {};
        return (p.level === 'RED_WAR' || (p.recentLosses || 0) >= 60) ? 'strong' : 'fast';
    }

    // ctx: { forces, targets, territory, posture, logs, ballisticCount, ballisticRangeKm, userContext, unitProfiles }
    async decide(side, ctx) {
        const mem = this._mem(side);
        mem.cycle++;
        const sctx = { ...ctx, side, opts: this.opts, memory: mem, maxNew: this.opts.maxNewPerCycle };
        const logsSeen = (ctx.logs || []).length;
        const mode = this.opts.mode;

        if (mode === 'rules') return this._runRules(side, sctx, 'rules mode', logsSeen);

        const sig = computeSignatures(sctx, this.opts);
        const g = this.gate.decide(side, sig, ctx.logs);
        if (!g.call) {
            this.skippedCalls++;
            return { skipped: true, reason: g.reason, savedCalls: this.skippedCalls };
        }

        const budget = this.cost.overBudget();
        const inFallback = Date.now() < this.fallbackUntil;
        if (budget.over || inFallback) {
            const why = budget.over ? `AI budget reached (${budget.reason})` : 'AI temporarily unavailable';
            if (mode === 'hybrid') return this._runRules(side, sctx, why, logsSeen, sig);
            return { skipped: true, reason: why, savedCalls: this.skippedCalls };
        }

        try {
            const res = await this._runAI(side, sctx, g.reason, logsSeen, sig);
            this.failures = 0;
            return res;
        } catch (err) {
            this.failures++;
            logger.error('LLM call failed:', err.message);
            if (mode === 'hybrid' && this.failures >= 3) {
                this.fallbackUntil = Date.now() + this.opts.fallbackMinutes * 60000;
                this.failures = 0;
                this.ui(`Commander of ${side}: AI failed 3 times in a row. Rule-based fallback for ${this.opts.fallbackMinutes} min.`, 'error');
                return this._runRules(side, sctx, 'AI failures', logsSeen, sig);
            }
            return { error: err.message };
        }
    }

    async _runAI(side, sctx, reason, logsSeen, sig) {
        const tier = this._tier(sctx);
        const model = this.opts.models[tier] || this.opts.models.fast;
        if (!model) throw new Error('No AI model configured');
        if (!this.provider) this.provider = this.ai.createProvider(this.opts);

        if (!this.sysCache[side]) this.sysCache[side] = getSystemInstructions(sctx.userContext, sctx.unitProfiles, side);
        const brief = buildBrief(sctx);
        const user = `SITUATION BRIEF (turn ${sctx.memory.cycle}; review reason: ${reason})\n${JSON.stringify(brief)}` +
            (sctx.posture && sctx.posture.prompt ? `\n${sctx.posture.prompt}` : '') +
            `\n${strategicInventoryText(sctx.ballisticCount || 0, sctx.ballisticRangeKm || 290)}\nReturn your orders as JSON.`;

        const { json, usage } = await this.ai.generateOrders(this.provider, {
            model, system: this.sysCache[side], user, thinking: this.opts.thinking,
            maxTokens: this.opts.maxTokens, temperature: this.opts.temperature
        });
        this.cost.record(usage);

        const parsed = json && typeof json === 'object' ? json : { mission_log: 'Commander is assessing the situation.', actions: [] };
        const v = validateActions(parsed.actions || [], this._vctx(sctx));
        return this._finish(side, sctx, sig, logsSeen, {
            source: 'ai', model, tier, usage, reason,
            mission_log: parsed.mission_log || '', actions: v.valid, rejected: v.rejected
        });
    }

    _runRules(side, sctx, reason, logsSeen, sig) {
        if (!this.rules[side]) this.rules[side] = new RuleCommander();
        const plan = this.rules[side].plan(sctx);
        const v = validateActions(plan.actions, this._vctx(sctx));
        return this._finish(side, sctx, sig, logsSeen, {
            source: 'rules', reason, mission_log: plan.mission_log, actions: v.valid, rejected: v.rejected
        });
    }

    _vctx(sctx) {
        return { forces: sctx.forces, targets: sctx.targets, territory: sctx.territory, posture: sctx.posture,
            maxNew: this.opts.maxNewPerCycle, ballisticCount: sctx.ballisticCount, ballisticRangeKm: sctx.ballisticRangeKm,
            reservedGroups: sctx.reservedGroups };
    }

    _finish(side, sctx, sig, logsSeen, res) {
        const mem = sctx.memory;
        mem.lastLog = res.mission_log;
        mem.feedback = res.rejected;
        res.actions.forEach(a => {
            if (a.action_type === 'new') mem.recentOrders.push({ cycle: mem.cycle, task: a.task, type: a.unit_type, n: a.unit_count, target: a.target_name });
        });
        mem.recentOrders = mem.recentOrders.slice(-20);

        const allRejected = res.actions.length === 0 && res.rejected.length > 0;
        const retry = allRejected && mem.rejectRetries < 1;
        mem.rejectRetries = allRejected ? mem.rejectRetries + 1 : 0;
        if (sig) this.gate.markCalled(side, sig, { issued: res.actions.length > 0, retry });
        res.logsConsumed = logsSeen;
        res.costSummary = this.cost.summary();
        return res;
    }

    // Rules mode has no gate: still keep it from being re-run on stale signatures
    reset() {
        this.mem = {}; this.rules = {}; this.sysCache = {};
        this.gate = new CommanderGate({ heartbeatCycles: this.opts.heartbeatCycles, cooldownCycles: this.opts.cooldownCycles });
    }
}

module.exports = CommanderEngine;
