// Builds a compact, pre-analysed "situation brief" in code so the LLM needs ONE call (no tool rounds).

const OFFENSIVE_TASKS = ['STRIKE', 'SEAD', 'CAS', 'ASSAULT', 'FIRE_SUPPORT', 'BALLISTIC'];

// Which tasks can serve each goal type (used to pre-compute the closest capable reserves)
const GOAL_TASKS = {
    strike: ['STRIKE', 'SEAD', 'CAP', 'ESCORT'],
    bm_depot: ['STRIKE', 'SEAD', 'CAP', 'ESCORT'],
    conquer: ['CAP', 'CAS', 'ASSAULT', 'TRANSPORT_TROOPS'],
    deploy_infantry: ['TRANSPORT_TROOPS'],
    border_crossing: ['TRANSPORT_TROOPS', 'ASSAULT'],
    resupply: ['TRANSPORT_LOGISTICS'],
    csar: ['CSAR'],
    'enemy-csar': ['CAS', 'STRIKE']
};
const DEFAULT_GOAL_TASKS = ['CAP', 'CAS', 'STRIKE'];

const r3 = n => Math.round(n * 1000) / 1000;

function centroid(border) {
    if (!border || border.length === 0) return null;
    let lat = 0, lon = 0;
    border.forEach(p => { lat += p.lat; lon += p.long; });
    return { lat: lat / border.length, lon: lon / border.length };
}

// Goals the commander may pursue under the current posture, highest priority first
function actionableGoals(targets, posture, maxGoals = 4) {
    const list = (targets && targets.targets) || [];
    return list
        .filter(t => !t.locked)
        .filter(t => !(posture && posture.peacetimeOnly && !t.peacetime && t.type !== 'csar'))
        .filter(t => t.objective !== false)
        .sort((a, b) => b.priority - a.priority)
        .slice(0, maxGoals);
}

function threatCounts(list, key = 'threat') {
    const c = {};
    list.forEach(e => { const k = e[key] || 'Unknown'; c[k] = (c[k] || 0) + 1; });
    return c;
}

const LOG_SIGNIFICANT = /destroyed|FAILED|CRITICAL|INTEL|ejected|rescued/i;
function significantLogs(logs) {
    return (logs || []).filter(l => LOG_SIGNIFICANT.test(l));
}

function strategicInventoryText(count, rangeKm) {
    if (count > 0) {
        return `STRATEGIC WEAPONS INVENTORY: ${count} ballistic missiles. 1 LAUNCHER = 1 MISSILE: fire with an "existing" action on ONE launcher group from active_assets; max range ${rangeKm}km (min 50km); never more missiles than inventory. BALLISTIC only against static high-value targets.`;
    }
    return 'STRATEGIC WEAPONS INVENTORY: 0 ballistic missiles. Do not order BALLISTIC.';
}

