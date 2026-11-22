const fs = require('fs');
const path = require('path');

const GOAL_TYPES = ['strike', 'bm_depot', 'conquer', 'resupply', 'border_crossing', 'deploy_infantry'];
const RUNTIME_TYPES = new Set(['csar', 'enemy-csar']);   // created at runtime: never overridden nor locked

const emptyPlan = () => ({ version: 1, goals: {}, orders: [] });
const asArray = v => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const toNum = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

/**
 * Design-time plan layered on top of the goals exported by the mission zones:
 *  - overrides for zone goals (priority, peacetime, type, props, disabled)
 *  - custom goals created outside the .miz (custom: true, side, lat, lon...)
 *  - dependencies (requires: [goalId...])
 *  - orders: stored as-is, consumed in a later step
 * Progress (completed goals) is runtime state, mirrored by the persistence file.
 */
class MissionPlan {
    constructor() { this.reset(); }

    reset() {
        this.data = emptyPlan();
        this.file = null;
        this.completed = new Set();
        this._noted = new Set();
    }

    /** @returns {{loaded:boolean, warnings:string[], errors:string[]}} */
    load(filePath) {
        const result = { loaded: false, warnings: [], errors: [] };
        if (!filePath || !fs.existsSync(filePath)) return result;
        let raw;
        try {
            raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            result.errors.push(`Plan file is not valid JSON: ${e.message}`);
            return result;
        }
        this.data = this.normalize(raw, result.warnings);
        this.file = filePath;
        this.validate().forEach(w => result.warnings.push(w));
        result.loaded = true;
        return result;
    }

    save(filePath = this.file) {
        if (!filePath) return false;
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(this.data, null, 2));
        this.file = filePath;
        return true;
    }

    normalize(raw, warnings = []) {
        const plan = emptyPlan();
        if (!raw || typeof raw !== 'object') return plan;
        plan.version = raw.version || 1;

        for (const [id, g] of Object.entries(raw.goals || {})) {
            if (!g || typeof g !== 'object') continue;
            const out = { requires: asArray(g.requires) };
            if (g.priority !== undefined) out.priority = toNum(g.priority, 1);
            if (g.peacetime !== undefined) out.peacetime = g.peacetime === true || g.peacetime === 'true';
            if (g.disabled) out.disabled = true;
            if (g.type) out.type = String(g.type);
            if (g.props && typeof g.props === 'object') out.props = { ...g.props };

            if (g.custom) {
                const side = String(g.side || '').toLowerCase();
                const lat = toNum(g.lat, NaN), lon = toNum(g.lon, NaN);
                if ((side !== 'red' && side !== 'blue') || !Number.isFinite(lat) || !Number.isFinite(lon) || !g.type) {
                    warnings.push(`Custom goal "${id}" ignored: it needs side (red/blue), type, lat and lon.`);
                    continue;
                }
                if (!GOAL_TYPES.includes(out.type)) warnings.push(`Custom goal "${id}" has an unknown type "${out.type}".`);
                Object.assign(out, { custom: true, side, lat, lon, radius: toNum(g.radius, 3000) });
                if (out.priority === undefined) out.priority = 1;
            }
            plan.goals[id] = out;
        }
        plan.orders = Array.isArray(raw.orders) ? raw.orders : [];
        return plan;
    }

    /** Data-only checks (cycles). Zone goal ids can't be checked here: they only exist once DCS connects. */
    validate() {
        const warnings = [];
        const goals = this.data.goals;
        const state = {};       // 1 = visiting, 2 = done
        const stack = [];
        const visit = id => {
            if (state[id] === 2) return;
            if (state[id] === 1) {
                warnings.push(`Dependency cycle (those goals will stay locked): ${[...stack.slice(stack.indexOf(id)), id].join(' -> ')}`);
                return;
            }
            state[id] = 1; stack.push(id);
            for (const r of (goals[id] && goals[id].requires) || []) visit(r);
            stack.pop(); state[id] = 2;
        };
        Object.keys(goals).forEach(visit);
        return warnings;
    }

    // ---- progress -------------------------------------------------------

    setCompleted(list) { this.completed = new Set(list || []); }
    isCompleted(id) { return this.completed.has(id); }
    /** @returns {boolean} true if it was not completed before */
    markCompleted(id) {
        if (!id || this.completed.has(id)) return false;
        this.completed.add(id);
        return true;
    }

    /** Drops goals already achieved in a previous session (Lua re-exports every zone on each connect). */
    filterCompleted(items) {
        return (items || []).filter(i => !this.completed.has(i.id));
    }

    // ---- merge layer ----------------------------------------------------

    /** Idempotent: safe to call after every updateGoals() and once per cycle. */
    applyTo(targets, log = () => {}) {
        if (!targets || !Array.isArray(targets.targets)) return;   // GOALS not received yet
        const side = targets.coalition;
        const goals = this.data.goals;

        // 1. Overrides on the goals exported by the mission zones
        for (const t of [...targets.targets]) {
            if (RUNTIME_TYPES.has(t.type)) continue;
            const o = goals[t.name];
            if (!o || o.custom) continue;
            if (o.disabled) { targets.removeTarget(t.name); continue; }
            if (o.priority !== undefined) t.priority = o.priority;
            if (o.peacetime !== undefined) t.peacetime = o.peacetime;
            if (o.type) t.type = o.type;
            if (o.props) t.props = { ...t.props, ...o.props };
        }

        // 2. Custom goals of this coalition
        for (const [id, o] of Object.entries(goals)) {
            if (!o.custom || o.disabled || o.side !== side || this.completed.has(id)) continue;
            const props = { ...(o.props || {}), radius: o.radius, custom: true };
            const existing = targets.targets.find(t => t.name === id);
            if (existing) {
                Object.assign(existing, { priority: o.priority, type: o.type, peacetime: !!o.peacetime, props });
            } else {
                targets.addTarget(id, o.priority, o.type, o.lat, o.lon, null, !!o.peacetime, props);
            }
        }

        // 3. Dependencies
        this.refreshLocks(targets);

        const known = new Set([...Object.keys(goals), ...this.completed, ...targets.targets.map(t => t.name)]);
        for (const t of targets.targets) {
            if (t.locked) this._note(`lock:${t.name}`, `Goal ${t.name} is locked until ${t.blockedBy.join(', ')} is completed.`, log);
            (t.requires || []).filter(r => !known.has(r)).forEach(r =>
                this._note(`unk:${t.name}:${r}`, `Goal ${t.name} requires "${r}", which is not in the plan nor in this coalition's goals (typo or other coalition?). It stays locked.`, log));
        }
    }

    refreshLocks(targets) {
        if (!targets || !Array.isArray(targets.targets)) return;
        for (const t of targets.targets) {
            const g = this.data.goals[t.name];
            const req = (g && !RUNTIME_TYPES.has(t.type)) ? g.requires : [];
            t.requires = req;
            t.blockedBy = req.filter(r => !this.completed.has(r));
            t.locked = t.blockedBy.length > 0;
        }
    }

    _note(key, msg, log) {
        if (this._noted.has(key)) return;
        this._noted.add(key);
        log(msg);
    }
}

module.exports = MissionPlan;
module.exports.GOAL_TYPES = GOAL_TYPES;