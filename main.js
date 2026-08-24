const {app, BrowserWindow, ipcMain, dialog} = require('electron')
const path = require('path');
const net = require('net');
const os = require('os');
const fs = require('fs');

// Logger
const logger = require('./utils/log.js');

let mainWindow;
let processIntervalId = null;

// DCS connection
let dcsSocket = null;
let tcpServer = null;
let isListening = false;

// Gemini
const AiHelper = require('./utils/aiHelper.js');
const ai = new AiHelper();
let currentModelName = 'gemini-3.1-flash';
let authMethodGlobal = 'apikey';
let authCredentialGlobal = null;

// Persistence
const PersistenceManager = require('./utils/persistence.js');
let persistence = new PersistenceManager();
let activeDeployments = {};

// Commanders
const CoalitionArmedForces = require('./utils/coalitionArmedForces.js');
let redCoalition = null, blueCoalition = null;
const CoalitionTargets = require('./utils/coalitionTargets.js');
let redTargets = null, blueTargets = null;
const CoalitionTerritory = require('./utils/coalitionTerritory.js');
let redTerritory = null, blueTerritory = null;
const REBASE_INTERVAL = 30;
let cycleCount = 0;
let redActive = false, blueActive = false;

let state = {
    red: { forces: null, targets: null, territory: null, aiLogs: [] },
    blue: { forces: null, targets: null, territory: null, aiLogs: [] },
    ballisticRangeKm: 290
};

// Threat analysis
const threatAnalysis = require('./utils/threatAnalysis.js');

