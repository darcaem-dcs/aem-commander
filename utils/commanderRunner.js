// One commander cycle for one coalition. Replaces the old processCommander body in main.js.
module.exports = async function runCommanderCycle(side, d) {
    const { state, engine, threatAnalysis, logger } = d;
    const mainWindow = d.getMainWindow();
    const persistence = d.getPersistence();
    const ui = (msg, type = 'info') => { if (mainWindow) mainWindow.webContents.send('log-message', msg, type); };

    const cState = state[side];
    if (!cState.forces || !cState.targets || !cState.territory || !engine) return;
    const { forces, targets, territory } = cState;

    if (!forces.activeGroups || !targets.targets || !territory.border) {
        ui(`Commander of ${side} is waiting for DCS telemetry...`, 'info');
        logger.info(`[processCommander] ${side} not ready: active=${!!forces.activeGroups} goals=${!!targets.targets} border=${!!territory.border}`);
        if (!cState.retryPending) {
            cState.retryPending = true;
            setTimeout(() => { cState.retryPending = false; d.retry(side); }, 10000);
        }
        return;
    }

    if (d.plan) d.plan.applyTo(targets, m => logger.info(`[plan] ${m}`));

    // Always evaluate posture (it also applies the loss-decay), even if the AI call ends up skipped
    const posture = threatAnalysis.getPostureRestriction(cState, side, state.escalationEnabled, mainWindow, persistence);

    let decision;
    try {
        decision = await engine.decide(side, {
            forces, targets, territory, posture,
            logs: cState.aiLogs,
            ballisticCount: persistence.getBallisticMissileCount(side),
            ballisticRangeKm: state.ballisticRangeKm,
            userContext: forces.instructions,
            unitProfiles: state.unitProfiles,
            reservedGroups: d.plan ? d.plan.reservedGroups(side) : null
        });
    } catch (err) {
        ui(`Commander of ${forces.coalition} error: ${err.message}`, 'error');
        logger.error('Commander cycle error:', err);
        return;
    }

    if (decision.error) { ui(`Commander of ${forces.coalition} error: ${decision.error}`, 'error'); return; }
    if (decision.skipped) {
        ui(`Commander of ${forces.coalition}: ${decision.reason}; AI call skipped (${decision.savedCalls} calls saved so far).`, 'info');
        return;
    }

    // Only logs that the commander has actually seen are consumed
    if (decision.logsConsumed) cState.aiLogs = cState.aiLogs.slice(decision.logsConsumed);
    cState.aiLogs = cState.aiLogs.slice(-30);

    const tag = decision.source === 'ai' ? `AI ${decision.tier}:${decision.model}` : 'RULES';
    const u = decision.usage;
    ui(`Commander of ${forces.coalition} [${tag}] (${decision.reason})` +
        (u ? ` ${u.input} in / ${u.output} out` + (u.thinking ? ` / ${u.thinking} thinking` : '') + ' tokens' : '') +
        ` | session: ${decision.costSummary}`, 'info');
    decision.rejected.forEach(r => ui(`Commander of ${forces.coalition}: order discarded - ${r}`, 'info'));

    const actions = decision.actions;
    if (actions.length > 0) {
        ui(`Commander of ${forces.coalition}: ${decision.mission_log}`, 'success');
        d.sendOrdersToDCS(side.toUpperCase(), actions);
        d.sendMessageToDCS(side.toUpperCase(), decision.mission_log);
        actions.forEach(action => {
            if (action.action_type === 'new' && action.unit_names) action.unit_names.forEach(n => forces.removeAvailableUnit(n));
            if (action.task === 'BALLISTIC') {
                persistence.consumeBallisticMissile(side, 1);
                ui(`Commander of ${forces.coalition} authorized a BALLISTIC MISSILE launch. Missiles remaining: ${persistence.getBallisticMissileCount(side)}`, 'info');
            }
        });
        d.triggerMapUpdate();
    } else {
        ui(`Commander of ${forces.coalition}: Monitoring. ${decision.mission_log}`, 'info');
        if (decision.mission_log) d.sendMessageToDCS(side.toUpperCase(), 'Monitoring. ' + decision.mission_log);
    }
};
