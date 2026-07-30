const {app, BrowserWindow, ipcMain, dialog} = require('electron')
const path = require('path');
const net = require('net');
const os = require('os');
const fs = require('fs');

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
let currentPersistenceFile = null;
let persistentState = { units: {} };
let activeDeployments = {};

function loadState() {
    if (fs.existsSync(currentPersistenceFile)) {
        try {
            persistentState = JSON.parse(fs.readFileSync(currentPersistenceFile, 'utf8'));
        } catch (e) {
            console.error("Error reading state.json:", e);
        }
    }
}
function saveState() {
    fs.writeFileSync(currentPersistenceFile, JSON.stringify(persistentState, null, 2));
}

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
    blue: { forces: null, targets: null, territory: null, aiLogs: [] }
};

const defaultDoctrine = 'Maintain air superiority on our territory: launch defensive caps. Attack flights must have escort or cap.';
const getSystemInstructions = (userContext) => `
# ROLE
You are a highly capable and conservative AI Theater Commander for a DCS World mission. Your goal is to manage coalition assets to achieve strategic goals while minimizing losses.

# STRATEGIC CONTEXT & COMMANDER INTENT
The following specific doctrine, posture, and goals have been dictated for your coalition. You must prioritize this intent while strictly obeying the critical constraints below:
${userContext}

# DATA INPUTS
1. goals: Current tactical objectives.
2. active_assets: Units already in the field (can be redirected or RTB).
3. available_assets: Reserve units ready for new tasking.
4. isr_report: Enemy contacts detected by intelligence.

# JOINT OPERATIONS & COMBINED ARMS
- **CONQUER GOALS:** To achieve a 'conquer' type goal, you MUST deploy ground units (using tasks like "ASSAULT", "SECURE" or "TRANSPORT").
- **COMBINED ARMS:** Ground units are vulnerable. Follow these deployment rules:
  1. DO NOT send "ASSAULT" (Tanks) into a zone without establishing local Air Superiority (CAP) or without softening the target via "CAS", "STRIKE", or "FIRE_SUPPORT".
  2. DO NOT send "SECURE" (APCs/IFVs) units alone into heavy enemy resistance. They are lightly armored. They should follow "ASSAULT" units or be sent only after the area is heavily bombed.
- **ARTILLERY POSITIONING:** "FIRE_SUPPORT" units are fragile. Do NOT assign them the exact coordinates of the enemy target. Calculate and assign a "target_area" that is a safe standoff distance (approx 10-20km away).

# CRITICAL CONSTRAINTS - DOCTRINE & RULES

## 1. MANDATORY MISSION VALIDATION (ZERO-TOLERANCE)
- **THE MISSION ARRAY IS THE ONLY SOURCE OF TRUTH FOR CAPABILITIES.** - You are UNMISTAKABLY FORBIDDEN from assigning a 'task' to a unit unless that task is explicitly listed in the unit's 'mission' array within 'available_assets'.
- **EXAMPLE:** If a unit has mission: ["ASSAULT"], you CANNOT assign it "CAS" or "CONQUER". You must assign it "ASSAULT".
- If no available unit possesses the required capability for a high-priority goal, log the failure in 'mission_log' and DO NOT issue the order.

## 2. RULE OF TWO (FLIGHT COMPOSITION)
- All NEW air groups must consist of exactly 2 units. 
- Ground units ("ASSAULT", "SECURE", "FIRE_SUPPORT") may be tasked in groups of 1 or more depending on availability and threat level. 

## 3. ACTION TYPES & RECALL
- "new": Tasking units from 'available_assets'. Requires 'location', 'airbase', 'unit_count', and an array of 'unit_names' selected from the tool's available_unit_ids. CRITICAL: Do not assign the same static ID to multiple different actions.
- "existing": Redirecting units from 'active_assets'. Requires 'group_name' (the 'id' from active_assets). Omit 'unit_names'. The 'task' must remain exactly the same as its current active mission, OR be set to "RTB" (units cannot change armaments mid-flight).

## 4. CONSERVATIVE STRATEGY
- **PROACTIVE DEPLOYMENT:** You must not remain idle if goals are unfulfilled. Launch minimum required assets to achieve goals even if the ISR report is empty.
- **ECONOMY OF FORCE:** Deploy only the minimum force necessary to secure a goal or counter a threat. Do not over-commit.
- **RESERVE RATIO:** You should maintain a baseline of 20-50% of available units in reserve.
- **GO/NO-GO LOGIC:** If available assets are insufficient to meet a high-priority threat safely, you MUST choose NOT to deploy. Preserving the force is a valid strategic victory.
- **RADAR MASKING (LOST CONTACTS):** If an enemy contact suddenly drops off the ISR report, DO NOT immediately order your interceptors to RTB. Let your active fighters continue their sweep.
- **FALLBACK TACTICS:** If outnumbered or in an escalation spiral, execute fallback strategies:
  1. **Retreat and Lure:** Lure enemy fighters into your SAM umbrellas.
  2. **Rely on Ground Defenses:** Stop spawning air assets and let SAM/AAA deal with the threat.
  3. **Asymmetric Strike:** Spawn STRIKE, SEAD, or CAS to attack vulnerable enemy infrastructure while they focus on Air-to-Air.
- **MAXIMUM SIMULTANEOUS GOALS (STRICT LIMIT):** You are ABSOLUTELY FORBIDDEN from pursuing more than 2 strategic goals at the same time. Prioritize the top 2 highest priority goals from the list. Even if you have ample available reserves, completely ignore any lower-priority goals until one of your top 2 goals is completely resolved or achieved. Focus your intelligence checks and deployments strictly on a maximum of 2 active objectives to maintain economy of force.

## 5. TASKS

*AIR & NAVAL TASKS:*
- "INTERCEPT": Intercept enemy aircraft. Provide expected interception coordinates in "target_area" and the enemy group name in "reference_entity".
- "CAP": Secure an area generally. Provide the area center in "target_area".
- "ESCORT": Tether a fighter group to a STRIKE, CAS, or TRANSPORT. Provide the group to escort in "reference_entity".
- "CAS": Locate and destroy ground targets to support ground forces. Provide search area center in "target_area".
- "STRIKE": Attack specific static coordinates. Provide coordinates in "target_area".
- "SEAD": Destroy enemy SAMs. Provide approximate SAM coordinates in "target_area".
- "ANTI-SHIP": Attack enemy ships. Provide target location in "target_area".
- "CSAR": Rescue downed pilots. Provide search area in "target_area" and pilot name in "reference_entity". Provide CAS cover if in enemy territory.
- "RTB": Command an active group to return to base to preserve forces.

*GROUND & LOGISTICS TASKS:*
- "ASSAULT": Spearhead ground attacks using heavy armor (MBTs). Route them directly into the "target_area" to destroy enemy ground presence.
- "SECURE": Use mechanized infantry (APCs/IFVs) to occupy and hold lightly defended or previously softened objectives. Route them into the "target_area".
- "FIRE_SUPPORT": Long-range bombardment (Artillery). Route them to a safe standoff "target_area" (10-20km away from the front).
- "DEFEND": Order ground units to hold and protect a friendly strategic location. Route them to the friendly "target_area".
- "TRANSPORT": Simulate troop deployment to conquer an area. Can be used by air (Helos) or ground. Route to the "target_area".

## 6. GOALS
- "strike": the specific coordinates must be bombed.
- "csar": the specific units in assetsInvolved must be rescued.
- "enemy-csar": the specific units in assetsInvolved must be destroyed.
- "conquer": ground units ("ASSAULT", "SECURE") or "TRANSPORT" troops must be moved to the specific coordinates to occupy them.

# OUTPUT CONTRACT
Return ONLY a valid JSON object. No conversational text.
{
  "mission_log": "Strategic summary and assessment of history. Do not mention vehicle names or types that do not explicitly exist in your available_assets list.",
  "actions": [
    {
      "action_type": "new|existing",
      "group_name": "The 'id' from active_assets (ONLY if 'existing')",
      "unit_names": ["Static_ID_1", "Static_ID_2"], // Exactly 'unit_count' IDs (ONLY if 'new')
      "unit_type": "Exact type from asset list",
      "location": "Origin location (if 'new')",
      "airbase": "Airbase name (if 'new')",
      "unit_count": 2, // Can be 1 or more for ground units. Must be 2 for air units.
      "task": "MUST match a value in the unit's 'mission' array exactly (or current task if 'existing'), OR be 'RTB'.",
      "target_area": {"lat": 0.0, "long": 0.0},
      "target_name": "targetName from goals (if applicable)",
      "reference_entity": "name of the group or unit referenced by the task (if applicable)",
      "rationale": "Military reasoning, including a capability verification check."
    }
  ]
}
`;