const defaultDoctrine = 'Maintain air superiority on our territory: launch defensive caps. Attack flights must have escort or cap.';
const getSystemInstructions = (userContext, unitProfiles, commanderSide) => {
    let profilesPrompt = "";
    
    if (unitProfiles && Array.isArray(unitProfiles) && unitProfiles.length > 0) {
        // Filtramos por bando
        const relevantProfiles = unitProfiles.filter(p => p.side === 'both' || p.side === commanderSide);
        
        if (relevantProfiles.length > 0) {
            const profilesList = relevantProfiles
                .map(p => {
                    let missionTag = '';
                    // Si hay misiones definidas y no incluyen 'ANY', las añadimos al prompt
                    if (p.mission && Array.isArray(p.mission) && !p.mission.includes('ANY')) {
                        missionTag = ` [Task: ${p.mission.join(', ')}]`;
                    }
                    return `- **${p.type}${missionTag}**: ${p.desc}`;
                })
                .join('\n');
                
            profilesPrompt = `\n# UNIT CAPABILITIES & LOADOUT PROFILES\nThe following unit types have specific capabilities or loadouts assigned for this operation. Factor these strengths into your tactical assignments:\n${profilesList}\n`;
        }
    }

    return `
# ROLE
You are a highly capable and conservative AI Theater Commander for a DCS World mission. Your goal is to manage coalition assets to achieve strategic goals while minimizing losses.

${profilesPrompt}

# STRATEGIC CONTEXT & COMMANDER INTENT
The following specific doctrine, posture, and goals have been dictated for your coalition. You must prioritize this intent while strictly obeying the critical constraints below:
${userContext}

# DATA INPUTS
1. goals: Current tactical objectives (including secondary logistical/resupply goals).
2. active_assets: Units already in the field (can be redirected or RTB).
3. available_assets: Reserve units ready for new tasking.
4. isr_report: Enemy contacts detected by intelligence.

# JOINT OPERATIONS & COMBINED ARMS
- **CONQUER GOALS:** To achieve a 'conquer' type goal, you MUST deploy "TRANSPORT_TROOPS" to the area to deploy occupying infantry.
- **BORDER CROSSINGS (CHOKE POINTS):** If the final "target_area" for an "ASSAULT" or "TRANSPORT_TROOPS" task is in enemy territory, check your active goals list. IF a "border_crossing" goal exists, you MUST route the ground forces through it by putting its exact name in the "route_via" field. IF NO "border_crossing" goals exist in the theater, you may ignore this rule, leave "route_via" as null, and they will proceed directly.
- **COMBINED ARMS:** Ground units are vulnerable. Follow these deployment rules:
  1. DO NOT send "ASSAULT" (Armor/IFVs) or "TRANSPORT_TROOPS" into a zone without establishing local Air Superiority (CAP) or without softening the target via "CAS", "STRIKE", or "FIRE_SUPPORT".
  2. "ASSAULT" acts as the spearhead. They clear the area of enemy ground resistance. "TRANSPORT_TROOPS" should follow them or be sent only after the area is safe.
- **ARTILLERY POSITIONING:** "FIRE_SUPPORT" units are fragile. Do NOT assign them the exact coordinates of the enemy target. Calculate and assign a "target_area" that is a safe standoff distance (approx 10-20km away).

# CRITICAL CONSTRAINTS - DOCTRINE & RULES

## 1. MANDATORY MISSION VALIDATION (ZERO-TOLERANCE)
- **THE MISSION ARRAY IS THE ONLY SOURCE OF TRUTH FOR CAPABILITIES.** You are UNMISTAKABLY FORBIDDEN from assigning a 'task' to a unit unless that task is explicitly listed in the unit's 'mission' array within 'available_assets'.
- Note: "AWACS", "TANKER", "EW", "SAM", and "AAA" are autonomous. You CANNOT task them.
- If no available unit possesses the required capability for a high-priority goal, log the failure in 'mission_log' and DO NOT issue the order.

## 2. RULE OF TWO (FLIGHT COMPOSITION)
- All NEW air groups must consist of exactly 2 units. 
- Ground units and Helicopters may be tasked in groups of 1 or more depending on availability and threat level. 

## 3. ACTION TYPES & RECALL
- "new": Tasking units from 'available_assets'. Requires 'location', 'airbase', 'unit_count', and an array of 'unit_names'. CRITICAL: Do not assign the same static ID to multiple different actions.
- "existing": Redirecting units from 'active_assets'. Requires 'group_name' (the 'id' from active_assets). Omit 'unit_names'. The 'task' must remain exactly the same as its current active mission, OR be set to "RTB" (units cannot change armaments mid-flight).

## 4. CONSERVATIVE STRATEGY
- **PROACTIVE DEPLOYMENT:** Launch minimum required assets to achieve goals even if the ISR report is empty.
- **ECONOMY OF FORCE:** Deploy only the minimum force necessary. Do not over-commit. Maintain a baseline of 20-50% of available units in reserve.
- **GO/NO-GO LOGIC:** If available assets are insufficient to meet a high-priority threat safely, you MUST choose NOT to deploy. Preserving the force is a valid strategic victory.
- **RADAR MASKING (LOST CONTACTS):** If an enemy contact suddenly drops off the ISR report, DO NOT immediately order your interceptors to RTB. Let your active fighters continue their sweep.
- **FALLBACK TACTICS:** If outnumbered or in an escalation spiral, execute fallback strategies:
  1. **Retreat and Lure:** Lure enemy fighters into your SAM umbrellas.
  2. **Rely on Ground Defenses:** Stop spawning air assets and let SAM/AAA deal with the threat.
  3. **Asymmetric Strike:** Spawn STRIKE, SEAD, or CAS to attack vulnerable enemy infrastructure while they focus on Air-to-Air.
- **MAXIMUM SIMULTANEOUS GOALS (STRICT LIMIT):** You are ABSOLUTELY FORBIDDEN from pursuing more than 2 strategic goals at the same time. Prioritize the top 2 highest priority goals from the list. Even if you have ample available reserves, completely ignore any lower-priority goals until one of your top 2 goals is completely resolved or achieved. Focus your intelligence checks and deployments strictly on a maximum of 2 active objectives to maintain economy of force.

## 5. TASKS

*AIR & NAVAL TASKS:*
- "INTERCEPT": Fixed-wing only. Intercept enemy aircraft or helicopters. Provide expected interception coordinates in "target_area" and the enemy group name in "reference_entity".
- "CAP": Fixed-wing only. Secure an area generally. Provide area center in "target_area".
- "SEAD": Fixed-wing only. Destroy enemy SAMs/Air Defenses. Provide approximate SAM coordinates in "target_area".
- "CAS": Fixed-wing or Helicopters. Destroy active ground targets (moving or deployed) to support ground forces.
- "STRIKE": Fixed-wing only. Attack specific static high-value ground targets (runways, warehouses, ports, fixed EW radars, or fixed SAM sites). Provide exact coordinates in "target_area".
- "ANTI-SHIP": Fixed-wing only. Attack enemy ships. Provide target location in "target_area".
- "ESCORT": Fixed-wing (to escort other planes) or Helicopters (to escort ground units/transport). Provide the escorted group in "reference_entity".
- "CSAR": Helicopters only. Rescue downed pilots. Provide search area in "target_area" and pilot name in "reference_entity".
- "RTB": Command an active group to return to base to preserve forces.

*GROUND & LOGISTICS TASKS:*
- "ASSAULT": Spearhead ground attacks using heavy armor/combat vehicles. Route them directly into the "target_area" to destroy enemy ground presence before transports arrive.
- "TRANSPORT_TROOPS": Fixed-wing, Helicopters, or Ground vehicles. Deploy infantry to conquer and hold a specific position. Route them to the "target_area".
- "TRANSPORT_LOGISTICS": Fixed-wing, Helicopters, or Ground vehicles. Resupply units (e.g., SAMs without missiles, troops holding a point) or deliver materials to build new SAM sites. Provide target location in "target_area".
- "FIRE_SUPPORT": Long-range bombardment (Artillery). Route them to a safe standoff "target_area" (10-20km away).
- "BALLISTIC": Ground-based strategic missiles. Launch against heavily defended, static high-value targets. Do NOT use against moving targets. Provide specific coordinates in "target_area".

## 6. GOALS
- "strike": Specific static coordinates or fixed high-value targets must be destroyed.
- "csar": Specific units in assetsInvolved must be rescued.
- "enemy-csar": Specific downed enemy units in assetsInvolved must be destroyed.
- "conquer": "TRANSPORT_TROOPS" must be moved to the specific coordinates to deploy infantry and occupy the zone. "ASSAULT" should clear the area first.
- "resupply": "TRANSPORT_LOGISTICS" must be sent to coordinates to re-arm units or build infrastructure.
- "border_crossing": A strategic choke point. In peacetime, deploy infantry here to secure it. In wartime, ASSAULT forces must route through these points to invade enemy territory.
- "deploy_infantry": "TRANSPORT_TROOPS" must be sent to these coordinates to drop off defensive infantry.

# OUTPUT CONTRACT
When you have gathered all necessary intelligence and are ready to issue your orders, you MUST call the 'submit_commander_orders' tool. 
Pass your 'mission_log' and your 'actions' array directly into the parameters of that tool. 
DO NOT generate raw JSON blocks or plain text outside of tool calls.
`;
}

