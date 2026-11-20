// Decides WHEN the (paid) LLM must be consulted: only if the situation changed.
const { actionableGoals, threatCounts, significantLogs } = require('./briefBuilder.js');

const bucket = n => (n <= 1 ? String(n) : n <= 3 ? '2-3' : '4+');
const bucketCounts = c => Object.keys(c).sort().map(k => `${k}:${bucket(c[k])}`).join(',');

// core: things that always justify a call. forces: our own order of battle (reacts only when out of cooldown)
function computeSignatures(ctx, opts = {}) {
    const { forces, targets, territory, posture } = ctx;
    const radius = opts.threatRadiusKm || 60;
    const goals = actionableGoals(targets, posture, opts.maxGoals || 4);
    const enemies = forces.enemyGroups || [];
    const inFriendly = e => !!territory.isTargetInFriendlyTerritory(e.lat, e.lon).is_friendly_territory;

    const goalThreats = goals.map(g => {
        const near = forces.getEnemyThreatsNearLocation(g.lat, g.lon, radius);
        return `${g.name}=${bucketCounts(near.threats ? threatCounts(near.threats, 'threat_class') : {})}`;
    });

    const core = JSON.stringify({
        posture: posture ? posture.level : 'NONE',
        ballistic: ctx.ballisticCount || 0,
        goals: goals.map(g => `${g.name}:${g.type}:${g.priority}`),
        goalThreats,
        intruders: bucketCounts(threatCounts(enemies.filter(inFriendly), 'threat'))
    });

    const active = {};
    (forces.activeGroups || []).forEach(g => (g.mission || []).forEach(m => { active[m] = (active[m] || 0) + 1; }));
    const summary = forces.getTheaterReservesSummary();
    const forcesSig = JSON.stringify({ active, reserves: summary.capabilities_summary || {} });
    return { core, forces: forcesSig };
}

class CommanderGate {
    constructor({ heartbeatCycles = 6, cooldownCycles = 2 } = {}) {
        this.heartbeat = heartbeatCycles;
        this.cooldown = cooldownCycles;
        this.s = {};
    }

    _st(side) {
        return this.s[side] || (this.s[side] = { lastCore: null, lastForces: null, sinceCall: 0, cool: 0, forceReason: null });
    }

    decide(side, sig, logs) {
        const s = this._st(side);
        let result;
        if (s.forceReason) result = { call: true, reason: s.forceReason };
        else if (s.lastCore === null) result = { call: true, reason: 'first cycle' };
        else if (sig.core !== s.lastCore) result = { call: true, reason: 'situation changed (goals/threats/posture)' };
        else if (significantLogs(logs).length > 0) result = { call: true, reason: 'significant battlefield events' };
        else if (sig.forces !== s.lastForces && s.cool <= 0) result = { call: true, reason: 'own force status changed' };
        else if (s.sinceCall >= this.heartbeat) result = { call: true, reason: 'periodic review' };
        else result = { call: false, reason: 'no relevant changes' };

        if (!result.call) {
            s.sinceCall++;
            if (s.cool > 0) { s.lastForces = sig.forces; s.cool--; }   // absorb own-order side effects during cooldown
        }
        return result;
    }

    // Call after the cycle was actually planned (AI or rules)
    markCalled(side, sig, { issued = false, retry = false } = {}) {
        const s = this._st(side);
        s.lastCore = sig.core;
        s.lastForces = sig.forces;
        s.sinceCall = 0;
        s.cool = issued ? this.cooldown : 0;
        s.forceReason = retry ? 'retry after rejected orders' : null;
    }
}

module.exports = { CommanderGate, computeSignatures };
