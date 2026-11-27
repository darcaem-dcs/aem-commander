// Single owner of every goal of the theatre (both coalitions).
//
// Sources of goals:
//   zone    -> GOAL_RED* / GOAL_BLUE* trigger zones exported by the Lua script
//   plan    -> custom goals created in the Mission Map (MissionPlan)
//   runtime -> created while playing (CSAR pilots). Ephemeral: never persisted
//
// Lifecycle (goals are never deleted, except runtime ones):
//   LOCKED -> AVAILABLE -> IN_PROGRESS -> COMPLETED | FAILED
//   COMPLETED / FAILED can be reopened (e.g. a reconquered zone).
//   LOCKED / AVAILABLE / IN_PROGRESS are derived (prerequisites + assigned orders),
//   only COMPLETED / FAILED are persisted.
//
// Goal objects keep the shape the rest of the app already uses (name, priority, type, lat, lon,
// peacetime, props, requires, blockedBy, locked) plus: side, state, progress, radius, objective, assignments.
// forSide(side) returns a view that is drop-in compatible with the old CoalitionTargets (.targets, .coalition).
 
const { GOAL_TYPES } = require('./missionPlan.js');
 
const S = Object.freeze({
    LOCKED: 'LOCKED', AVAILABLE: 'AVAILABLE', IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'COMPLETED', FAILED: 'FAILED'
});
const ACTIVE = new Set([S.LOCKED, S.AVAILABLE, S.IN_PROGRESS]);
const NON_OBJECTIVE_TYPES = new Set(['border_crossing']);   // waypoints/resources: never "completed"
const MONITORED_TYPES = new Set(['strike', 'bm_depot', 'conquer', 'deploy_infantry', 'resupply']);   // evaluated by the Lua GoalMonitor
const DEFAULT_RADIUS = 3000;
const ORPHAN_ASSIGNMENT_MS = 10 * 60 * 1000;                // an order whose flight never showed up
 
const toNum = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const toBool = v => v === true || v === 'true';
const otherSide = s => (s === 'red' ? 'blue' : 'red');
 
function distM(lat1, lon1, lat2, lon2) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
 
class Goal {
    constructor(id, side, source) {
        this.name = id;                 // goal id (kept as "name" for the existing code)
        this.side = side;
        this.source = source;           // zone | plan | runtime
        this.type = 'unknown';
        this.priority = 1;
        this.lat = 0; this.lon = 0;
        this.radius = DEFAULT_RADIUS;
        this.peacetime = false;
        this.props = {};
        this.objective = true;          // false: waypoint/resource, never completed
        this.disabled = false;
        this.requires = [];
        this.blockedBy = [];
        this.locked = false;
        this.state = S.AVAILABLE;
        this.progress = 0;              // 0..1
        this.assignments = [];          // { label, units[], group|null, task, at }
        this.completedAt = null;
        this.reason = '';
        Object.defineProperty(this, 'base', { value: null, writable: true, enumerable: false });   // zone values before plan overrides
    }
}
 
// Drop-in replacement for CoalitionTargets: state[side].targets
class SideView {
    constructor(manager, side) { this.m = manager; this.coalition = side; }
    get targets() { return this.m.received[this.coalition] ? this.m.listFor(this.coalition) : null; }
    resolve(name, lat, lon) { return this.m.resolve(this.coalition, name, lat, lon); }
}
 
class GoalManager {
    /** hooks: { plan, ui(msg, type), aiLog(side, text), save(statesObject), config(list), onCompleted(goal) }
     *  config: monitored goals for the DCS-side GoalMonitor, called only when they changed */
    constructor(hooks = {}) {
        this.plan = hooks.plan || null;
        this.h = { ui: () => {}, aiLog: () => {}, save: () => {}, config: () => {}, onCompleted: () => {}, ...hooks };
        this.views = { red: new SideView(this, 'red'), blue: new SideView(this, 'blue') };
        this.reset();
    }
 
    reset() {
        this.goals = new Map();
        this.received = { red: false, blue: false };   // GOALS message seen for the side
        this.saved = {};                               // persisted COMPLETED / FAILED states
        this.issues = [];
        this._noted = new Set();
        this._cfgSig = null;
    }
 
    forSide(side) { return this.views[side]; }
    get(id) { return this.goals.get(id) || null; }
    listFor(side) {
        return [...this.goals.values()].filter(g => g.side === side && !g.disabled && ACTIVE.has(g.state));
    }
 