function startServer() {
    // Prevent trying to start multiple servers on the same port
    if (isListening) {
        logger.info("Server is already running.");
        return;
    }

    tcpServer = net.createServer((socket) => {
        dcsSocket = socket;
        logger.info("DCS World connected to AEM Commander.");
        let buffer = '';
        
        // Send the kill list to DCS immediately upon connection
        const destroyedUnits = persistence.getDestroyedUnits();
        if (destroyedUnits.length > 0) {
            const payload = JSON.stringify({
                type: "ORDERS",
                coalition: "ALL", // We use ALL to let Lua handle it globally
                actions: [{
                    action_type: "persistence_destroy",
                    unit_names: destroyedUnits
                }]
            });
            socket.write(payload + "\n");
        }

        if (persistence.state.eventThreatBonus) {
            state.red.eventThreatBonus = persistence.state.eventThreatBonus.red || 0;
            state.blue.eventThreatBonus = persistence.state.eventThreatBonus.blue || 0; 
        }

        socket.on('data', (data) => {
            buffer += data.toString();
            let lines = buffer.split('\n');
            buffer = lines.pop();
            
            for (let line of lines) {
                if(line.trim() === '') continue;
                try {
                    let msg = JSON.parse(line);
                    routeDCSMessage(msg);
                } catch(e) { logger.error("Error parsing JSON from DCS", e); }
            }
        });

        socket.on('close', () => {
            logger.info("DCS World disconnected.");
            dcsSocket = null;
            
            if (processIntervalId) {
                clearInterval(processIntervalId);
                processIntervalId = null;
            }
            
            state.red.forces = null; 
            state.red.aiLogs = [];
            state.red.targets = null;
            state.red.territory = null;
            state.blue.forces = null;
            state.blue.aiLogs = [];
            state.blue.targets = null;
            state.blue.territory = null;
            
            persistence = new PersistenceManager();
            activeDeployments = {};
            
            if (mainWindow) {
                mainWindow.webContents.send('log-message', 'DCS Mission ended. Operations suspended automatically.', 'success');
            }
            
        });
        
        socket.on('error', (err) => {
            logger.info(err);
            dcsSocket = null;
            
            if (processIntervalId) {
                clearInterval(processIntervalId);
                processIntervalId = null;
            }
            
            state.red.forces = null; 
            state.red.aiLogs = [];
            state.red.targets = null;
            state.red.territory = null;
            state.blue.forces = null;
            state.blue.aiLogs = [];
            state.blue.targets = null;
            state.blue.territory = null;
            
            persistence = new PersistenceManager();
            activeDeployments = {};
            
            if (mainWindow) {
                mainWindow.webContents.send('log-message', 'Error. Operations suspended automatically.', 'error');
            }
            
        });
        
    });

    tcpServer.listen(49080, '0.0.0.0', () => {
        isListening = true;
        logger.info('TCP Server listening on port 49080');
    });

    // Handle errors (like port already in use)
    tcpServer.on('error', (err) => {
        logger.error('Server error:', err);
        isListening = false;
    });
}

function stopServer() {
    if (tcpServer && isListening) {
        tcpServer.close(() => {
            isListening = false;
            tcpServer = null;
            logger.info('TCP Server stopped.');
        });
    }
}

function sendOrdersToDCS(coalition, actions) {
    if(dcsSocket) {
        const payload = JSON.stringify({ type: "ORDERS", coalition, actions });
        dcsSocket.write(payload + "\n");
    }
}

function sendMessageToDCS(coalition, text) {
    if(dcsSocket) {
        const payload = JSON.stringify({ type: "MESSAGE", coalition, text });
        dcsSocket.write(payload + "\n");
    }
}

