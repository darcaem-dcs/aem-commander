const {app, BrowserWindow, ipcMain, dialog} = require('electron')
const path = require('path');
const net = require('net');
const os = require('os');

let mainWindow;
let processIntervalId = null;
let dcsSocket = null;

// Gemini
const AiHelper = require('./utils/aiHelper.js');
const ai = new AiHelper();
let currentModelName = 'gemini-3.1-flash';
let authMethodGlobal = 'apikey';
let authCredentialGlobal = null;

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

# JOINT OPERATIONS
- **CONQUER GOALS:** To achieve a 'conquer' type goal, you MUST: task ground units with the "CONQUER" task to move to and occupy the 'target_area'; OR task air or helo units with the "TRANSPORT" to move to the 'target_area' to deploy troops.
- **COMBINED ARMS:** Ground units are vulnerable. Do not send ground assets into a 'conquer' zone unless you have established local Air Superiority (CAP) or provided Close Air Support (CAS).
- **STRIKE ASSETS:** Ground units with the "CAS" mission should be used to soften target areas before a "CONQUER" move.

# CRITICAL CONSTRAINTS - DOCTRINE & RULES

## 1. MANDATORY MISSION VALIDATION (ZERO-TOLERANCE)
- **THE MISSION ARRAY IS THE ONLY SOURCE OF TRUTH FOR CAPABILITIES.** - You are UNMISTAKABLY FORBIDDEN from assigning a 'task' to a unit unless that task is explicitly listed in the unit's 'mission' array within 'available_assets'.
- **EXAMPLE:** If a MiG-29 has mission: ["CAP"], you CANNOT assign it "SEAD", "STRIKE", or "CAS" even if you believe it is capable.
- If no available unit possesses the required capability for a high-priority goal, log the failure in 'mission_log' and DO NOT issue the order.

## 2. RULE OF TWO (FLIGHT COMPOSITION)
- All NEW air groups must consist of exactly 2 units. Ground units may be tasked in groups of 1 or more as available.
- If asset counts are odd, leave the 'remainder' unit in reserve. NEVER create flights of 1 or 3 units.

## 3. ACTION TYPES & RECALL
- "new": Tasking units from 'available_assets'. Requires 'location', 'airbase', 'unit_count', and an array of 'unit_names' selected from the tool's available_unit_ids. CRITICAL: Do not assign the same static ID to multiple different actions.
- "existing": Redirecting units from 'active_assets'. Requires 'group_name' (the 'id' from active_assets). Omit 'unit_names'. The 'task' must remain exactly the same as its current active mission, OR be set to "RTB" (units cannot change armaments mid-flight).

## 4. CONSERVATIVE STRATEGY
- **PROACTIVE DEPLOYMENT:** You must not remain idle if goals are unfulfilled. Launch minimum required assets to achieve goals even if the ISR report is empty.
- Deploy the minimum force necessary. 
- Conduct Threat Assessments: Monitor SAM and EW sites. 
- Coordinate Packages: Do not send STRIKE/CAS into contested zones without ESCORT or SEAD if threats are present.
- **ECONOMY OF FORCE:** Deploy only the minimum force necessary to secure a goal or counter a threat. Do not over-commit.
- **RESERVE RATIO:** You should maintain a baseline of 20-50% of available units in reserve** during standard operations to handle unforeseen threats.
- **FORCE MULTIPLIERS:** Only task the minimum necessary force to achieve a task. For example, do not task 10 groups for a mission where 1-2 would suffice for the current threat level.
- **GO/NO-GO LOGIC:** If available assets are insufficient to meet a high-priority threat safely (e.g., attacking a heavy SAM site without SEAD), you MUST choose NOT to deploy. Preserving the force is a valid strategic victory.
- **RADAR MASKING (LOST CONTACTS):** If an enemy contact suddenly drops off the ISR report, DO NOT immediately order your interceptors to RTB. The enemy might be masking in terrain. Let your active fighters continue their sweep unless they are out of fuel or in immediate danger.
- **ESCALATION AVOIDANCE & FALLBACK TACTICS:** If you detect an escalation spiral (the enemy continuously launching interceptors to counter yours) or if your forces are severely outnumbered, DO NOT attempt to match them fighter-for-fighter. Instead, you MUST execute one of the following fallback strategies:
  1. **Retreat and Lure (Baiting):** Use the 'existing' action_type to order your outnumbered flights to fall back towards your own territory. Lure enemy fighters into your SAM (Surface-to-Air Missile) umbrellas.
  2. **Rely on Ground Defenses:** Stop spawning new CAP or INTERCEPT flights. Conserve your points and let your automated ground defenses (SAMs and AAA) deal with the incoming enemy air threats.
  3. **Asymmetric Strike (Counter-Air):** If the enemy is committing all resources to air-to-air combat, exploit the gap. Spawn STRIKE, SEAD, or CAS flights to attack their vulnerable ground targets or airbases to cripple their infrastructure.