    /** Every goal of a side for the UI (any state, runtime goals included, disabled ones left out). */
    snapshot(side) {
        return [...this.goals.values()].filter(g => g.side === side && !g.disabled);
    }
 
    // ---- persistence ----------------------------------------------------
 
    /** states: persisted { id: {state, progress, completedAt, reason} }; legacy: old completed_goals id list */
    loadSaved(states = {}, legacy = []) {
        this.saved = {};
        (legacy || []).forEach(id => { this.saved[id] = { state: S.COMPLETED, progress: 1, completedAt: 0 }; });
        Object.entries(states || {}).forEach(([id, s]) => {
            if (s && (s.state === S.COMPLETED || s.state === S.FAILED)) this.saved[id] = s;
        });
        if (this.plan) this.plan.setCompleted(Object.keys(this.saved).filter(id => this.saved[id].state === S.COMPLETED));
        this.goals.forEach(g => this._applySaved(g));
    }
 
    _applySaved(g) {
        const s = this.saved[g.name];
        if (!s || g.source === 'runtime') return;
        g.state = s.state;
        g.progress = s.state === S.COMPLETED ? 1 : toNum(s.progress, 0);
        g.completedAt = s.completedAt === undefined ? null : s.completedAt;
        g.reason = s.reason || '';
    }
 
    _persist() {
        const out = {};
        for (const [id, s] of Object.entries(this.saved)) if (!this.goals.has(id)) out[id] = s;   // goals not loaded in this session
        for (const g of this.goals.values()) {
            if (g.source !== 'runtime' && (g.state === S.COMPLETED || g.state === S.FAILED)) {
                out[g.name] = { state: g.state, progress: g.progress, completedAt: g.completedAt, reason: g.reason };
            }
        }
        this.saved = out;
        this.h.save(out);
    }
 
    // ---- ingestion ------------------------------------------------------
 
    /** GOALS message of the Lua script (zones). Idempotent: the Lua re-exports everything on every connect. */
    ingestZones(side, items) {
        this.received[side] = true;
        (Array.isArray(items) ? items : []).forEach(item => {
            const { id, target_area, ...props } = item || {};
            if (!id) return;
            let g = this.goals.get(id);
            if (g && g.source !== 'zone') { this._issue('error', id, `id clashes with a ${g.source} goal`); return; }
            if (!g) { g = new Goal(id, side, 'zone'); this.goals.set(id, g); this._applySaved(g); }
            g.side = side;
            g.lat = toNum(target_area && target_area.lat, 0);
            g.lon = toNum(target_area && target_area.long, 0);
            g.base = {
                type: props.type ? String(props.type) : 'unknown',
                priority: toNum(props.priority, 1), priorityMissing: props.priority === undefined,
                peacetime: toBool(props.peacetime),
                radius: toNum(props.radius, DEFAULT_RADIUS),
                props
            };
        });
        this.sync();
    }
 
    // Zone goals = base + plan overrides; custom goals come from the plan. Idempotent.
    _applyPlan() {
        const pg = (this.plan && this.plan.data && this.plan.data.goals) || {};
 
        for (const g of this.goals.values()) {
            if (g.source !== 'zone' || !g.base) continue;
            const o = pg[g.name] || {}, b = g.base;
            g.type = o.type || b.type;
            g.priority = o.priority !== undefined ? o.priority : b.priority;
            g.peacetime = o.peacetime !== undefined ? o.peacetime : b.peacetime;
            g.radius = b.radius;
            g.props = { ...b.props, ...(o.props || {}) };
            g.disabled = !!o.disabled;
            g.requires = (o.requires || []).slice();
            this._classify(g);
        }
 
        const live = new Set();
        for (const [id, o] of Object.entries(pg)) {
            if (!o.custom || !this.received[o.side]) continue;
            live.add(id);
            let g = this.goals.get(id);
            if (g && g.source !== 'plan') continue;
            if (!g) { g = new Goal(id, o.side, 'plan'); this.goals.set(id, g); this._applySaved(g); }
            Object.assign(g, {
                side: o.side, type: o.type, priority: o.priority, lat: o.lat, lon: o.lon,
                radius: o.radius || DEFAULT_RADIUS, peacetime: !!o.peacetime, disabled: !!o.disabled,
                requires: (o.requires || []).slice(), props: { ...(o.props || {}) }
            });
            this._classify(g);
        }
        for (const [id, g] of this.goals) if (g.source === 'plan' && !live.has(id)) this.goals.delete(id);
    }
 