function routeDCSMessage(msg) {
    const coal = msg.coalition.toLowerCase();
	
	if (msg.type === "INIT") {
        const incomingMission = msg.data.mission_name;
        
        if (msg.data.ballistic_range) {
            state.ballisticRangeKm = Math.floor(msg.data.ballistic_range / 1000);
            logger.info(`Dynamic Ballistic Missile Range set to: ${state.ballisticRangeKm} km`);
        }

        if (persistence.currentFile) {
            if (incomingMission !== persistence.state.mission_info?.mission_name) {
                mainWindow.webContents.send('log-message', `WARNING: Loaded save file is for '${persistence.state.mission_info?.mission_name}', but DCS loaded '${incomingMission}'.`, 'error');
            } else {
                mainWindow.webContents.send('log-message', `Persistence verified for mission: ${incomingMission}`, 'success');
            }
            
            // Check the kill list
            const destroyedUnits = persistence.getDestroyedUnits();

            // Check CSAR missions
            const downedPilots = persistence.state.csar ? Object.keys(persistence.state.csar).map(name => ({ 
                name: name, 
                lat: persistence.state.csar[name].lat, 
                lon: persistence.state.csar[name].lon, 
                coalition: persistence.state.csar[name].coalition 
            })) : [];
            if (downedPilots.length > 0) {
                // Clear csar state; they will be re-registered by DCS when spawned to avoid ghost entries
                persistence.state.csar = {};
                persistence.saveState();
            }

            // Send actions inmediatelly to DCS
            const actions = [];
            if (destroyedUnits.length > 0) {
                actions.push({ action_type: "persistence_destroy", unit_names: destroyedUnits });
            }
            if (downedPilots.length > 0) {
                actions.push({ action_type: "persistence_csar", pilots: downedPilots });
            }

            if (actions.length > 0) {
                sendOrdersToDCS("ALL", actions);
            }
        } else {
            mainWindow.webContents.send('log-message', `DCS Mission '${incomingMission}' connected without a persistence file.`, 'info');
        }
        return; // INIT doesn't need to go to AI commanders
    }
	
	// We process destroyed events HERE so it works even if AI commanders are offline.
	if (msg.type === "EVENTS") {
        let stateChanged = false;
        msg.data.forEach(event => {
            // 1. Check out statics when a flight is activated
            if (event.type === 'activated' && event.group?.name && event.staticUnits) {
                // Store the array of static names under the active group's name
                activeDeployments[event.group.name] = [...event.staticUnits];
            }

            // 2. Handle combat deaths
            if (event.type === 'destroyed' && event.groupName) {
                
                // Mark the specific unit as dead for the persistence file
                persistence.markUnitAsDestroyed(event.unitName);
                stateChanged = true;
                logger.info(`Unit destroyed. Flagged '${event.unitName}' as dead.`);
                
                // Handle the AI Commander's reserve ledger using the group name
                if (event.groupName && activeDeployments[event.groupName] && activeDeployments[event.groupName].length > 0) {
                    
                    // Pop exactly ONE static unit from the ledger for this death
                    const consumedStatic = activeDeployments[event.groupName].pop();
                    persistence.markUnitAsDestroyed(consumedStatic);
                    stateChanged = true;
                    logger.info(`Commander unit destroyed. Flagged static reserve '${consumedStatic}' as dead.`);
                    
                }
            }

            // 3. Handle downed pilots persistence
            if (event.type === 'csar') {
                if (!persistence.state.csar) persistence.state.csar = {};
                persistence.state.csar[event.name] = { lat: event.lat, lon: event.lon, coalition: event.coalition.toLowerCase() };
                stateChanged = true;
                logger.info(`Downed pilot recorded: '${event.name}'.`);
            }
            
            // 4. Handle pilot rescues
            if (event.type === 'rescued') {
                if (persistence.state.csar && persistence.state.csar[event.name]) {
                    delete persistence.state.csar[event.name];
                    stateChanged = true;
                    logger.info(`Pilot rescued. Removed '${event.name}' from tracking.`);
                }
            }
        });
		
        // Update state and notify renderer if any changes occurred
		if (stateChanged && persistence.currentFile) {
            persistence.saveState();
            if (mainWindow) {
                mainWindow.webContents.send('persistence-updated', persistence.state.mission_info.updated_at);
            }
        }
    }
	
    if (!state[coal].forces) return;

    switch (msg.type) {
        case "ACTIVE":
            state[coal].forces.updateActiveGroups(msg.data);	
            break;
        case "AVAILABLE":
            state[coal].forces.updateAvailableUnits(msg.data);
            break;
        case "ISR":
            state[coal].isrThreatScore = threatAnalysis.calculateBaseThreat(msg.data, state[coal].territory);
			state[coal].forces.updateISR(msg.data);
            break;
        case "GOALS":
            state[coal].targets.updateGoals(msg.data);
            break;
        case "BORDER":
            state[coal].territory.updateBorder(msg.data);
            break;
		case "EVENTS":
            const forces = state[coal].forces;
            const targets = state[coal].targets;
            
            for (let i = 0; i < msg.data.length; i++) {
                const event = msg.data[i];
                const eventCoalition = event.coalition.toLowerCase();
                
                if (eventCoalition !== coal) continue; 

                switch (event.type) {
                    case 'activated':
                        const arrayStatics = event.staticUnits;
                        forces.addActiveGroup(
                            event.group.name, event.group.type, event.group.category,
                            event.group.mission, event.group.lat, event.group.lon,
                            event.group.airbase, arrayStatics.length
                        );
                        arrayStatics.forEach(name => forces.removeAvailableUnit(name));
                        state[coal].aiLogs.push(`The new flight ${event.group.name} has successfully launched from ${event.group.airbase}`);
						
						logger.info(`The new flight ${event.group.name} has successfully launched from ${event.group.airbase}`);
						
                        break;
                        
                    case 'destroyed':
						state[coal].eventThreatBonus = (state[coal].eventThreatBonus || 0) + 20;
                        if (!forces.activeUnitDestroyed(event.groupName)) {
                            state[coal].aiLogs.push(`All units from ${event.groupName} have been destroyed, this group has been destroyed`);
                        } else {
                            state[coal].aiLogs.push(`A unit from ${event.groupName} has been destroyed`);
                        }
                        if (persistence.currentFile) {
                            if (persistence.state.eventThreatBonus == null) persistence.state.eventThreatBonus = {};
                            persistence.state.eventThreatBonus[coal] = state[coal].eventThreatBonus;
                            persistence.saveState();
                        }
                        break;
                        
                    case 'csar':
                        if (eventCoalition === forces.coalition) {
							state[coal].eventThreatBonus = (state[coal].eventThreatBonus || 0) + 30;
                            targets.addTarget(`csar-${event.name}`, 999, 'csar', event.lat, event.lon, null);
                            state[coal].aiLogs.push('One of our pilots has ejected safely and needs to be rescued. A new csar mission has been added to the targets list');
                            if (persistence.currentFile) {
                                if (persistence.state.eventThreatBonus == null) persistence.state.eventThreatBonus = {};
                                persistence.state.eventThreatBonus[coal] = state[coal].eventThreatBonus;
                                persistence.saveState();
                            }
                        } else {
                            targets.addTarget(`enemy csar-${event.name}`, 0.5, 'enemy-csar', event.lat, event.lon, null);
                            state[coal].aiLogs.push('An enemy pilot has ejected safely. A new enemy-csar mission has been added to the targets list');
                        }
                        break;
                        
                    case 'rescued':
                        if (eventCoalition === forces.coalition) {
                            if (targets.removeTarget(event.name)) {
                                state[coal].aiLogs.push(`The CSAR mission to rescue ${event.name} has been a success`);
                            }
                        } else {
                            if (targets.removeTarget(`enemy csar-${event.name}`)) {
                                state[coal].aiLogs.push(`The enemy csar mission has rescued ${event.name}`);
                            }
                        }
                        break;
                        
                    case 'land':
                        if (forces.removeActiveGroup(event.groupName)) {
                            state[coal].aiLogs.push(`The group ${event.groupName} has landed safely and is no longer active. They are entering turnaround for rearm/refuel.`);
                        }
                        break;
					
					case 'captured':	// Zone has been captured
						/// TODO:
						break;
						
					case 'mission_completed':
						if (event.status === 'SUCCESS') {
							state[coal].aiLogs.push(`The ${event.task} mission by ${event.groupName} against ${event.targetName} was a SUCCESS.`);
							
                            // 1. Identificar al enemigo y buscar en su lista de objetivos
                            const enemyCoalition = coal === 'red' ? 'blue' : 'red';
                            const enemyTargetsList = state[enemyCoalition].targets?.targets || [];
                            
                            // Buscar el objetivo destruido (DCS lo exporta usando la propiedad 'id' o 'name')
                            const targetData = enemyTargetsList.find(t => t.id === event.targetName || t.name === event.targetName);
                            
                            // 2. Si el objetivo destruido era un almacén de misiles
                            if (targetData && targetData.type === 'bm_depot') {
                                const depotCapacity = parseInt(targetData.bm_count) || 0;
                                const actualLost = persistence.destroyBallisticMissiles(enemyCoalition, depotCapacity);
                                
                                // Informar a ambos comandantes con sus respectivos enfoques
                                state[coal].aiLogs.push(`INTEL CONFIRMS: Enemy ballistic missile depot destroyed! Estimated up to ${depotCapacity} missiles eliminated.`);
                                state[enemyCoalition].aiLogs.push(`CRITICAL ALERT: Our ballistic missile depot ${event.targetName} was destroyed by enemy forces! We lost ${actualLost} missiles.`);
                                
                                logger.info(`[AEM] ${enemyCoalition} lost ${actualLost} ballistic missiles due to depot strike.`);
                            }
                            
                            // 3. Eliminar el objetivo completado
							targets.removeTarget(event.targetName);
						} else {
							state[coal].aiLogs.push(`The ${event.task} mission by ${event.groupName} against ${event.targetName} FAILED. Assess if a re-strike is necessary.`);
						}
						break;
                }
            }
            break;
    }
	
	triggerMapUpdate();
	
}

