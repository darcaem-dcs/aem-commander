const fs = require('fs');
const path = require('path');

const GOAL_TYPES = ['strike', 'bm_depot', 'conquer', 'resupply', 'border_crossing', 'deploy_infantry'];
const RUNTIME_TYPES = new Set(['csar', 'enemy-csar']);   // created at runtime: never overridden nor locked
const { TASKS } = require('./orderSchema.js');
const TRIGGERS = ['start', 'delay', 'goal_done'];

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
        this.executed = new Set();          // order ids already sent (mirrored in the persistence file)
        this.completedAt = new Map();       // goalId -> timestamp (0 = completed in a previous session)
        this.startedAt = Date.now();        // reference for "delay" triggers
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
        plan.orders = this.normalizeOrders(raw.orders, warnings);
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

    setCompleted(list) {
        this.completed = new Set(list || []);
        this.completedAt = new Map([...this.completed].map(id => [id, 0]));
    }
    
    isCompleted(id) { return this.completed.has(id); }
    
    /** @returns {boolean} true if it was not completed before */
    markCompleted(id) {
        if (!id || this.completed.has(id)) return false;
        this.completed.add(id);
        this.completedAt.set(id, Date.now());
        return true;
    }

    unmarkCompleted(id) { 
        this.completed.delete(id); 
        this.completedAt.delete(id); 
    }

    _note(key, msg, log) {
        if (this._noted.has(key)) return;
        this._noted.add(key);
        log(msg);
    }

    // ---- orders ---------------------------------------------------------

    normalizeOrders(rawOrders, warnings = []) {
        const used = new Set();          // assets (groups / reserve units) that already have an order
        const out = [];
        const ids = new Set();
        (Array.isArray(rawOrders) ? rawOrders : []).forEach((raw, i) => {
            const tag = `Order #${i + 1}`;
            if (!raw || typeof raw !== 'object') return;

            const side = String(raw.side || '').toLowerCase();
            if (side !== 'red' && side !== 'blue') { warnings.push(`${tag} ignored: side must be red or blue.`); return; }

            const a = raw.action || {};
            const actionType = String(a.action_type || '').toLowerCase();
            const task = String(a.task || '').toUpperCase();
            if (actionType !== 'existing' && actionType !== 'new') { warnings.push(`${tag} ignored: action_type must be "existing" or "new".`); return; }
            if (!TASKS.includes(task)) { warnings.push(`${tag} ignored: unknown task "${task}".`); return; }
            if (actionType === 'new' && task === 'RTB') { warnings.push(`${tag} ignored: RTB only applies to existing groups.`); return; }

            const action = { action_type: actionType, task };
            if (actionType === 'existing') {
                if (!a.group_name) { warnings.push(`${tag} ignored: it needs group_name.`); return; }
                action.group_name = String(a.group_name);
            } else {
                const names = asArray(a.unit_names);
                if (!names.length) { warnings.push(`${tag} ignored: a "new" order needs unit_names (the reserve units to launch).`); return; }
                action.unit_names = [...new Set(names)];
            }

            if (task !== 'RTB') {
                const lat = toNum(a.target_area && a.target_area.lat, NaN);
                const lon = toNum(a.target_area && (a.target_area.long !== undefined ? a.target_area.long : a.target_area.lon), NaN);
                if (Number.isFinite(lat) && Number.isFinite(lon)) action.target_area = { lat, long: lon };
                if (a.target_name) action.target_name = String(a.target_name);
                if (!action.target_area && !action.target_name) { warnings.push(`${tag} ignored: it needs a target.`); return; }
            }
            if (a.route_via) action.route_via = String(a.route_via);
            if (a.reference_entity) action.reference_entity = String(a.reference_entity);

            const t = raw.trigger || {};
            const type = TRIGGERS.includes(t.type) ? t.type : 'start';
            const trigger = { type };
            if (type !== 'start') trigger.minutes = Math.max(0, toNum(t.minutes, 0));
            if (type === 'goal_done') {
                if (!t.goal) { warnings.push(`${tag} ignored: goal_done trigger needs a goal.`); return; }
                trigger.goal = String(t.goal);
            }

            const assets = actionType === 'existing' ? [action.group_name] : action.unit_names;
            const clash = assets.find(x => used.has(x));
            if (clash) { warnings.push(`${tag} ignored: "${clash}" already has an initial order (one order per asset).`); return; }
            assets.forEach(x => used.add(x));

            let id = raw.id ? String(raw.id) : '';
            if (!id || ids.has(id)) id = `o-${Math.random().toString(36).slice(2, 8)}`;
            ids.add(id);
            out.push({ id, side, label: raw.label ? String(raw.label) : '', trigger, action });
        });
        return out;
    }

    setExecuted(list) { this.executed = new Set(list || []); }
    markExecuted(id) { this.executed.add(id); }

    /** Orders of a coalition whose trigger is satisfied and that were not sent yet. */
    dueOrders(side, now = Date.now()) {
        return this.data.orders.filter(o => o.side === side && !this.executed.has(o.id) && this._triggered(o.trigger, now));
    }

    _triggered(trigger, now) {
        const t = trigger || { type: 'start' };
        const wait = (t.minutes || 0) * 60000;
        if (t.type === 'delay') return now - this.startedAt >= wait;
        if (t.type === 'goal_done') {
            const at = this.completedAt.get(t.goal);
            return at !== undefined && now - at >= wait;
        }
        return true;
    }

    /** Logs a message only the first time a key is seen (the executor retries every few seconds). */
    noteOnce(key, msg, log) { this._note(key, msg, log); }

    /** Reserve units held by orders that were not sent yet (hidden from the commander). */
    reservedUnits(side) {
        return this.data.orders
            .filter(o => o.side === side && !this.executed.has(o.id) && o.action.unit_names)
            .flatMap(o => o.action.unit_names);
    }

    /** Pre-placed groups with a pending order (the AI must not retask them). */
    reservedGroups(side) {
        return new Set(this.data.orders
            .filter(o => o.side === side && !this.executed.has(o.id) && o.action.group_name)
            .map(o => o.action.group_name));
    }
}

module.exports = MissionPlan;
module.exports.GOAL_TYPES = GOAL_TYPES;