    _classify(g) {
        const o = g.props.objective;
        g.objective = o === undefined ? !NON_OBJECTIVE_TYPES.has(g.type) : toBool(o);
    }
 
    // ---- derived state --------------------------------------------------
 
    /** Call once per commander cycle (and after any change to the plan). */
    sync(now = Date.now()) {
        this._applyPlan();
        this._expireAssignments(now);
        this._refreshLocks();
        this._validate();
        this._notifyConfig();
    }
 
    // A disabled prerequisite counts as satisfied (otherwise its dependants would stay locked forever)
    _satisfied(id) {
        const p = this.goals.get(id);
        if (!p) return false;
        return p.disabled || p.state === S.COMPLETED;
    }
 
    _refreshLocks() {
        const unlocked = [];
        for (const g of this.goals.values()) {
            if (g.source === 'runtime' || !ACTIVE.has(g.state)) { g.blockedBy = []; g.locked = false; continue; }
            g.blockedBy = g.requires.filter(r => !this._satisfied(r));
            g.locked = g.blockedBy.length > 0;
            if (g.locked && g.state === S.AVAILABLE) g.state = S.LOCKED;
            else if (!g.locked && g.state === S.LOCKED) { g.state = S.AVAILABLE; unlocked.push(g); }
        }
        unlocked.forEach(g => {
            const m = `Goal ${g.name} is now unlocked: its prerequisites are completed.`;
            this.h.aiLog(g.side, m);
            this.h.ui(m, 'info');
        });
    }
 
    _setState(g, state) { g.state = state; }
 
    _expireAssignments(now) {
        for (const g of this.goals.values()) {
            if (!g.assignments.length) continue;
            g.assignments = g.assignments.filter(a => a.group || now - a.at <= ORPHAN_ASSIGNMENT_MS);
            if (g.assignments.length === 0 && g.state === S.IN_PROGRESS) this._setState(g, S.AVAILABLE);
        }
    }
 
    // ---- DCS-side monitor -----------------------------------------------
 
    /** Goals the Lua GoalMonitor has to watch. Zone properties destroy_pct / hold_sec / min_units tune it. */
    monitorConfig() {
        const out = [];
        for (const g of this.goals.values()) {
            if (g.source === 'runtime' || !g.objective || g.disabled || !MONITORED_TYPES.has(g.type)) continue;
            if (g.state === S.FAILED) continue;
            const p = g.props || {};
            if (String(p.completion || '').toLowerCase() === 'order') continue;      // legacy: completed by the order outcome
            const completed = g.state === S.COMPLETED;
            if (completed && g.type !== 'conquer') continue;                          // completed conquer goals are watched to detect losing the zone
            out.push({
                id: g.name, side: g.side, type: g.type, lat: g.lat, lon: g.lon, radius: g.radius,
                locked: g.locked, completed,
                destroy_pct: toNum(p.destroy_pct, undefined), hold_sec: toNum(p.hold_sec, undefined), min_units: toNum(p.min_units, undefined)
            });
        }
        return out;
    }
 
    _notifyConfig() {
        const cfg = this.monitorConfig();
        const sig = JSON.stringify(cfg);
        if (sig === this._cfgSig) return;
        this._cfgSig = sig;
        this.h.config(cfg);
    }
 
    // ---- transitions ----------------------------------------------------
 
    /** @returns {boolean} true if the goal changed to COMPLETED now */
    complete(id, info = {}) {
        const g = this.goals.get(id);
        if (!g || g.state === S.COMPLETED) return false;
        if (g.source === 'runtime') { this.goals.delete(id); return true; }
        if (!g.objective) return false;
        g.state = S.COMPLETED; g.progress = 1; g.assignments = [];
        g.completedAt = Date.now(); g.reason = info.reason || info.by || '';
        if (this.plan) this.plan.markCompleted(id);
        this._persist();
        this.h.ui(`Goal completed: ${id}${info.by ? ` (${info.by})` : ''}`, 'success');
        this._refreshLocks();
        this._notifyConfig();
        this.h.onCompleted(g);
        return true;
    }
 