function triggerMapUpdate() {
    if (!mainWindow) return;

    const cleanState = {
        red: {
            forces: {
                activeGroups: state.red.forces ? state.red.forces.activeGroups : null,
                enemyGroups: state.red.forces ? state.red.forces.enemyGroups : null,
				availableUnits: state.red.forces ? state.red.forces.availableUnits : null
            },
            targets: {
                targets: state.red.targets ? state.red.targets.targets : null
            },
            territory: {
                border: state.red.territory ? state.red.territory.border : null
            }
        },
        blue: {
            forces: {
                activeGroups: state.blue.forces ? state.blue.forces.activeGroups : null,
                enemyGroups: state.blue.forces ? state.blue.forces.enemyGroups : null,
				availableUnits: state.blue.forces ? state.blue.forces.availableUnits : null
            },
            targets: {
                targets: state.blue.targets ? state.blue.targets.targets : null
            },
            territory: {
                border: state.blue.territory ? state.blue.territory.border : null
            }
        }
    };

    try {
        const serializedData = JSON.parse(JSON.stringify(cleanState));
        mainWindow.webContents.send('update-map', serializedData);
    } catch (e) {
        logger.error("Error serializing map state:", e);
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280, height: 900,
		icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
	mainWindow.maximize();
	mainWindow.setMenu(null);
    mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));
}

