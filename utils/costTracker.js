// Tracks tokens / calls / (optional) estimated cost and enforces an hourly budget.
class CostTracker {
    constructor(o = {}) {
        this.maxCallsPerHour = Number(o.maxCallsPerHour) || 0;    // 0 = unlimited
        this.maxTokensPerHour = Number(o.maxTokensPerHour) || 0;
        this.maxCostPerHour = Number(o.maxCostPerHour) || 0;
        this.priceIn = Number(o.priceIn) || 0;                    // USD per 1M input tokens
        this.priceOut = Number(o.priceOut) || 0;                  // USD per 1M output tokens
        this.window = [];
        this.total = { calls: 0, input: 0, output: 0, thinking: 0, cached: 0, cost: 0 };
    }

    record(u = {}) {
        const input = u.input || 0, output = u.output || 0, thinking = u.thinking || 0, cached = u.cached || 0;
        const cost = (input * this.priceIn + (output + thinking) * this.priceOut) / 1e6;
        this.window.push({ t: Date.now(), tokens: input + output + thinking, cost });
        this.total.calls++;
        this.total.input += input;
        this.total.output += output;
        this.total.thinking += thinking;
        this.total.cached += cached;
        this.total.cost += cost;
        return cost;
    }

    _recent(now = Date.now()) {
        const cutoff = now - 3600 * 1000;
        this.window = this.window.filter(c => c.t >= cutoff);
        return this.window;
    }

    overBudget(now = Date.now()) {
        const w = this._recent(now);
        const tokens = w.reduce((s, c) => s + c.tokens, 0);
        const cost = w.reduce((s, c) => s + c.cost, 0);
        if (this.maxCallsPerHour && w.length >= this.maxCallsPerHour)
            return { over: true, reason: `${w.length}/${this.maxCallsPerHour} calls in the last hour` };
        if (this.maxTokensPerHour && tokens >= this.maxTokensPerHour)
            return { over: true, reason: `${tokens}/${this.maxTokensPerHour} tokens in the last hour` };
        if (this.maxCostPerHour && cost >= this.maxCostPerHour)
            return { over: true, reason: `$${cost.toFixed(3)}/$${this.maxCostPerHour} in the last hour` };
        return { over: false, reason: '' };
    }

    summary() {
        const t = this.total;
        const k = n => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
        let s = `${t.calls} calls, ${k(t.input)} in / ${k(t.output)} out` + (t.thinking ? ` / ${k(t.thinking)} thinking` : '') + ' tokens';
        if (t.cached) s += ` (${k(t.cached)} cached)`;
        if (this.priceIn || this.priceOut) s += `, ~$${t.cost.toFixed(4)}`;
        return s;
    }
}

module.exports = CostTracker;