function startServer() {
    // Prevent trying to start multiple servers on the same port
    if (isListening) {
        console.log("Server is already running.");
        return;
    }

    tcpServer = net.createServer((socket) => {
        dcsSocket = socket;
        console.log("DCS World connected to AEM Commander.");
        let buffer = '';
        
        loadState();
        
        // Send the kill list to DCS immediately upon connection
        const destroyedUnits = Object.keys(persistentState.units).filter(
            name => persistentState.units[name].status === "destroyed"
        );
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

        if (persistentState.eventThreatBonus) {
            state.red.eventThreatBonus = persistentState.eventThreatBonus.red || 0;
            state.blue.eventThreatBonus = persistentState.eventThreatBonus.blue || 0; 
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
                } catch(e) { console.error("Error parsing JSON from DCS", e); }
            }
        });

        socket.on('close', () => {
            console.log("DCS World disconnected.");
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
            
            persistentState = { units: {} };
            currentPersistenceFile = null;
            activeDeployments = {};
            
            if (mainWindow) {
                mainWindow.webContents.send('log-message', 'DCS Mission ended. Operations suspended automatically.', 'success');
            }
            
        });
        
        socket.on('error', (err) => {
            console.log(err);
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
            
            persistentState = { units: {} };
            currentPersistenceFile = null;
            activeDeployments = {};
            
            if (mainWindow) {
                mainWindow.webContents.send('log-message', 'Error. Operations suspended automatically.', 'error');
            }
            
        });
        
    });

    tcpServer.listen(49080, '0.0.0.0', () => {
        isListening = true;
        console.log('TCP Server listening on port 49080');
    });

    // Handle errors (like port already in use)
    tcpServer.on('error', (err) => {
        console.error('Server error:', err);
        isListening = false;
    });
}