async function processCommander(side) {
	
	const cState = state[side];
    if (!cState.forces || !cState.targets || !cState.territory) return;
    
    const forces = cState.forces;
    const targets = cState.targets;
    const territory = cState.territory;

    if (!forces.activeGroups || !targets.targets || !territory.border) {
        mainWindow.webContents.send('log-message', `Commander of ${side} is waiting for DCS telemetry...`, 'info');
	logger.info("[processCommander] not ready: " + forces.activeGroups + " + " + forces.targets + " - " + forces.border);
		setTimeout(() => processCommander(side), 10000);
        return;
    }
	
	const restrictionPrompt = threatAnalysis.getPostureRestriction(cState, side, state.escalationEnabled, mainWindow, persistence);
    const ballisticCount = persistence.getBallisticMissileCount(side);
    const strategicInventory = ballisticCount > 0 ? `\nSTRATEGIC WEAPONS INVENTORY: You currently have ${ballisticCount} ballistic missiles available. Do not order a "BALLISTIC" task if you have 0.
CRITICAL RULES FOR BALLISTIC MISSILES:
1. 1 LAUNCHER = 1 MISSILE: To fire, you must issue an "existing" action targeting ONE specific capable launcher group from your 'active_assets'.
2. RANGE LIMIT: Launchers have a STRICT MAXIMUM RANGE of ${state.ballisticRangeKm}km. You MUST calculate the approximate distance between the launcher's location and the target.
3. INVENTORY & ASSET LIMITS: You cannot fire more missiles than your total inventory, nor can you fire more missiles than the number of capable launchers currently within range.\n` : `STRATEGIC WEAPONS INVENTORY: You currently have ${ballisticCount} ballistic missiles available so you can not order a "BALLISTIC" task.\n`;
	
	if (forces.session == null) {
		
		try {
			// Pasamos el método y la credencial a tu initModel
            forces.model = ai.initModel(authMethodGlobal, authCredentialGlobal, currentModelName, getSystemInstructions(forces.instructions, state.unitProfiles, side));
            forces.session = ai.startChatSession(forces.model);
			mainWindow.webContents.send('log-message', `Commander of ${forces.coalition} is monitoring the battlefield`, 'success');

			// Get initial orders
			try {
				const prompt = `
The battlefield simulation has started.
You are the active Theater Commander.

1. Use 'get_top_priority_goals' to retrieve your current objectives. You have a STRICT MAXIMUM of 25 tool call rounds to gather intelligence before issuing orders.
2. MACRO-INTEL OVERRIDE: To evaluate a specific target, you MUST prioritize the 'get_full_tactical_intel' tool. This single tool gives you territory status, enemy threats, closest reserves, and SAM cover all at once.
3. Use atomic tools (like 'get_enemy_threats_near_location' or 'is_target_in_friendly_territory') ONLY for isolated, specific checks outside of a target evaluation.
4. When you have gathered enough intelligence, issue your final orders.
5. DO NOT brute-force 'get_active_groups_by_mission'. If you need to see your deployed assets to redirect them, use 'get_all_active_groups' ONCE.

CRITICAL: To finalize your turn, you MUST call the 'submit_commander_orders' tool. If no action is needed, call the tool with an empty actions array [].`;
				const aiRawResponse = await ai.sendChatUpdate(prompt + restrictionPrompt + strategicInventory, forces, targets, territory);
				const jsonOutput = JSON.parse(aiRawResponse);
				if (jsonOutput && jsonOutput.actions) {
					mainWindow.webContents.send('log-message', `Commander of ${forces.coalition} Journal: ${jsonOutput.mission_log}`, 'success');
					sendOrdersToDCS(side.toUpperCase(), jsonOutput.actions);
                    sendMessageToDCS(side.toUpperCase(), jsonOutput.mission_log);
					jsonOutput.actions.forEach(action => {
                        if (action.action_type === 'new' && action.unit_names) {
                            action.unit_names.forEach(unitName => {
                                forces.removeAvailableUnit(unitName);
                            });
                        }
                        if (action.task === 'BALLISTIC') {
                            persistence.consumeBallisticMissile(side, 1);
                            mainWindow.webContents.send('log-message', `Commander of ${forces.coalition} authorized a BALLISTIC MISSILE launch. Missiles remaining: ${persistence.getBallisticMissileCount()}`, 'info');
                        }
                    });
                    triggerMapUpdate();
				}
			} catch (err) {
				mainWindow.webContents.send('log-message', `Commander of ${forces.coalition} error: ${err.message}`, 'error');
				return;
			}
		} catch (err) {
			logger.info(err);
			mainWindow.webContents.send('log-message', `Failed to initialize model for ${forces.coalition}: ${err.message}`, 'error');
			forces.session = null;
			return;
		}
		
	} else {
		
		try {
			const logForAI = [...cState.aiLogs];
			cState.aiLogs = [];
			
			mainWindow.webContents.send('log-message', `Commander of ${forces.coalition} receiving battlefield updates...`, 'info');
			
            const updatePrompt = `
SITUATION UPDATE: The battlefield state has changed based on new intelligence and events.

RECENT BATTLEFIELD EVENTS:
${logForAI.length > 0 ? logForAI.join('.\n') : "ISR contacts updated. Review new intelligence."}

1. REVIEW HISTORY: Consider your previous 'mission_log' and the orders you recently issued. Do not issue duplicate orders to units already task-saturated.
2. ASSESS NEW DATA: Prioritize the 'get_full_tactical_intel' macro-tool to evaluate active targets quickly and conserve your tool call budget. Use individual atomic tools only for specific, isolated queries.
3. TAKE ACTION: 
   - Issue 'new' orders to available assets to respond to unhandled threats or unfulfilled goals.
   - Issue 'RTB' commands to 'existing' active units if their goal is complete, or if the threat level has become unsurvivable.
4. If the current situation is nominal and your previous orders are still sufficient, simply return {"mission_log": "Situation nominal, continuing execution of previous orders.", "actions": []}.
5. DO NOT brute-force 'get_active_groups_by_mission'. If you need to see your deployed assets to redirect them, use 'get_all_active_groups' ONCE.

CRITICAL: To finalize your turn, you MUST call the 'submit_commander_orders' tool. If no action is needed, call the tool with an empty actions array [].`;
			
			const aiRawResponse = await ai.sendChatUpdate(updatePrompt + restrictionPrompt + strategicInventory, forces, targets, territory);
            const jsonOutput = ai.aiSanitizeJson(aiRawResponse);
			
			if (jsonOutput && jsonOutput.actions && jsonOutput.actions.length > 0) {
				mainWindow.webContents.send('log-message', `Commander of ${forces.coalition}: ${jsonOutput.mission_log}`, 'success');
				sendOrdersToDCS(side.toUpperCase(), jsonOutput.actions);
                sendMessageToDCS(side.toUpperCase(), jsonOutput.mission_log);
				jsonOutput.actions.forEach(action => {
                    if (action.action_type === 'new' && action.unit_names) {
                        action.unit_names.forEach(unitName => {
                            forces.removeAvailableUnit(unitName);
                        });
                    }
                    if (action.task === 'BALLISTIC') {
                        persistence.consumeBallisticMissile(side, 1);
                        mainWindow.webContents.send('log-message', `Commander of ${forces.coalition} authorized a BALLISTIC MISSILE launch. Missiles remaining: ${persistence.getBallisticMissileCount()}`, 'info');
                    }
                });
                triggerMapUpdate();
			} else if (jsonOutput) {
				mainWindow.webContents.send('log-message', `Commander of ${forces.coalition}: Monitoring. ${jsonOutput.mission_log}`, 'info');
                sendMessageToDCS(side.toUpperCase(), "Monitoring. " + jsonOutput.mission_log);
			} else {
				mainWindow.webContents.send('log-message', `Commander of ${forces.coalition}: AI failed to determine what to do in time.`, 'error');
			}
			
			// 5. Rebase context every few cycles to keep the AI's memory clean
			cycleCount++;
			if (cycleCount % REBASE_INTERVAL === 0) {
			   forces.session = await ai.rebaseChatSession(forces.model, forces.session, 4);
			}
				
		} catch (err) {
            mainWindow.webContents.send('log-message', `Commander of ${forces.coalition} error during update: ${err.message}`, 'error');
        }
		
	}
}

