const { validateActions } = require('./orderValidator.js');

const WARMUP_MS = 8000;    // let DCS send its first reports / restore persisted groups before ordering

const labelOf = o => o.label || `${o.action.task} ${o.action.group_name || (o.action.unit_names || []).length + ' reserve unit(s)'}`;

// Turns a stored order into the raw action the AI would have produced
function buildRaw(order) {
    const a = order.action;
    return {
        action_type: a.action_type, task: a.task, group_name: a.group_name, unit_names: a.unit_names,
        target_name: a.target_name, target_area: a.target_area,
        reference_entity: a.reference_entity, route_via: a.route_via,
        rationale: order.label || `Scripted order ${order.id}`
    };
}

// Scripted orders can use the units held back from the commander
function viewWithReserved(forces) {
    const view = Object.create(forces);
    view.availableUnits = [...(forces.availableUnits || []), ...(forces.reservedUnits || [])];
    return view;
}

/**
 * Sends the due scripted orders of one coalition. Orders that cannot be issued yet stay pending and are retried.
 * d: { plan, state, persistence, logger, ui, sendOrdersToDCS, sendMessageToDCS, triggerMapUpdate, now }
 */
function runDueOrders(side, d) {
    const { plan, state, persistence, logger, ui } = d;
    const now = d.now || Date.now();
    const cState = state[side];
    const forces = cState.forces;
    if (!forces || !forces.activeGroups || !forces.availableUnits) return 0;   // telemetry not ready
    if (now - plan.startedAt < WARMUP_MS) return 0;

    const due = plan.dueOrders(side, now);
    if (due.length === 0) return 0;

    const ctx = {
        forces, targets: cState.targets, territory: cState.territory, posture: null, scripted: true,
        ballisticCount: persistence.getBallisticMissileCount(side), ballisticRangeKm: state.ballisticRangeKm
    };
    const note = (order, reason) => plan.noteOnce(`ord:${order.id}:${reason}`,
        `Scripted order "${labelOf(order)}" not issued yet: ${reason} (will retry).`, m => ui(m, 'info'));

    const actions = [], issued = [];
    for (const order of due) {
        ctx.forces = viewWithReserved(forces);                       // rebuilt: earlier orders may have consumed units
        const mine = new Set(order.action.unit_names || []);
        ctx.reserved = new Set(plan.reservedUnits(side).filter(n => !mine.has(n)));   // other orders' units stay untouched

        const v = validateActions([buildRaw(order)], ctx);
        if (v.valid.length === 0) { note(order, (v.rejected[0] || 'rejected').replace(/^[^:]*:\s*/, '')); continue; }

        const act = v.valid[0];
        actions.push(act);
        issued.push(`${act.task}${act.target_name ? ' -> ' + act.target_name : ''}`);

        // Same bookkeeping as commanderRunner
        if (act.action_type === 'new' && act.unit_names) act.unit_names.forEach(n => forces.removeAvailableUnit(n));
        if (act.task === 'BALLISTIC') {
            persistence.consumeBallisticMissile(side, 1);
            ctx.ballisticCount = persistence.getBallisticMissileCount(side);
        }
        plan.markExecuted(order.id);
    }

    if (actions.length > 0) {
        // One batch: flights sharing a target_name join the same rendezvous package
        d.sendOrdersToDCS(side.toUpperCase(), actions);
        if (d.goals) d.goals.noteOrders(side, actions);
        d.sendMessageToDCS(side.toUpperCase(), `HQ initial orders: ${issued.join('; ')}`);
        ui(`Initial orders issued (${side}): ${issued.join('; ')}`, 'success');
        logger.info(`[plan] Initial orders issued (${side}): ${JSON.stringify(actions)}`);
        if (persistence.currentFile && state.persistState) persistence.setExecutedOrders([...plan.executed]);
        d.triggerMapUpdate();
    }
    return actions.length;
}

module.exports = { runDueOrders };