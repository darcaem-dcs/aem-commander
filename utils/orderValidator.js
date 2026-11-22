// Hard-enforces in code the rules the old prompt only *asked* the model to follow.
const SUPPORT_TASKS = new Set(['CAP', 'CAS', 'STRIKE', 'SEAD', 'FIRE_SUPPORT']);
const GROUND_PUSH = new Set(['ASSAULT', 'TRANSPORT_TROOPS']);

const clean = v => (v === null || v === undefined || v === '' || /^(null|none|n\/a)$/i.test(String(v).trim())) ? undefined : String(v).trim();
const upper = v => String(v || '').toUpperCase();

function validateActions(actions, ctx) {
    const { forces, targets, territory, posture } = ctx;
    const maxNew = ctx.maxNew || 2;
    const forbidden = new Set((posture && posture.forbiddenTasks) || []);
    const goals = (targets && targets.targets) || [];
    const goalByName = new Map(goals.map(g => [g.name, g]));
    const crossings = goals.filter(g => g.type === 'border_crossing');
    const availByName = new Map((forces.availableUnits || []).map(u => [u.name, u]));
    const activeByName = new Map((forces.activeGroups || []).map(g => [g.name, g]));
    const dist = (a, b, c, d) => forces._calculateDistance(a, b, c, d);
    const inFriendly = (lat, lon) => !!territory.isTargetInFriendlyTerritory(lat, lon).is_friendly_territory;

    const valid = [], rejected = [];
    const usedUnits = new Set(), usedGroups = new Set();
    let newCount = 0, ballisticUsed = 0;

    const dependent = a => GROUND_PUSH.has(upper(a && a.task)) ? 1 : 0;       // evaluate after the support tasks
    const ordered = (Array.isArray(actions) ? actions : []).filter(a => a && typeof a === 'object')
        .map((a, i) => ({ a, i })).sort((x, y) => dependent(x.a) - dependent(y.a) || x.i - y.i).map(x => x.a);

    const hasSupport = () =>
        (forces.activeGroups || []).some(g => (g.mission || []).some(m => SUPPORT_TASKS.has(upper(m)))) ||
        valid.some(v => SUPPORT_TASKS.has(v.task));

    for (const raw of ordered) {
        const a = {
            action_type: clean(raw.action_type) && clean(raw.action_type).toLowerCase(),
            task: upper(clean(raw.task)),
            group_name: clean(raw.group_name),
            unit_names: Array.isArray(raw.unit_names) ? [...new Set(raw.unit_names.map(String))] : [],
            target_name: clean(raw.target_name),
            route_via: clean(raw.route_via),
            reference_entity: clean(raw.reference_entity),
            rationale: clean(raw.rationale)
        };
        const label = `${a.action_type || '?'} ${a.task || '?'} ${a.group_name || a.unit_names.join(',') || ''}`.trim();
        const reject = why => rejected.push(`${label}: ${why}`);

        if (a.action_type !== 'new' && a.action_type !== 'existing') { reject('action_type must be new or existing'); continue; }
        if (!a.task) { reject('missing task'); continue; }
        if (a.task !== 'RTB' && forbidden.has(a.task)) { reject(`task forbidden by current posture ${posture.level}`); continue; }

        // Target: explicit coordinates, else the named goal's
        const goal = a.target_name ? goalByName.get(a.target_name) : null;
        let lat = raw.target_area && Number(raw.target_area.lat);
        let lon = raw.target_area && Number(raw.target_area.long !== undefined ? raw.target_area.long : raw.target_area.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            if (goal) { lat = goal.lat; lon = goal.lon; } else { lat = NaN; lon = NaN; }
        }
        const hasTarget = Number.isFinite(lat) && Number.isFinite(lon);
        if (a.task !== 'RTB' && !hasTarget) { reject('missing target_area'); continue; }
        if (goal && posture && posture.peacetimeOnly && !goal.peacetime && goal.type !== 'csar') { reject(`goal ${goal.name} is not allowed in peacetime`); continue; }
        if (goal && goal.locked) { reject(`goal ${goal.name} is locked until ${(goal.blockedBy || []).join(', ')} is completed`); continue; }

        const out = { action_type: a.action_type, task: a.task, rationale: a.rationale };
        if (hasTarget) out.target_area = { lat, long: lon };
        if (a.target_name) out.target_name = a.target_name;
        if (a.reference_entity) out.reference_entity = a.reference_entity;

        // Ground units entering enemy territory must route through a border crossing, if any exists
        const fixRoute = (startLat, startLon) => {
            if (!GROUND_PUSH.has(a.task) || !hasTarget || inFriendly(lat, lon) || crossings.length === 0) return;
            if (a.route_via && goalByName.has(a.route_via) && goalByName.get(a.route_via).type === 'border_crossing') { out.route_via = a.route_via; return; }
            let best = null, bestD = Infinity;
            crossings.forEach(c => {
                const d = dist(startLat, startLon, c.lat, c.lon) + dist(c.lat, c.lon, lat, lon);
                if (d < bestD) { bestD = d; best = c; }
            });
            out.route_via = best.name;
        };

        if (a.action_type === 'new') {
            if (newCount >= maxNew) { reject(`max ${maxNew} new orders per cycle`); continue; }
            const units = a.unit_names.map(n => availByName.get(n)).filter(u => u && !usedUnits.has(u.name));
            if (units.length === 0) { reject('unit_names unknown or already assigned'); continue; }
            const first = units[0];
            const capable = u => (u.missions || []).some(m => upper(m) === a.task);
            if (!capable(first)) { reject(`${first.type} has no ${a.task} capability in its mission array`); continue; }
            let chosen = units.filter(u => u.type === first.type && u.airbase === first.airbase && capable(u));

            if (first.category === 'Air') {                           // fixed-wing flights are exactly 2 aircraft
                chosen = chosen.slice(0, 2);
                if (chosen.length < 2) {
                    const fill = (forces.availableUnits || []).filter(u => !usedUnits.has(u.name) && !chosen.includes(u) &&
                        u.type === first.type && u.airbase === first.airbase && capable(u));
                    chosen = chosen.concat(fill.slice(0, 2 - chosen.length));
                }
            }
            if (GROUND_PUSH.has(a.task) && hasTarget && !inFriendly(lat, lon) && !hasSupport()) {
                reject('no CAP/CAS/STRIKE/SEAD/FIRE_SUPPORT support established for an advance into enemy territory'); continue;
            }
            fixRoute(first.lat, first.lon);
            chosen.forEach(u => usedUnits.add(u.name));
            Object.assign(out, {
                unit_names: chosen.map(u => u.name), unit_type: first.type, category: first.category,
                airbase: first.airbase || '', unit_count: chosen.length
            });
            newCount++;
        } else {
            const g = a.group_name && activeByName.get(a.group_name);
            if (!g) { reject('unknown active group'); continue; }
            if (usedGroups.has(g.name)) { reject('group already tasked this cycle'); continue; }
            if (a.task !== 'RTB' && !(g.mission || []).some(m => upper(m) === a.task)) { reject(`task must match the group's current mission (${(g.mission || []).join('/')}) or RTB`); continue; }
            if (a.task === 'BALLISTIC') {
                const d = dist(g.lat, g.lon, lat, lon);
                if (ballisticUsed >= (ctx.ballisticCount || 0)) { reject('no ballistic missiles left'); continue; }
                if (d < 50 || d > (ctx.ballisticRangeKm || 290)) { reject(`target ${Math.round(d)}km away, outside 50-${ctx.ballisticRangeKm}km`); continue; }
                ballisticUsed++;
            }
            fixRoute(g.lat, g.lon);
            usedGroups.add(g.name);
            out.group_name = g.name;
        }
        valid.push(out);
    }
    return { valid, rejected, newCount, ballisticUsed };
}

module.exports = { validateActions };