function stopServer() {
    if (tcpServer && isListening) {
        tcpServer.close(() => {
            isListening = false;
            tcpServer = null;
            console.log('TCP Server stopped.');
        });
    }
}

function sendOrdersToDCS(coalition, actions) {
    if(dcsSocket) {
        const payload = JSON.stringify({ type: "ORDERS", coalition, actions });
        dcsSocket.write(payload + "\n");
    }
}

function routeDCSMessage(msg) {
    const coal = msg.coalition.toLowerCase();
	
	if (msg.type === "INIT") {
        const incomingMission = msg.data.mission_name;
        
        if (currentPersistenceFile) {
            if (incomingMission !== persistentState.mission_info?.mission_name) {
                mainWindow.webContents.send('log-message', `WARNING: Loaded save file is for '${persistentState.mission_info?.mission_name}', but DCS loaded '${incomingMission}'.`, 'error');
            } else {
                mainWindow.webContents.send('log-message', `Persistence verified for mission: ${incomingMission}`, 'success');
            }
            
            // Send the kill list to DCS now that we verified the mission
            const destroyedUnits = Object.keys(persistentState.units).filter(
                name => persistentState.units[name].status === "destroyed"
            );

            const downedPilots = persistentState.csar ? Object.keys(persistentState.csar).map(name => ({ 
                name: name, 
                lat: persistentState.csar[name].lat, 
                lon: persistentState.csar[name].lon, 
                coalition: persistentState.csar[name].coalition 
            })) : [];

            if (downedPilots.length > 0) {
                // Clear csar state; they will be re-registered by DCS when spawned to avoid ghost entries
                persistentState.csar = {};
                saveState();
            }

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
                if (!persistentState.units) persistentState.units = {}; 
                
                // Mark the specific unit as dead for the persistence file
                persistentState.units[event.unitName] = { status: "destroyed" };
                stateChanged = true;
                console.log(`Unit destroyed. Flagged '${event.unitName}' as dead.`);
                
                // Handle the AI Commander's reserve ledger using the group name
                if (event.groupName && activeDeployments[event.groupName] && activeDeployments[event.groupName].length > 0) {
                    
                    // Pop exactly ONE static unit from the ledger for this death
                    const consumedStatic = activeDeployments[event.groupName].pop();
                    persistentState.units[consumedStatic] = { status: "destroyed" };
                    stateChanged = true;
                    console.log(`Commander unit destroyed. Flagged static reserve '${consumedStatic}' as dead.`);
                    
                }
            }

            // 3. Handle downed pilots persistence
            if (event.type === 'csar') {
                if (!persistentState.csar) persistentState.csar = {};
                persistentState.csar[event.name] = { lat: event.lat, lon: event.lon, coalition: event.coalition.toLowerCase() };
                stateChanged = true;
                console.log(`Downed pilot recorded: '${event.name}'.`);
            }
            
            // 4. Handle pilot rescues
            if (event.type === 'rescued') {
                if (persistentState.csar && persistentState.csar[event.name]) {
                    delete persistentState.csar[event.name];
                    stateChanged = true;
                    console.log(`Pilot rescued. Removed '${event.name}' from tracking.`);
                }
            }
        });
		
        // Only save if a file was loaded/created
		if (stateChanged && currentPersistenceFile) {
            if (!persistentState.mission_info) persistentState.mission_info = {};
            const now = new Date().toISOString();
            persistentState.mission_info.updated_at = now;
            
            saveState();
            
            if (mainWindow) {
                mainWindow.webContents.send('persistence-updated', now);
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
            const territory = state[coal].territory;
            let calculatedThreat = 0;
			
			msg.data.forEach(item => {
                let baseScore = item.threat_score || 0;
                let multiplier = 0;
                
                // 1. ¿Está dentro de nuestro territorio?
                let isInside = false;
                if (territory && territory.border && territory.border.length > 0) {
                    const check = territory.isTargetInFriendlyTerritory(item.location.lat, item.location.long);
                    isInside = check.is_friendly_territory;
                }
                
                if (isInside) {
                    multiplier = 2.0; // Amenaza crítica: Han cruzado la frontera
                } else {
                    // 2. Si está fuera, calculamos la distancia a nuestra frontera en km
                    let distKm = getDistanceToBorder(item.location.lat, item.location.long, territory ? territory.border : null);
                    
                    // 3. Diferenciamos unidades estáticas/defensivas vs móviles/ofensivas
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
            
            state[coal].isrThreatScore = calculatedThreat;
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
					
						console.log("EVENT");
						console.log(event);
					
                        const arrayStatics = event.staticUnits;
                        forces.addActiveGroup(
                            event.group.name, event.group.type, event.group.category,
                            event.group.mission, event.group.lat, event.group.lon,
                            event.group.airbase, arrayStatics.length
                        );
                        arrayStatics.forEach(name => forces.removeAvailableUnit(name));
                        state[coal].aiLogs.push(`The new flight ${event.group.name} has successfully launched from ${event.group.airbase}`);
						
						console.log(`The new flight ${event.group.name} has successfully launched from ${event.group.airbase}`);
						
                        break;
                        
                    case 'destroyed':
						state[coal].eventThreatBonus = (state[coal].eventThreatBonus || 0) + 20;
                        if (!forces.activeUnitDestroyed(event.groupName)) {
                            state[coal].aiLogs.push(`All units from ${event.groupName} have been destroyed, this group has been destroyed`);
                        } else {
                            state[coal].aiLogs.push(`A unit from ${event.groupName} has been destroyed`);
                        }
                        if (currentPersistenceFile) {
                            if (persistentState.eventThreatBonus == null) persistentState.eventThreatBonus = {};
                            persistentState.eventThreatBonus[coal] = state[coal].eventThreatBonus;
                            saveState();
                        }
                        break;
                        
                    case 'csar':
                        if (eventCoalition === forces.coalition) {
							state[coal].eventThreatBonus = (state[coal].eventThreatBonus || 0) + 30;
                            targets.addTarget(`csar-${event.name}`, 999, 'csar', event.lat, event.lon, null);
                            state[coal].aiLogs.push('One of our pilots has ejected safely and needs to be rescued. A new csar mission has been added to the targets list');
                            if (currentPersistenceFile) {
                                if (persistentState.eventThreatBonus == null) persistentState.eventThreatBonus = {};
                                persistentState.eventThreatBonus[coal] = state[coal].eventThreatBonus;
                                saveState();
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
        console.error("Error serializing map state:", e);
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
	console.log("[processCommander] not ready: " + forces.activeGroups + " + " + forces.targets + " - " + forces.border);
		setTimeout(() => processCommander(side), 10000);
        return;
    }
	
	let restrictionPrompt = "";
    
    // Chequeo opcional del Sistema de Escalada (Threat Counter)
    if (state.escalationEnabled) {
        const totalThreat = (cState.isrThreatScore || 0) + (cState.eventThreatBonus || 0);
        
        if (totalThreat < 40) {
            // POSTURA VERDE: Defensiva Pura
            restrictionPrompt += `\n\nCURRENT THEATER THREST POSTURE: [GREEN - LOW THREAT (Score: ${Math.round(totalThreat)})]. The situation is stable. You are strictly in a DEFENSIVE POSTURE. You are ABSOLUTELY FORBIDDEN from launching any new offensive missions (such as "STRIKE", "SEAD", "CAS", "ASSAULT", or "TRANSPORT"). You may ONLY launch or redirect units for defensive tasks ("CAP", "INTERCEPT", "DEFEND", "RTB"). Do not cross the border under any circumstance unless explicitly intercepting an active intruder.`;
            mainWindow.webContents.send('log-message', `Commander of ${forces.coalition}: Posture is GREEN (Threat Score: ${Math.round(totalThreat)} < 40). Only defensive actions authorized.`, 'info');
        } else if (totalThreat >= 40 && totalThreat <= 80) {
            // POSTURA AMARILLA: Escaramuza / Reactiva
            restrictionPrompt += `\n\nCURRENT THEATER THREAT POSTURE: [YELLOW - MEDIUM THREAT (Score: ${Math.round(totalThreat)})]. Enemy activity or recent friendly losses have escalated the tension. You are in a REACTIVE POSTURE. You are authorized to launch close support missions ("CAS", "SEAD") to suppress localized border threats or assist friendly flights. However, you are STILL FORBIDDEN from launching deep strategic infrastructure strikes ("STRIKE") or mass ground invasions ("ASSAULT").`;
            mainWindow.webContents.send('log-message', `Commander of ${forces.coalition}: Posture is YELLOW (Threat Score: ${Math.round(totalThreat)}). Specialized support authorized. Strategic strikes locked.`, 'info');
        } else {
            // POSTURA ROJA: Guerra Total
            mainWindow.webContents.send('log-message', `Commander of ${forces.coalition}: Posture is RED (Threat Score: ${Math.round(totalThreat)} > 80). ALL CONSTRAINTS LIFTED. FULL THEATER WAR DECLARED.`, 'success');
        }
        
        // Decaimiento acumulativo: Restamos 5 puntos por ciclo para enfriar el trauma de bajas si no pasa nada
        if (cState.eventThreatBonus > 0) {
            cState.eventThreatBonus = Math.max(0, cState.eventThreatBonus - 5);
        }

        if (currentPersistenceFile) {
            if (persistentState.eventThreatBonus == null) persistentState.eventThreatBonus = {};
            persistentState.eventThreatBonus[side] = cState.eventThreatBonus;
            saveState();
        }
    }
	
	const roll = Math.random() * 100;
    
    if (roll > cState.aggressiveness) {
        // El chequeo falló: Bloqueamos misiones ofensivas en esta iteración
        restrictionPrompt += `\n\nCRITICAL TEMPORARY THREAT POSTURE RESTRICTION FOR THIS CYCLE: Strategic offensive operations are currently ON HOLD due to headquarters command. You are STRICTLY FORBIDDEN from launching or tasking any new offensive, strike, or assault missions (such as "STRIKE", "SEAD", "CAS", "ASSAULT", or "TRANSPORT"). You may ONLY issue defensive, protective, or support orders (such as "CAP", "INTERCEPT", "DEFEND", or "RTB") to maintain the front line or preserve active units. Do not open new offensive fronts during this interval.`;
        mainWindow.webContents.send('log-message', `Commander of ${forces.coalition}: Threat posture check on hold (Roll: ${Math.round(roll)}% > Aggressiveness Threshold: ${cState.aggressiveness}%). Only defensive operations allowed for this cycle.`, 'info');
    } else {
        mainWindow.webContents.send('log-message', `Commander of ${forces.coalition}: Full multi-domain offensive operations authorized for this cycle (Roll: ${Math.round(roll)}% <= Aggressiveness Threshold: ${cState.aggressiveness}%).`, 'info');
    }
	
	if (forces.session == null) {
		
		try {
			// Pasamos el método y la credencial a tu initModel
			forces.model = ai.initModel(authMethodGlobal, authCredentialGlobal, currentModelName, getSystemInstructions(forces.instructions));
			forces.session = ai.startChatSession(forces.model);
			mainWindow.webContents.send('log-message', `Commander of ${forces.coalition} is monitoring the battlefield`, 'success');
			
			// Get initial orders
			try {
				const prompt = `
The battlefield simulation has started.
You are the active Theater Commander.

1. Use your tools to retrieve the highest priority goals.
2. ISR CHECK: Use 'get_enemy_threats_near_location' to check for ENEMY SAMs, CAP, or EW sites near your high-priority goals. 
3. FRIENDLY CHECK: Use 'get_active_groups_by_mission' to check your OWN deployed defensive assets. Do not confuse your own SAMs with enemy SAMs.
4. Check if targets are in friendly territory to determine if SEAD or ESCORT is needed.
5. Find the closest capable reserve groups to fulfill the objectives.
6. When you have gathered enough intelligence, issue your final orders.

CRITICAL: Your final response MUST be a valid JSON object matching the contract exactly. Absolutely no conversational text, no markdown blocks, and no narrative reasoning outside the JSON. If no action is needed, return {"mission_log": "Idle", "actions": []}.`;
				const aiRawResponse = await ai.sendChatUpdate(prompt + restrictionPrompt, forces, targets, territory);
				const jsonOutput = JSON.parse(aiRawResponse);
				if (jsonOutput && jsonOutput.actions) {
					mainWindow.webContents.send('log-message', `Commander of ${forces.coalition} Journal: ${jsonOutput.mission_log}`, 'success');
					sendOrdersToDCS(side.toUpperCase(), jsonOutput.actions);
					jsonOutput.actions.forEach(action => {
                        if (action.action_type === 'new' && action.unit_names) {
                            action.unit_names.forEach(unitName => {
                                forces.removeAvailableUnit(unitName);
                            });
                        }
                    });
                    triggerMapUpdate();
				}
			} catch (err) {
				mainWindow.webContents.send('log-message', `Commander of ${forces.coalition} error: ${err.message}`, 'error');
				return;
			}
		} catch (err) {
			console.log(err);
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
2. ASSESS NEW DATA: Use your tools to review your goals, available reserve assets, currently active deployments, and updated ISR threats.
3. TAKE ACTION: 
   - Issue 'new' orders to available assets to respond to unhandled threats or unfulfilled goals.
   - Issue 'RTB' commands to 'existing' active units if their goal is complete, or if the threat level has become unsurvivable.
4. If the current situation is nominal and your previous orders are still sufficient, simply return {"mission_log": "Situation nominal, continuing execution of previous orders.", "actions": []}.

CRITICAL: Output ONLY valid JSON matching the contract exactly. No conversational text.`;
			
			const aiRawResponse = await ai.sendChatUpdate(updatePrompt + restrictionPrompt, forces, targets, territory);
            const jsonOutput = ai.aiSanitizeJson(aiRawResponse);
			
			if (jsonOutput && jsonOutput.actions && jsonOutput.actions.length > 0) {
				mainWindow.webContents.send('log-message', `Commander of ${forces.coalition}: ${jsonOutput.mission_log}`, 'success');
				sendOrdersToDCS(side.toUpperCase(), jsonOutput.actions);
				jsonOutput.actions.forEach(action => {
                    if (action.action_type === 'new' && action.unit_names) {
                        action.unit_names.forEach(unitName => {
                            forces.removeAvailableUnit(unitName);
                        });
                    }
                });
                triggerMapUpdate();
			} else if (jsonOutput) {
				mainWindow.webContents.send('log-message', `Commander of ${forces.coalition}: Monitoring. ${jsonOutput.mission_log}`, 'info');
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

ipcMain.handle('select-and-start', async (event, authMethod, authCredential, modelName, commanderSide, instructionsRed, instructionsBlue, intervalTime, aggRed, aggBlue, enableEscalation) => {
	
    startServer();

	authMethodGlobal = authMethod;
    authCredentialGlobal = authCredential;
	currentModelName = modelName;
	
	state.escalationEnabled = enableEscalation;

    if (currentPersistenceFile) {
        if (!persistentState.mission_info) persistentState.mission_info = {};
        persistentState.mission_info.instructionsRed = instructionsRed;
        persistentState.mission_info.instructionsBlue = instructionsBlue;
        saveState();
    }
	
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
            console.log("Previous commander cycle still running. Skipping this interval.");
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
            console.error("Error in commander execution loop:", err);
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
	persistentState = { units: {} };
	currentPersistenceFile = null;
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
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const parsedState = JSON.parse(fileContent);
        
        if (!parsedState.mission_info || !parsedState.units) {
            throw new Error("Invalid AEM Commander state file format.");
        }
        
        currentPersistenceFile = filePath;
        persistentState = parsedState;
        
        return { 
            success: true, 
            fileName: path.basename(filePath),
            missionName: parsedState.mission_info.mission_name ,
			updatedAt: parsedState.mission_info.updated_at || parsedState.mission_info.created_at,
            createdAt: parsedState.mission_info.created_at,
            instructionsRed: parsedState.mission_info.instructionsRed || '',
            instructionsBlue: parsedState.mission_info.instructionsBlue || ''
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

    const blankState = {
        mission_info: {
            mission_name: intendedMissionName,
            created_at: new Date().toISOString()
        },
        units: {}
    };

    fs.writeFileSync(filePath, JSON.stringify(blankState, null, 2));
    currentPersistenceFile = filePath;
    persistentState = blankState;

    return { 
		success: true, 
		fileName: path.basename(filePath), 
		missionName: intendedMissionName,
		updatedAt: blankState.mission_info.created_at,
        createdAt: parsedState.mission_info.created_at
	};
});

app.whenReady().then(createWindow);