// UI Handlers

ipcMain.handle('select-json-file', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });
    if (canceled) return null;
    return filePaths[0];
});

ipcMain.handle('select-and-start', async (event, authMethod, authCredential, modelName, commanderSide, instructionsRed, instructionsBlue, intervalTime, aggRed, aggBlue, enableEscalation, bmRed, bmBlue, unitProfiles) => {
	
    startServer();

	authMethodGlobal = authMethod;
    authCredentialGlobal = authCredential;
	currentModelName = modelName;
	
	state.escalationEnabled = enableEscalation;

    if (persistence.currentFile) {
        if (!persistence.state.mission_info) persistence.state.mission_info = {};
        persistence.state.mission_info.instructionsRed = instructionsRed;
        persistence.state.mission_info.instructionsBlue = instructionsBlue;
        persistence.setBallisticMissiles(bmRed, bmBlue);
        persistence.state.mission_info.unitProfiles = unitProfiles;
        persistence.saveState();
    }

    state.unitProfiles = unitProfiles;
	
    if (commanderSide === 'red' || commanderSide === 'both') {
        state.red.forces = new CoalitionArmedForces('red', instructionsRed);
        state.red.targets = new CoalitionTargets('red');
        state.red.territory = new CoalitionTerritory('red');
		state.red.aggressiveness = aggRed;
		state.red.isrThreatScore = 0;
		state.red.eventThreatBonus = 0;
    }
    if (commanderSide === 'blue' || commanderSide === 'both') {
        state.blue.forces = new CoalitionArmedForces('blue', instructionsBlue);
        state.blue.targets = new CoalitionTargets('blue');
        state.blue.territory = new CoalitionTerritory('blue');
		state.blue.aggressiveness = aggBlue;
		state.blue.isrThreatScore = 0;
		state.blue.eventThreatBonus = 0;
    }
	
	const intervalMs = intervalTime * 1000;
	
	if (processIntervalId) clearInterval(processIntervalId);
    
    let isProcessing = false;
    processIntervalId = setInterval(async () => {
        // Prevent overlapping if the API takes longer than the interval time
        if (isProcessing) {
            logger.info("Previous commander cycle still running. Skipping this interval.");
            return;
        }
        
        isProcessing = true;
        try {
            // Run Red Commander first
            if (state.red.forces) {
                await processCommander('red');
            }
            
            // If both commanders are active, add a delay (e.g., 10 seconds) to prevent 429 burst limits
            if (state.red.forces && state.blue.forces) {
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
            
            // Run Blue Commander second
            if (state.blue.forces) {
                await processCommander('blue');
            }
        } catch (err) {
            logger.error("Error in commander execution loop:", err);
        } finally {
            isProcessing = false;
        }
    }, intervalMs);
	
	return true;
});

ipcMain.handle('stop-monitor', () => {
    if (processIntervalId) {
        clearInterval(processIntervalId);
        processIntervalId = null;
    }
	state.red.forces = null; 
    state.blue.forces = null;
	persistence = new PersistenceManager();
    activeDeployments = {};
    mainWindow.webContents.send('log-message', 'Operations suspended by user.', 'info');
    stopServer();
    return true;
});

ipcMain.handle('get-local-ip', () => {
    const nets = os.networkInterfaces();
    let candidateIp = '127.0.0.1';

    for (const name of Object.keys(nets)) {
        const lowerName = name.toLowerCase();
        
        // Descartar adaptadores virtuales conocidos
        if (lowerName.includes('virtual') || 
            lowerName.includes('vmware') || 
            lowerName.includes('vbox') || 
            lowerName.includes('wsl') || 
            lowerName.includes('vethernet') ||
            lowerName.includes('loopback')) {
            continue;
        }

        for (const net of nets[name]) {
            // Buscamos solo IPv4 que no sean internas
            if (net.family === 'IPv4' && !net.internal) {
                // Si el nombre sugiere que es el adaptador principal (Wi-Fi o Ethernet), devolvemos esta IP
                if (lowerName.includes('wi-fi') || lowerName.includes('ethernet') || lowerName.includes('wlan') || lowerName.includes('eth')) {
                    return net.address;
                }
                
                // Si no coincide el nombre exacto, lo guardamos como candidato por si acaso
                if (candidateIp === '127.0.0.1') {
                    candidateIp = net.address;
                }
            }
        }
    }
    
    return candidateIp;
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.handle('select-persistence-file', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Load Mission Persistence File',
        properties: ['openFile'],
        filters: [{ name: 'AEM State Files', extensions: ['json'] }]
    });
    
    if (canceled) return null;
    const filePath = filePaths[0];
    
    try {
        const success = persistence.loadState(filePath);
        
        if (!success) {
            throw new Error("Invalid AEM Commander state file format or file not found.");
        }
        
        return { 
            success: true, 
            fileName: path.basename(filePath),
            missionName: persistence.state.mission_info.mission_name,
            updatedAt: persistence.state.mission_info.updated_at || persistence.state.mission_info.created_at,
            createdAt: persistence.state.mission_info.created_at,
            instructionsRed: persistence.state.mission_info.instructionsRed || '',
            instructionsBlue: persistence.state.mission_info.instructionsBlue || '',
            bmRed: persistence.state.strategic_weapons?.ballistic_missiles?.red || 0,
            bmBlue: persistence.state.strategic_weapons?.ballistic_missiles?.blue || 0,
            unitProfiles: persistence.state.mission_info.unitProfiles || {}
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('create-new-persistence-file', async (event, intendedMissionName) => {
    const safeName = intendedMissionName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Create New Persistence File',
        defaultPath: `aem_state_${safeName}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (canceled) return null;

    persistence.createNewState(filePath, intendedMissionName);

    return { 
        success: true, 
        fileName: path.basename(filePath), 
        missionName: intendedMissionName,
        updatedAt: persistence.state.mission_info.created_at,
        createdAt: persistence.state.mission_info.created_at
    };
});

app.whenReady().then(createWindow);