    /** Legacy completion by the outcome of an order. Only for goals declared with completion=order in the zone. */
    completeByOrder(id, info = {}) {
        const g = this.goals.get(id);
        if (!g || String((g.props || {}).completion || '').toLowerCase() !== 'order') return false;
        return this.complete(id, info);
    }
 
    fail(id, reason = '') {
        const g = this.goals.get(id);
        if (!g || g.source === 'runtime' || g.state === S.FAILED || g.state === S.COMPLETED) return false;
        g.state = S.FAILED; g.assignments = []; g.completedAt = Date.now(); g.reason = reason;
        this._persist();
        const m = `Goal ${id} has FAILED${reason ? `: ${reason}` : ''}.`;
        this.h.aiLog(g.side, m);
        this.h.ui(m, 'error');
        this._refreshLocks();
        this._notifyConfig();
        return true;
    }
 
    reopen(id, reason = '') {
        const g = this.goals.get(id);
        if (!g || g.source === 'runtime' || (g.state !== S.COMPLETED && g.state !== S.FAILED)) return false;
        g.state = S.AVAILABLE; g.progress = 0; g.completedAt = null; g.reason = '';
        if (this.plan) this.plan.unmarkCompleted(id);
        this._persist();
        const m = `Goal ${id} is open again${reason ? `: ${reason}` : ''}.`;
        this.h.aiLog(g.side, m);
        this.h.ui(m, 'info');
        this._refreshLocks();
        this._notifyConfig();
        return true;
    }
 
    /** goal_status event from the DCS-side monitor: { id|goalName, state, progress (0..1), reason } */
    applyStatus(ev) {
        const id = ev && (ev.id || ev.goalName);
        const g = this.goals.get(id);
        if (!g) { this.h.ui(`goal_status for unknown goal "${id}" ignored.`, 'info'); return false; }
        if (ev.warning) this._issue('warn', id, String(ev.warning));
        if (ev.progress !== undefined) g.progress = Math.max(0, Math.min(1, toNum(ev.progress, g.progress)));
        switch (String(ev.state || '').toUpperCase()) {
            case 'COMPLETED': return this.complete(id, { by: 'DCS monitor' });
            case 'FAILED': return this.fail(id, ev.reason);
            case 'AVAILABLE': case 'REOPENED': return this.reopen(id, ev.reason);
            default: return true;
        }
    }
 
    // ---- orders <-> goals (assignment only, completion never depends on an order) ----
 
    /** Goal an order serves: by name or, for coordinate-only orders, by proximity to the goal radius. */
    resolve(side, name, lat, lon) {
        if (name) {
            const g = this.goals.get(name);
            if (g && g.side === side) return g;
        }
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        let best = null, bestD = Infinity;
        for (const g of this.goals.values()) {
            if (g.side !== side || g.disabled || !g.objective || !ACTIVE.has(g.state)) continue;
            const d = distM(lat, lon, g.lat, g.lon);
            if (d <= Math.max(g.radius, DEFAULT_RADIUS) && d < bestD) { best = g; bestD = d; }
        }
        return best;
    }
 
    /** Call with the validated actions that were actually sent to DCS. */
    noteOrders(side, actions, now = Date.now()) {
        for (const a of actions || []) {
            if (a.task === 'RTB') continue;
            const t = a.target_area || {};
            const g = this.resolve(side, a.target_name, Number(t.lat), Number(t.long));
            if (!g || !g.objective || !ACTIVE.has(g.state)) continue;
            g.assignments.push({
                label: a.group_name || (a.unit_names || []).join(','),
                units: a.unit_names || [], group: a.group_name || null, task: a.task, at: now
            });
            if (g.state === S.AVAILABLE) this._setState(g, S.IN_PROGRESS);
        }
    }
 
    /** 'activated' event: the reserve units of an order became a real group. */
    bindGroup(unitNames, groupName) {
        if (!groupName || !unitNames || !unitNames.length) return;
        for (const g of this.goals.values()) {
            g.assignments.forEach(a => { if (!a.group && a.units.some(u => unitNames.includes(u))) a.group = groupName; });
        }
    }
 
    /** The group died, landed or finished its mission: it no longer works on any goal. */
    releaseGroup(groupName) {
        if (!groupName) return;
        for (const g of this.goals.values()) {
            const before = g.assignments.length;
            g.assignments = g.assignments.filter(a => a.group !== groupName);
            if (before !== g.assignments.length && g.assignments.length === 0 && g.state === S.IN_PROGRESS) this._setState(g, S.AVAILABLE);
        }
    }
 
