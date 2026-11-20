// Deterministic, zero-cost planner: fallback for the AI and a base for a fully offline commander.
// Deliberately simple: intercepts, one home-defence CAP, and a small staged playbook per goal type.
const { actionableGoals, centroid } = require('./briefBuilder.js');

const AIR_THREATS = new Set(['CAP', 'STRIKE', 'ATTACK_HELO', 'BOMBER']);
const GROUND_THREATS = new Set(['ARMOR', 'ARTILLERY', 'AAA', 'SAM', 'GROUND']);

class RuleCommander {
    constructor() {
        this.cycle = 0;
        this.assigned = {};      // goalName -> { stage, cycle, assaultCycle }
        this.intercepted = {};   // enemyId -> cycle
        this.homeCapCycle = -99;
    }

    plan(ctx) {
        const { forces, targets, territory, posture } = ctx;
        const maxNew = ctx.maxNew || 2;
        this.cycle++;
        const forbidden = new Set((posture && posture.forbiddenTasks) || []);
        const dist = (a, b, c, d) => forces._calculateDistance(a, b, c, d);
        const inFriendly = (lat, lon) => !!territory.isTargetInFriendlyTerritory(lat, lon).is_friendly_territory;
        const used = new Set(), actions = [], notes = [];
        const slots = () => maxNew - actions.length;
        const activeCap = (forces.activeGroups || []).filter(g => (g.mission || []).includes('CAP')).length;

        const pick = (task, lat, lon, n) => {
            if (forbidden.has(task)) return null;
            const c = (forces.availableUnits || []).filter(u => !used.has(u.name) && (u.missions || []).some(m => m.toUpperCase() === task));
            if (!c.length) return null;
            c.sort((a, b) => dist(a.lat, a.lon, lat, lon) - dist(b.lat, b.lon, lat, lon));
            const first = c[0];
            const same = c.filter(u => u.type === first.type && u.airbase === first.airbase);
            return same.slice(0, first.category === 'Air' ? 2 : n);
        };
        const commit = us => us.forEach(u => used.add(u.name));
        const release = us => us.forEach(u => used.delete(u.name));
        const push = (task, us, tgt) => {
            commit(us);
            actions.push({ action_type: 'new', task, unit_names: us.map(u => u.name),
                target_area: { lat: tgt.lat, long: tgt.lon }, target_name: tgt.name, reference_entity: tgt.ref, rationale: tgt.why });
        };
        const near = (g, classes, km) => (forces.enemyGroups || [])
            .filter(e => classes.has(e.threat) && dist(e.lat, e.lon, g.lat, g.lon) <= km);

        // 1. Intercept the most dangerous intruder inside our territory
        const intruders = (forces.enemyGroups || [])
            .filter(e => e.category === 'Air' && AIR_THREATS.has(e.threat) && inFriendly(e.lat, e.lon) &&
                !(this.intercepted[e.name] !== undefined && this.cycle - this.intercepted[e.name] < 6))
            .sort((a, b) => b.threat_score - a.threat_score);
        if (intruders.length && slots() > 0) {
            const e = intruders[0];
            const us = pick('INTERCEPT', e.lat, e.lon, 2);
            if (us) { push('INTERCEPT', us, { name: `intruder-${e.name}`, lat: e.lat, lon: e.lon, ref: e.name, why: `Intruder ${e.threat} inside our territory` }); this.intercepted[e.name] = this.cycle; }
        }

        // 2. Keep one defensive CAP flight over the homeland
        const c = centroid(territory.border);
        if (activeCap === 0 && c && slots() > 0 && this.cycle - this.homeCapCycle > 4) {
            const us = pick('CAP', c.lat, c.lon, 2);
            if (us) { push('CAP', us, { name: 'HOME_DEFENSE', lat: c.lat, lon: c.lon, why: 'No active CAP: establish home air defence' }); this.homeCapCycle = this.cycle; }
        }

        // 3. Goals by priority
        const goals = actionableGoals(targets, posture, 6);
        const names = new Set(goals.map(g => g.name));
        Object.keys(this.assigned).forEach(k => { if (!names.has(k)) delete this.assigned[k]; });

        for (const g of goals) {
            if (slots() <= 0) break;
            const s = this.assigned[g.name] || (this.assigned[g.name] = { stage: 0, cycle: -99, assaultCycle: -99 });
            const tgt = { name: g.name, lat: g.lat, lon: g.lon };
            const friendly = inFriendly(g.lat, g.lon);

            if (g.type === 'csar') {
                if (s.stage >= 1 && this.cycle - s.cycle < 8) continue;
                const us = pick('CSAR', g.lat, g.lon, 1);
                if (us) { push('CSAR', us, { ...tgt, ref: g.name.replace(/^csar-/, ''), why: 'Rescue downed pilot' }); s.stage = 1; s.cycle = this.cycle; }
                else notes.push(`no CSAR asset for ${g.name}`);
            } else if (g.type === 'enemy-csar') {
                if (s.stage >= 1) continue;
                const us = pick('CAS', g.lat, g.lon, 2);
                if (us) { push('CAS', us, { ...tgt, why: 'Destroy downed enemy pilot' }); s.stage = 1; s.cycle = this.cycle; }
            } else if (g.type === 'strike' || g.type === 'bm_depot') {
                if (s.stage >= 1) { if (this.cycle - s.cycle < 15) continue; s.stage = 0; }
                const needEscort = !friendly;
                if (slots() < (needEscort ? 2 : 1)) break;   // do not let lower-priority goals jump the queue
                const strike = pick('STRIKE', g.lat, g.lon, 2);
                if (!strike) { notes.push(`no STRIKE asset for ${g.name}`); continue; }
                commit(strike);
                if (needEscort) {
                    const escortTask = near(g, new Set(['SAM']), 50).length ? 'SEAD' : 'CAP';
                    const escort = pick(escortTask, g.lat, g.lon, 2);
                    if (!escort) { release(strike); notes.push(`no ${escortTask} escort for ${g.name}`); continue; }
                    push(escortTask, escort, { ...tgt, why: `${escortTask} for the strike package` });
                }
                push('STRIKE', strike, { ...tgt, why: 'Destroy static high-value target' });
                s.stage = 1; s.cycle = this.cycle;
            } else if (g.type === 'conquer') {
                if (s.stage >= 3) { if (this.cycle - s.cycle > 15) s.stage = 0; else continue; }
                if (s.cycle === this.cycle) continue;
                const groundThreat = near(g, GROUND_THREATS, 25).length > 0;
                if (s.stage === 0) {
                    s.stage = 1;
                    if (activeCap === 0 && !actions.some(a => a.task === 'CAP')) {
                        const us = pick('CAP', g.lat, g.lon, 2);
                        if (us) { push('CAP', us, { ...tgt, why: 'Air superiority before the ground advance' }); s.cycle = this.cycle; continue; }
                    }
                }
                if (s.stage === 1) {
                    s.stage = 2;
                    if (groundThreat) {
                        const us = pick('ASSAULT', g.lat, g.lon, 2);
                        if (us) { push('ASSAULT', us, { ...tgt, why: 'Clear enemy ground resistance' }); s.assaultCycle = this.cycle; s.cycle = this.cycle; continue; }
                    }
                }
                if (s.stage === 2 && (s.assaultCycle < 0 || this.cycle - s.assaultCycle >= 3)) {
                    const us = pick('TRANSPORT_TROOPS', g.lat, g.lon, 1);
                    if (us) { push('TRANSPORT_TROOPS', us, { ...tgt, why: 'Deploy occupying infantry' }); s.stage = 3; s.cycle = this.cycle; }
                    else notes.push(`no TRANSPORT_TROOPS asset for ${g.name}`);
                }
            } else if (g.type === 'border_crossing' || g.type === 'deploy_infantry' || g.type === 'resupply') {
                if (s.stage >= 1 && this.cycle - s.cycle < 15) continue;
                const task = g.type === 'resupply' ? 'TRANSPORT_LOGISTICS' : 'TRANSPORT_TROOPS';
                const us = pick(task, g.lat, g.lon, 1);
                if (us) { push(task, us, { ...tgt, why: g.type === 'resupply' ? 'Resupply' : 'Secure position with infantry' }); s.stage = 1; s.cycle = this.cycle; }
                else notes.push(`no ${task} asset for ${g.name}`);
            }
        }

        const mission_log = actions.length
            ? `Rule-based HQ: ${actions.map(a => `${a.task}${a.target_name ? ' -> ' + a.target_name : ''}`).join('; ')}.` + (notes.length ? ' Gaps: ' + notes.join('; ') + '.' : '')
            : 'Rule-based HQ: situation nominal, no new orders.' + (notes.length ? ' Gaps: ' + notes.join('; ') + '.' : '');
        return { mission_log, actions };
    }
}

module.exports = RuleCommander;