## 5. TASKS
- "INTERCEPT": Use to INTERCEPT enemy aircraft entering our territory or that might be a threat to our active forces. When tasking INTERCEPT, the expected interception coordinates must be declared in "target_area" and the name of the enemy group from the ISR report must be declared in "reference_entity".
- "CAP": Use CAP to secure an area generally. When tasking CAP the coordinates of the area center must be declared in "target_area".
- "ESCORT": Use ESCORT to tether a fighter group specifically to a STRIKE, CAS, or TRANSPORT group. An Air group can escort any category, but a Helo group cannot escort Air category. When tasking ESCORT the name of group to escort must be declared in "reference_entity".
- "CAS": Use CAS to locate and destroy ground targets, useful against enemy ground units or to support a conquer goal. When tasking CAS the coordinates of the search area center must be declared in "target_area".
- "STRIKE": Use STRIKE to attack specific coordinates in a strike goal. When tasking STRIKE the coordinates to attack must be declared in "target_area".
- "SEAD": Use SEAD to protect any flight package when enemy SAMs are a threat, or when the goal is to destroy enemy SAMs. When tasking SEAD the approximate coordinates where the SAMs are must be declared in "target_area".
- "ANTI-SHIP": Use ANTI-SHIP to attack enemy ships. When tasking ANTI-SHIP the approximate coordinates of the target, or they last known location, must be declared in "target_area".
- "TRANSPORT": Use TRANSPORT simulate troops movement to conquer an area. When tasking TRANSPORT the coordinates where the troops must be transported must be declared in "target_area".
- "CSAR": Use CSAR to rescue a downed pilot. Besides active doctrine rules, CSAR assets should always be protected against enemy air units, and with a CAS group if the downed pilot is in enemy territory. When tasking CSAR the approximate coordinates of the search area center must be declared in "target_area" and the name of the downed pilot to locate must be declared in "reference_entity".
- "RTB": Use RTB to command an active group to return to base when it is no longer needed, the risk is too high, or you consider it appropriate.

## 6. GOALS
- "strike": the specific coordinates must be bombed.
- "csar": the specific units in assetsInvolved must be rescued.
- "enemy-csar": the specific units in assetsInvolved must be destroyed.
- "conquer": either ground units must be moved or simulated troops must be transported to the specific coordinates. 

# OUTPUT CONTRACT
Return ONLY a valid JSON object. No conversational text.
{
  "mission_log": "Strategic summary and assessment of history.",
  "actions": [
    {
      "action_type": "new|existing",
      "group_name": "The 'id' from active_assets (ONLY if 'existing')",
      "unit_names": ["Static_ID_1", "Static_ID_2"], // Exactly 'unit_count' IDs (ONLY if 'new')
      "unit_type": "Exact type from asset list",
      "location": "Origin location (if 'new')",
      "airbase": "Airbase name (if 'new')",
      "unit_count": 2,
	  "task": "MUST match a value in the unit's 'mission' array exactly (or current task if 'existing'), OR be 'RTB'.",
      "target_area": {"lat": 0.0, "long": 0.0},
      "target_name": "targetName from goals (if applicable)",
	  "reference_entity": "name of the group or unit referenced by the task (if applicable)",
      "rationale": "Military reasoning, including a capability verification check."
    }
  ]
}
`;

const tcpServer = net.createServer((socket) => {
    dcsSocket = socket;
    console.log("DCS World connected to AEM Commander.");
    let buffer = '';

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
        
        if (mainWindow) {
            mainWindow.webContents.send('log-message', 'Error. Operations suspended automatically.', 'error');
        }
		
    });
	
});
tcpServer.listen(49080, '0.0.0.0');

function sendOrdersToDCS(coalition, actions) {
    if(dcsSocket) {
        const payload = JSON.stringify({ type: "ORDERS", coalition, actions });
        dcsSocket.write(payload + "\n");
    }
}

function routeDCSMessage(msg) {
    const coal = msg.coalition.toLowerCase();
    if (!state[coal].forces) return;

    switch (msg.type) {
        case "ACTIVE":
            state[coal].forces.updateActiveGroups(msg.data);	
            break;
        case "AVAILABLE":
            state[coal].forces.updateAvailableUnits(msg.data);
            break;
        case "ISR":
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
                        if (!forces.activeUnitDestroyed(event.groupName)) {
                            state[coal].aiLogs.push(`All units from ${event.groupName} have been destroyed, this group has been destroyed`);
                        } else {
                            state[coal].aiLogs.push(`A unit from ${event.groupName} has been destroyed`);
                        }
                        break;
                        
                    case 'csar':
                        if (eventCoalition === forces.coalition) {
                            targets.addTarget(`csar-${event.name}`, 999, 'csar', event.lat, event.lon, null);
                            state[coal].aiLogs.push('One of our pilots has ejected safely and needs to be rescued. A new csar mission has been added to the targets list');
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
				const aiRawResponse = await ai.sendChatUpdate(prompt, forces, targets, territory);
				const jsonOutput = JSON.parse(aiRawResponse);
				if (jsonOutput && jsonOutput.actions) {
					mainWindow.webContents.send('log-message', `Red Commander Journal: ${jsonOutput.mission_log}`, 'success');
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
			
			const aiRawResponse = await ai.sendChatUpdate(updatePrompt, forces, targets, territory);
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

ipcMain.handle('select-and-start', async (event, authMethod, authCredential, modelName, commanderSide, instructionsRed, instructionsBlue, intervalTime) => {

	authMethodGlobal = authMethod;
    authCredentialGlobal = authCredential;
	currentModelName = modelName;
	
    if (commanderSide === 'red' || commanderSide === 'both') {
        state.red.forces = new CoalitionArmedForces('red', instructionsRed);
        state.red.targets = new CoalitionTargets('red');
        state.red.territory = new CoalitionTerritory('red');
    }
    if (commanderSide === 'blue' || commanderSide === 'both') {
        state.blue.forces = new CoalitionArmedForces('blue', instructionsBlue);
        state.blue.targets = new CoalitionTargets('blue');
        state.blue.territory = new CoalitionTerritory('blue');
    }
	
	const intervalMs = intervalTime * 1000;
	
	if (processIntervalId) clearInterval(processIntervalId);
    processIntervalId = setInterval(() => {
        if (state.red.forces) processCommander('red');
        if (state.blue.forces) processCommander('blue');
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
    mainWindow.webContents.send('log-message', 'Operations suspended by user.', 'info');
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

app.whenReady().then(createWindow);