// Helper: Haversine distance formula (returns kilometers)
function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Helper: Find shortest distance from a point to any point on the border polygon
function getDistanceToBorder(lat, lon, border) {
    if (!border || border.length === 0) return 0;
    let minDist = Infinity;
    for (let pt of border) {
        let d = getDistanceKm(lat, lon, pt.lat, pt.long);
        if (d < minDist) minDist = d;
    }
    return minDist;
}

const OFFENSIVE = ['STRIKE', 'SEAD', 'CAS', 'ASSAULT', 'FIRE_SUPPORT', 'BALLISTIC'];

module.exports = {

    calculateBaseThreat: function(threats, territory) {

        let calculatedThreat = 0;
        threats.forEach(item => {
            let baseScore = item.threat_score || 0;
            let multiplier = 0;

            // 1. Check if the threat is inside our territory (hostile) or outside
            let isInside = false;
            if (territory && territory.border && territory.border.length > 0) {
                const check = territory.isTargetInFriendlyTerritory(item.location.lat, item.location.long);
                isInside = check.is_friendly_territory;
            }

            if (isInside) {
                multiplier = 2.0; // Amenaza crítica: Han cruzado la frontera
            } else {
                let distKm = getDistanceToBorder(item.location.lat, item.location.long, territory ? territory.border : null);
                const staticThreats = ["SAM", "AAA", "ARTILLERY", "EW", "RADAR"];
                const isStatic = staticThreats.includes(item.threat);

                if (isStatic) {
                    if (distKm < 20) multiplier = 0.5;
                    else if (distKm < 50) multiplier = 0.2;
                    else multiplier = 0;
                } else {
                    if (distKm < 30) multiplier = 1.0;
                    else if (distKm < 80) multiplier = 0.5;
                    else if (distKm < 150) multiplier = 0.1;
                    else multiplier = 0;
                }
            }

            item.threat_score = Math.round(baseScore * multiplier);
            calculatedThreat += (baseScore * multiplier);
        });

        return calculatedThreat;

    },

    /**
     * Returns a STRUCTURED posture (was: a plain prompt string):
     * { level: NONE|GREEN|YELLOW|RED_HOLD|RED_WAR, prompt, forbiddenTasks[], peacetimeOnly, totalThreat, recentLosses }
     * forbiddenTasks / peacetimeOnly are enforced in code by orderValidator.js and used to filter the brief.
     */
    getPostureRestriction: function(cState, side, escalationEnabled, mainWindow, persistence) {
        const posture = { level: 'NONE', prompt: '', forbiddenTasks: [], peacetimeOnly: false, totalThreat: 0, recentLosses: 0 };

        if (!escalationEnabled) return posture;

        const totalThreat = (cState.isrThreatScore || 0) + (cState.eventThreatBonus || 0);
        const recentLosses = cState.eventThreatBonus || 0;
        const coalitionName = side.toUpperCase();
        posture.totalThreat = totalThreat;
        posture.recentLosses = recentLosses;
        const log = (msg, type) => { if (mainWindow) mainWindow.webContents.send('log-message', msg, type); };

        if (recentLosses >= 100) {
            posture.level = 'RED_WAR';
            posture.prompt = `CURRENT THEATER THREAT POSTURE: [RED - TOTAL WAR (Score: ${Math.round(totalThreat)})]. FULL ESCALATION. The enemy has crossed the red line and inflicted unacceptable losses. All constraints lifted. You are authorized to pursue ANY goal, including those where peacetime_allowed is false.`;
            log(`Commander of ${coalitionName}: Diplomacy failed. Sustained losses confirmed (${recentLosses} pts). Escalating to RED posture.`, 'error');
        } else {
            if (totalThreat > 80) {
                const roll = Math.random() * 100;
                if (roll > cState.aggressiveness) {
                    posture.level = 'RED_HOLD';
                    posture.forbiddenTasks = [...OFFENSIVE, 'TRANSPORT_TROOPS', 'TRANSPORT_LOGISTICS'];
                    posture.prompt = `CRITICAL TEMPORARY THREAT POSTURE RESTRICTION FOR THIS CYCLE: offensive operations are ON HOLD by headquarters. FORBIDDEN: STRIKE, SEAD, CAS, ASSAULT, FIRE_SUPPORT, BALLISTIC, TRANSPORT_*. Only defensive, protective or support orders (CAP, INTERCEPT, RTB) to hold the line and preserve active units.`;
                    log(`Commander of ${coalitionName}: Threat posture check on hold (Roll: ${Math.round(roll)}% > Aggressiveness Threshold: ${cState.aggressiveness}%). Only defensive operations allowed for this cycle.`, 'info');
                } else {
                    posture.level = 'RED_WAR';
                    posture.prompt = `CURRENT THEATER THREAT POSTURE: [RED - TOTAL WAR (Score: ${Math.round(totalThreat)})]. FULL ESCALATION. All constraints lifted. You are authorized to pursue ANY goal, including those where peacetime_allowed is false. Focus on high-value strikes and ground invasions.`;
                    log(`Commander of ${coalitionName}: Posture is RED (Threat Score: ${Math.round(totalThreat)} > 80). ALL CONSTRAINTS LIFTED. FULL THEATER WAR DECLARED.`, 'success');
                }
            } else if (totalThreat >= 40 || recentLosses > 0) {
                posture.level = 'YELLOW';
                posture.peacetimeOnly = true;
                posture.forbiddenTasks = ['STRIKE', 'ASSAULT', 'FIRE_SUPPORT', 'BALLISTIC'];
                posture.prompt = `CURRENT THEATER THREAT POSTURE: [YELLOW - MEDIUM THREAT (Score: ${Math.round(totalThreat)})]. REACTIVE POSTURE. CAS and SEAD are authorized to suppress localized border threats. Only goals with "peacetime_allowed": true may be pursued.`;
                log(`Commander of ${coalitionName}: Posture is YELLOW (Threat Score: ${Math.round(totalThreat)}). Specialized support authorized. Only peacetime goals allowed.`, 'info');
            } else {
                posture.level = 'GREEN';
                posture.peacetimeOnly = true;
                posture.forbiddenTasks = [...OFFENSIVE];
                posture.prompt = `CURRENT THEATER THREAT POSTURE: [GREEN - LOW THREAT (Score: ${Math.round(totalThreat)})]. DEFENSIVE POSTURE. FORBIDDEN: STRIKE, SEAD, CAS, ASSAULT, FIRE_SUPPORT, BALLISTIC. Allowed: CAP, INTERCEPT, TRANSPORT_TROOPS, CSAR, RTB. Only goals with "peacetime_allowed": true may be pursued.`;
                log(`Commander of ${coalitionName}: Posture is GREEN (Threat Score: ${Math.round(totalThreat)} < 40). Only peacetime goals authorized.`, 'info');
            }
        }

        // Decaimiento acumulativo: restamos 5 puntos por ciclo
        if (cState.eventThreatBonus > 0) {
            cState.eventThreatBonus = Math.max(0, cState.eventThreatBonus - 5);
        }

        if (persistence.currentFile) {
            if (persistence.state.eventThreatBonus == null) persistence.state.eventThreatBonus = {};
            persistence.state.eventThreatBonus[side] = cState.eventThreatBonus;
            persistence.saveState();
        }

        return posture;
    }

};