function buildBrief(ctx) {
    const { forces, targets, territory, posture, memory = {}, ballisticCount = 0, ballisticRangeKm = 290 } = ctx;
    const opts = ctx.opts || {};
    const radius = opts.threatRadiusKm || 60;
    const forbidden = new Set((posture && posture.forbiddenTasks) || []);
    const dist = (a, b, c, d) => forces._calculateDistance(a, b, c, d);
    const inFriendly = (lat, lon) => !!territory.isTargetInFriendlyTerritory(lat, lon).is_friendly_territory;

    const goals = actionableGoals(targets, posture, opts.maxGoals || 4).map(g => {
        const entry = {
            id: g.name, type: g.type, priority: g.priority,
            lat: r3(g.lat), lon: r3(g.lon),
            peacetime: g.peacetime,
            friendly_territory: inFriendly(g.lat, g.lon),
            status: g.state, 
            progress: Math.round((g.progress || 0) * 100)
        };

        if (g.assignments && g.assignments.length) entry.assigned = g.assignments.slice(0, 5).map(a => `${a.task}|${a.group || a.label}`);

        const near = forces.getEnemyThreatsNearLocation(g.lat, g.lon, radius);
        if (near.threats) {
            entry.threats = {
                counts: threatCounts(near.threats, 'threat_class'),
                nearest: near.threats.slice(0, 5).map(t => `${t.enemy_id}|${t.threat_class}|${t.distance_km}km`)
            };
        } else {
            entry.threats = { counts: {} };
        }

        const tasks = (GOAL_TASKS[g.type] || DEFAULT_GOAL_TASKS).filter(t => !forbidden.has(t));
        entry.reserves = [];
        tasks.forEach(task => {
            const r = forces.findClosestCapableGroup(task, g.lat, g.lon);
            if (r.found) entry.reserves.push({ task, type: r.unit_type, airbase: r.airbase, km: r.distance_km, ids: r.available_unit_ids.slice(0, 4) });
        });

        const sam = forces.getClosestActiveGroup('SAM', g.lat, g.lon);
        if (sam.found) entry.sam_cover = `${sam.group_id}|${sam.distance_km}km`;
        const cap = forces.getClosestActiveGroup('CAP', g.lat, g.lon);
        if (cap.found) entry.cap_cover = `${cap.group_id}|${cap.distance_km}km`;

        const covering = (forces.activeGroups || [])
            .map(a => ({ a, d: dist(a.lat, a.lon, g.lat, g.lon) }))
            .filter(x => x.d <= 30)
            .slice(0, 5)
            .map(x => `${x.a.name}|${(x.a.mission || []).join('+')}|${Math.round(x.d)}km`);
        if (covering.length) entry.active_nearby = covering;

        return entry;
    });

    const enemies = forces.enemyGroups || [];
    const intruders = enemies
        .filter(e => inFriendly(e.lat, e.lon))
        .sort((a, b) => b.threat_score - a.threat_score)
        .slice(0, 6)
        .map(e => `${e.name}|${e.threat}|${e.category}|${r3(e.lat)},${r3(e.lon)}|score ${e.threat_score}`);

    const c = centroid(territory.border);
    const home = { active_cap: (forces.activeGroups || []).filter(g => (g.mission || []).includes('CAP')).length };
    if (c) {
        ['CAP', 'INTERCEPT'].forEach(task => {
            const r = forces.findClosestCapableGroup(task, c.lat, c.lon);
            if (r.found) home[task.toLowerCase() + '_reserve'] = { type: r.unit_type, airbase: r.airbase, km: r.distance_km, ids: r.available_unit_ids.slice(0, 4) };
        });
        home.center = `${r3(c.lat)},${r3(c.lon)}`;
    }

    const active = (forces.activeGroups || []).slice(0, 40)
        .map(g => `${g.name}|${g.type}|${g.category}|${(g.mission || []).join('+')}|${r3(g.lat)},${r3(g.lon)}|x${g.nUnits}`);

    const summary = forces.getTheaterReservesSummary();
    const cycle = memory.cycle || 0;

    const brief = {
        posture: { level: posture ? posture.level : 'NONE', forbidden_tasks: posture ? posture.forbiddenTasks : [], max_new_orders: opts.maxNewPerCycle || 2 },
        goals,
        threats_in_our_territory: intruders,
        home_defense: home,
        active_assets_format: 'id|type|category|missions|lat,lon|units',
        active_assets: active,
        reserves_summary: summary.capabilities_summary || {},
        ballistic: { inventory: ballisticCount, range_km: ballisticRangeKm }
    };
    const recent = (memory.recentOrders || []).filter(o => cycle - o.cycle <= 12)
        .map(o => `${cycle - o.cycle} cycles ago: ${o.task} ${o.type} x${o.n} -> ${o.target || 'n/a'}`);
    if (recent.length) brief.recent_orders = recent;
    if (memory.feedback && memory.feedback.length) brief.order_feedback = memory.feedback;
    if (memory.lastLog) brief.last_mission_log = memory.lastLog;
    const events = [...new Set(ctx.logs || [])].slice(-12);
    if (events.length) brief.events = events;
    const locked = ((targets && targets.targets) || []).filter(t => t.locked).slice(0, 6).map(t => `${t.name}: after ${(t.blockedBy || []).join('+')}`);
    if (locked.length) brief.locked_goals = locked;
    return brief;
}

module.exports = {
    buildBrief, actionableGoals, centroid, threatCounts, significantLogs,
    strategicInventoryText, OFFENSIVE_TASKS, GOAL_TASKS, DEFAULT_GOAL_TASKS
};
