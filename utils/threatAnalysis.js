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
                /// TODO: 
            } else {
                // 2.b.1. Check how close is the threat to our border (in km)
                let distKm = getDistanceToBorder(item.location.lat, item.location.long, territory ? territory.border : null);
                    
                // 2.b.2. Differentiate between static(non-mobile)/defensive units and mobile/offensive units
                const staticThreats = ["SAM", "AAA", "ARTILLERY", "EW", "RADAR"];
                const isStatic = staticThreats.includes(item.threat);
                        
                if (isStatic) {
                    if (distKm < 20) multiplier = 0.5; // SAM/Artillería muy pegado a la frontera
                    else if (distKm < 50) multiplier = 0.2;
                    else multiplier = 0;               // SAM defensivo lejano (no amenaza nuestra postura)
                } else {
                    // Unidades móviles (CAP, STRIKE, HELO, ARMOR...)
                    if (distKm < 30) multiplier = 1.0;       // Peligrosamente cerca (inminente)
                    else if (distKm < 80) multiplier = 0.5;  // Aproximándose a la frontera
                    else if (distKm < 150) multiplier = 0.1; // Lejos, probablemente patrullando su espacio
                    else multiplier = 0;                     // Demasiado lejos
                }
            }
                
            item.threat_score = Math.round(baseScore * multiplier);
            calculatedThreat += (baseScore * multiplier);
        });

        return calculatedThreat;

    },

    getPostureRestriction: function(cState, side, escalationEnabled, mainWindow, persistence) {
        let restrictionPrompt = "";
        
        if (!escalationEnabled) return restrictionPrompt;

        const totalThreat = (cState.isrThreatScore || 0) + (cState.eventThreatBonus || 0);
        const recentLosses = cState.eventThreatBonus || 0;
        const coalitionName = side.toUpperCase();

        if (recentLosses >= 100) { 
            // There has been recent losses that justify a FULL WAR posture, regardless of the threat score
            restrictionPrompt += `\n\nCURRENT THEATER THREAT POSTURE: [RED - TOTAL WAR (Score: ${Math.round(totalThreat)})]. FULL ESCALATION. The enemy has crossed the red line and inflicted unacceptable losses. All constraints lifted. You are authorized to pursue ANY goal, including those where peacetime_allowed is false.`;
            mainWindow.webContents.send('log-message', `Commander of ${coalitionName}: Diplomacy failed. Sustained losses confirmed (${recentLosses} pts). Escalating to RED posture.`, 'error');
        } else {
            // Check current threat score to determine posture
            if (totalThreat > 80) { // RED POSTURE
                // Check if the aggressiveness threshold allows for offensive operations
                const roll = Math.random() * 100;
                if (roll > cState.aggressiveness) {
                    // Aggresiveness threshold roll failed: block offensive missions for this iteration
                    restrictionPrompt += `\n\nCRITICAL TEMPORARY THREAT POSTURE RESTRICTION FOR THIS CYCLE: Strategic offensive operations are currently ON HOLD due to headquarters command. You are STRICTLY FORBIDDEN from launching or tasking any new offensive, strike, or assault missions (such as "STRIKE", "SEAD", "CAS", "ASSAULT", or "TRANSPORT") against target in enemy territory. You may ONLY issue defensive, protective, or support orders (such as "CAP", "INTERCEPT", "DEFEND", or "RTB") to maintain the front line or preserve active units. Do not open new offensive fronts during this interval.`;
                    mainWindow.webContents.send('log-message', `Commander of ${coalitionName}: Threat posture check on hold (Roll: ${Math.round(roll)}% > Aggressiveness Threshold: ${cState.aggressiveness}%). Only defensive operations allowed for this cycle.`, 'info');
                } else {
                    // Escalate to FULL WAR due to aggresiveness threshold being met
                    restrictionPrompt += `\n\nCURRENT THEATER THREAT POSTURE: [RED - TOTAL WAR (Score: ${Math.round(totalThreat)})]. FULL ESCALATION. All constraints lifted. You are authorized to pursue ANY goal, including those where peacetime_allowed is false. Focus on high-value strikes and ground invasions.`;
                    mainWindow.webContents.send('log-message', `Commander of ${coalitionName}: Posture is RED (Threat Score: ${Math.round(totalThreat)} > 80). ALL CONSTRAINTS LIFTED. FULL THEATER WAR DECLARED.`, 'success');
                }
            } else if (totalThreat >= 40 || recentLosses > 0) { // YELLOW POSTURE
                restrictionPrompt += `\n\nCURRENT THEATER THREAT POSTURE: [YELLOW - MEDIUM THREAT (Score: ${Math.round(totalThreat)})]. Enemy activity or recent friendly losses have escalated the tension. You are in a REACTIVE POSTURE. You are authorized to launch close support missions ("CAS", "SEAD") to suppress localized border threats. CRITICAL: You may ONLY pursue goals that have "peacetime_allowed": true. Strategic wartime goals are still locked.`;
                mainWindow.webContents.send('log-message', `Commander of ${coalitionName}: Posture is YELLOW (Threat Score: ${Math.round(totalThreat)}). Specialized support authorized. Only peacetime goals allowed.`, 'info');
            } else {
                restrictionPrompt += `\n\nCURRENT THEATER THREAT POSTURE: [GREEN - LOW THREAT (Score: ${Math.round(totalThreat)})]. The situation is stable. You are strictly in a DEFENSIVE POSTURE. You are ABSOLUTELY FORBIDDEN from launching any new offensive missions (such as "STRIKE", "SEAD", "CAS", "ASSAULT"). You may ONLY launch or redirect units for defensive tasks ("CAP", "INTERCEPT", "DEFEND", "TRANSPORT_TROOPS", "RTB"). CRITICAL: You may ONLY pursue goals that have "peacetime_allowed": true. Ignore any goals where peacetime_allowed is false.`;
                mainWindow.webContents.send('log-message', `Commander of ${coalitionName}: Posture is GREEN (Threat Score: ${Math.round(totalThreat)} < 40). Only peacetime goals authorized.`, 'info');
            }
        }
        
        // Decaimiento acumulativo: Restamos 5 puntos por ciclo para enfriar el trauma de bajas si no pasa nada
        if (cState.eventThreatBonus > 0) {
            cState.eventThreatBonus = Math.max(0, cState.eventThreatBonus - 5);
        }

        if (persistence.currentFile) {
            if (persistence.cState.eventThreatBonus == null) persistence.cState.eventThreatBonus = {};
            persistence.cState.eventThreatBonus[side] = cState[side].eventThreatBonus;
            persistence.saveState();
        }

        return restrictionPrompt;
    }

};