    // ---- runtime goals (CSAR) -------------------------------------------
 
    _addRuntime(side, id, type, priority, lat, lon) {
        let g = this.goals.get(id);
        if (!g) { g = new Goal(id, side, 'runtime'); this.goals.set(id, g); }
        Object.assign(g, { side, type, priority, lat: toNum(lat, 0), lon: toNum(lon, 0), radius: 500, peacetime: type === 'csar', objective: true });
        return g;
    }
 
    /** A pilot of `side` is on the ground: rescue goal for them, destroy goal for the enemy. */
    csarDown(side, ev) {
        this._addRuntime(side, `csar-${ev.name}`, 'csar', 999, ev.lat, ev.lon);
        this._addRuntime(otherSide(side), `enemy-csar-${ev.name}`, 'enemy-csar', 0.5, ev.lat, ev.lon);
        this.h.aiLog(side, 'One of our pilots has ejected safely and needs to be rescued. A new csar mission has been added to the targets list');
        this.h.aiLog(otherSide(side), 'An enemy pilot has ejected safely. A new enemy-csar mission has been added to the targets list');
    }
 
    rescued(side, name) {
        if (this.goals.delete(`csar-${name}`)) this.h.aiLog(side, `The CSAR mission to rescue ${name} has been a success`);
        if (this.goals.delete(`enemy-csar-${name}`)) this.h.aiLog(otherSide(side), `The enemy csar mission has rescued ${name}`);
    }
 
    /** Pilot killed on the ground: the rescue is no longer possible. */
    pilotLost(name) {
        if (!name) return;
        const mine = this.goals.get(`csar-${name}`);
        if (mine && this.goals.delete(`csar-${name}`)) this.h.aiLog(mine.side, `Pilot ${name} was killed on the ground: the csar goal is cancelled.`);
        const theirs = this.goals.get(`enemy-csar-${name}`);
        if (theirs && this.goals.delete(`enemy-csar-${name}`)) this.h.aiLog(theirs.side, `Enemy pilot ${name} is dead: the enemy-csar goal is closed.`);
    }
 
    // ---- validation -----------------------------------------------------
 
    _issue(level, goal, msg) {
        const key = `${level}|${goal}|${msg}`;
        if (this._noted.has(key)) return;
        this._noted.add(key);
        this.h.ui(`Goal ${goal}: ${msg}`, level === 'error' ? 'error' : 'info');
    }
 
    /** Current list of problems (also logged once each). Zone / plan goals only. */
    _validate() {
        const out = [];
        const add = (level, goal, msg) => { out.push({ level, goal, msg }); this._issue(level, goal, msg); };
        const bothSides = this.received.red && this.received.blue;
 
        for (const g of this.goals.values()) {
            if (g.source === 'runtime') continue;
            if (!GOAL_TYPES.includes(g.type)) add('error', g.name, `unknown or missing type "${g.type}"`);
            if (g.source === 'zone' && g.base && g.base.priorityMissing && !(this.plan && this.plan.data.goals[g.name] && this.plan.data.goals[g.name].priority !== undefined)) {
                add('warn', g.name, 'no priority property: using 1');
            }
            if (g.source === 'zone' && g.lat === 0 && g.lon === 0) add('error', g.name, 'exported at 0,0: the DCS script did not find the zone');
            if (g.type === 'bm_depot' && !(parseInt(g.props.bm_count, 10) > 0)) add('warn', g.name, 'bm_depot without bm_count: destroying it will not remove any missile');
            if (g.peacetime && (g.type === 'strike' || g.type === 'bm_depot')) add('warn', g.name, `peacetime=true has no effect: STRIKE orders are forbidden under GREEN/YELLOW posture`);
 
            for (const r of g.requires) {
                const p = this.goals.get(r);
                if (!p) { if (bothSides) add('error', g.name, `requires "${r}", which does not exist`); continue; }
                if (p.side !== g.side) add('warn', g.name, `requires "${r}", which belongs to the other coalition`);
                if (p.disabled) add('warn', g.name, `requires "${r}", which is disabled (treated as satisfied)`);
                if (!p.objective) add('error', g.name, `requires "${r}", which is not an objective and can never be completed`);
            }
        }
        this.issues = out;
    }
}
 
module.exports = GoalManager;
module.exports.STATE = S;
 