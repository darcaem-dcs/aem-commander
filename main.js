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

// AI commander engine (gated, single-shot, tiered, with rule-based fallback)
const CommanderEngine = require('./utils/commanderEngine.js');
const runCommanderCycle = require('./utils/commanderRunner.js');
let commanderEngine = null;

// Persistence
const PersistenceManager = require('./utils/persistence.js');
const MizPatcher = require('./utils/mizPatcher.js');
const AdmZip = require('adm-zip');
let persistence = new PersistenceManager();
let activeDeployments = {};
let groupsToPersist = [];
let missionAbsTime = 0;  // Absolute time in seconds since mission start, updated from DCS

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
    ballisticRangeKm: 290,
    enableAiCommander: true,
    enablePersistence: true,
    persistState: true,
    persistPositions: true,
    persistTime: true
};

// Threat analysis
const threatAnalysis = require('./utils/threatAnalysis.js');

// Mission planner
const MissionScanner = require('./utils/missionScanner.js');
const MissionPlan = require('./utils/missionPlan.js');
const plan = new MissionPlan();
const { runDueOrders } = require('./utils/orderExecutor.js');
let planIntervalId = null;

function getPlanPath(missionName) {
    const safe = String(missionName || 'mission').replace(/[^a-z0-9_-]/gi, '_');
    return path.join(app.getPath('userData'), 'plans', `${safe}.aemplan.json`);
}

// Marks a goal as achieved: persists it, removes it from every list and unlocks dependants
function completeGoal(goalId) {
    if (!goalId) return false;
    const before = {};
    ['red', 'blue'].forEach(s => {
        const list = (state[s].targets && state[s].targets.targets) || [];
        before[s] = new Set(list.filter(t => t.locked).map(t => t.name));
    });

    const isNew = plan.markCompleted(goalId);
    ['red', 'blue'].forEach(s => {
        const t = state[s].targets;
        if (!t) return;
        t.removeTarget(goalId);
        plan.refreshLocks(t);
        (t.targets || []).filter(x => before[s].has(x.name) && !x.locked).forEach(x => {
            state[s].aiLogs.push(`Goal ${x.name} is now unlocked: its prerequisites are completed.`);
            logger.info(`[plan] Goal ${x.name} unlocked.`);
        });
    });

    if (isNew) {
        logger.info(`[plan] Goal completed: ${goalId}`);
        if (mainWindow) mainWindow.webContents.send('log-message', `Goal completed: ${goalId}`, 'success');
        if (persistence.currentFile && state.persistState) persistence.setCompletedGoals([...plan.completed]);
    }
    return isNew;
}

// Units held for pending scripted orders are hidden from the commander
function syncReservedUnits() {
    ['red', 'blue'].forEach(s => {
        if (state[s].forces) state[s].forces.setReservedUnits(plan.reservedUnits(s));
    });
}

function stopPlanLoop() {
    if (planIntervalId) { clearInterval(planIntervalId); planIntervalId = null; }
}

// Independent of the commander cycle: works without AI and keeps delays accurate
function startPlanLoop() {
    stopPlanLoop();
    planIntervalId = setInterval(() => {
        if (!dcsSocket) return;
        ['red', 'blue'].forEach(side => {
            if (!state[side].forces) return;
            try {
                runDueOrders(side, {
                    plan, state, persistence, logger, now: Date.now(),
                    ui: (m, t) => { if (mainWindow) mainWindow.webContents.send('log-message', m, t); },
                    sendOrdersToDCS, sendMessageToDCS, triggerMapUpdate
                });
            } catch (err) {
                logger.error(`[plan] Order execution error (${side}):`, err);
            }
        });
    }, 5000);
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
                stopPlanLoop();
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
            plan.reset();
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
                stopPlanLoop();
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
            plan.reset();
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
        logger.info(`Send orders to DCS (${coalition}): ${JSON.stringify(actions)}`);
    }
}

function sendMessageToDCS(coalition, text) {
    if(dcsSocket) {
        const payload = JSON.stringify({ type: "MESSAGE", coalition, text });
        dcsSocket.write(payload + "\n");
        logger.info(`Send message to DCS (${coalition}): ${text}`);
    }
}

function routeDCSMessage(msg) {
    const coal = msg.coalition.toLowerCase();
	
	if (msg.type === "INIT") {
        const incomingMission = msg.data.mission_name;
        const currentTheatre = msg.data.theatre;
        
        if (msg.data.ballistic_range) {
            state.ballisticRangeKm = Math.floor(msg.data.ballistic_range / 1000);
            logger.info(`Dynamic Ballistic Missile Range set to: ${state.ballisticRangeKm} km`);
        }

        // Send the theatre name to the frontend immediately
        if (mainWindow) {
            mainWindow.webContents.send('dcs-init', { 
                theatre: currentTheatre,
                missionName: incomingMission
            });
        }

        // Mission plan (goal overrides, custom goals, dependencies)
        plan.reset();
        const planPath = getPlanPath(incomingMission);
        const planRes = plan.load(planPath);
        const planUi = (m, t) => { logger.info(`[plan] ${m}`); if (mainWindow) mainWindow.webContents.send('log-message', m, t); };
        if (planRes.loaded) planUi(`Mission plan loaded (${Object.keys(plan.data.goals).length} goal entries): ${planPath}`, 'success');
        else if (planRes.errors.length === 0) logger.info(`[plan] No mission plan found (expected at ${planPath})`);
        planRes.errors.forEach(e => planUi(`Mission plan error: ${e}`, 'error'));
        planRes.warnings.forEach(w => planUi(`Mission plan: ${w}`, 'error'));
        if (persistence.currentFile) {
            plan.setCompleted(persistence.getCompletedGoals());
            plan.setExecuted(persistence.getExecutedOrders());
            syncReservedUnits();
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
            }

            // Check active groups
            const activeGroups = persistence.getActiveGroups();
            const groupsToSpawn = [];
            for (const [groupName, groupInfo] of Object.entries(activeGroups)) {
                groupsToSpawn.push({
                    coalition: groupInfo.coalition,
                    data: groupInfo.data
                });
            }

            // Send actions inmediatelly to DCS
            const actions = [];
            if (destroyedUnits.length > 0) {
                actions.push({ action_type: "persistence_destroy", unit_names: destroyedUnits });
            }
            if (downedPilots.length > 0) {
                actions.push({ action_type: "persistence_csar", pilots: downedPilots });
            }
            if (groupsToSpawn.length > 0) {
                actions.push({ action_type: "persistence_spawn", groups: groupsToSpawn });
            }
            if (actions.length > 0) {
                sendOrdersToDCS("ALL", actions);
            }
        } else {
            mainWindow.webContents.send('log-message', `DCS Mission '${incomingMission}' connected without a persistence file.`, 'info');
        }
        return; // INIT doesn't need to go to AI commanders
    } else if (msg.type === "SAVE_STATE") {
        if (msg.data && msg.data.persistent_groups) {
            groupsToPersist = msg.data.persistent_groups;
            missionAbsTime = msg.data.absolute_time || 0; // Update the absolute time from DCS
            logger.info(`Received ${groupsToPersist.length} groups to persist from DCS.`);
        }

        if (persistence.currentFile && state.persistState) {
            // Limpiamos los grupos viejos
            persistence.clearActiveGroups();
            
            // Recorremos los datos de telemetría de ambos bandos para guardarlos
            ['red', 'blue'].forEach(side => {
                if (state[side].forces && state[side].forces.rawPersistenceData) {
                    state[side].forces.rawPersistenceData.forEach(groupData => {
                        if (groupData.persistence_data) {
                            persistence.addActiveGroup(groupData.id, side, groupData);
                        }
                    });
                }
            });

            persistence.saveState();
            logger.info("Manual persistence state successfully saved.");
            
            if (mainWindow) {
                mainWindow.webContents.send('persistence-updated', persistence.state.mission_info.updated_at);
                mainWindow.webContents.send('log-message', 'Mission state correctly saved to persistence file.', 'success');
            }
            sendMessageToDCS("ALL", "HQ confirms: Persistence state saved successfully.");
        }
        return;
    } else if (msg.type === "EVENTS") {    // We process destroyed events HERE so it works even if AI commanders are offline.
        let stateChanged = false;
        msg.data.forEach(event => {
            // 1. Check out statics when a flight is activated
            if (event.type === 'activated' && event.group?.name && event.staticUnits) {
                // Store the array of static names under the active group's name
                activeDeployments[event.group.name] = [...event.staticUnits];
            }

            // 2. Handle combat deaths
            if (event.type === 'destroyed' && event.groupName) {
                
                // Mark the specific unit as dead ONLY if it's a pre-placed unit.
                // MOOSE spawned units contain a '#' in their name. We ignore them here 
                // because their deaths are handled by decreasing the group's "count" property.
                if (event.unitName && !event.unitName.includes('#')) {
                    persistence.markUnitAsDestroyed(event.unitName);
                    logger.info(`Unit destroyed. Flagged '${event.unitName}' as dead.`);
                }
        
                stateChanged = true;
                
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
		if (stateChanged && persistence.currentFile && state.persistState) {
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
            state[coal].forces.rawPersistenceData = msg.data;
            break;
        case "AVAILABLE":
            state[coal].forces.updateAvailableUnits(msg.data);
            break;
        case "ISR":
            state[coal].isrThreatScore = threatAnalysis.calculateBaseThreat(msg.data, state[coal].territory);
			state[coal].forces.updateISR(msg.data);
            break;
        case "GOALS":
            state[coal].targets.updateGoals(plan.filterCompleted(msg.data));
            plan.applyTo(state[coal].targets, m => logger.info(`[plan] ${m}`));
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
                        if (persistence.currentFile && state.persistState) {
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
                            if (persistence.currentFile && state.persistState) {
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
						if (completeGoal(event.goalName)) {
							state[coal].aiLogs.push(`Goal ${event.goalName} has been secured: infantry deployed by ${event.groupName}.`);
						}
						break;
						
					case 'mission_completed':
						if (event.status === 'SUCCESS') {
							state[coal].aiLogs.push(`The ${event.task} mission by ${event.groupName} against ${event.targetName} was a SUCCESS.`);

							// The goal id travels in goalName (the old targetName was the enemy group, not the goal)
							const goalId = event.goalName || event.targetName;
							const enemyCoalition = coal === 'red' ? 'blue' : 'red';
							let targetData = null;
							for (const l of [state[coal].targets, state[enemyCoalition].targets]) {
								targetData = ((l && l.targets) || []).find(t => t.name === goalId);
								if (targetData) break;
							}

							// Ballistic missile depot destroyed
							if (targetData && targetData.type === 'bm_depot') {
								const depotCapacity = parseInt(targetData.props && targetData.props.bm_count) || 0;
								const actualLost = persistence.destroyBallisticMissiles(enemyCoalition, depotCapacity);

								state[coal].aiLogs.push(`INTEL CONFIRMS: Enemy ballistic missile depot destroyed! Estimated up to ${depotCapacity} missiles eliminated.`);
								state[enemyCoalition].aiLogs.push(`CRITICAL ALERT: Our ballistic missile depot ${goalId} was destroyed by enemy forces! We lost ${actualLost} missiles.`);
								logger.info(`[AEM] ${enemyCoalition} lost ${actualLost} ballistic missiles due to depot strike.`);
							}

							// Only real goals count (a coordinate strike has no goal)
							if (targetData || plan.data.goals[goalId]) completeGoal(goalId);
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
    
    /// TODO: debug
    mainWindow.webContents.openDevTools({ mode: 'detach' });
}

async function processCommander(side) {
    return runCommanderCycle(side, {
        state, engine: commanderEngine, threatAnalysis, logger, plan,
        getPersistence: () => persistence,      // `persistence` is re-assigned elsewhere, so pass a getter
        getMainWindow: () => mainWindow,
        sendOrdersToDCS, sendMessageToDCS, triggerMapUpdate,
        retry: (s) => processCommander(s)
    });
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

ipcMain.handle('select-and-start', async (event, enableAiCommander, enablePersistence, persistState, persistPositions, persistTime, authMethod, authCredential, modelName, commanderSide, instructionsRed, instructionsBlue, intervalTime, aggRed, aggBlue, enableEscalation, bmRed, bmBlue, unitProfiles, aiOptions) => {

    startServer();

    state.enableAiCommander = enableAiCommander;
    state.enablePersistence = enablePersistence;
    state.persistState = persistState;
    state.persistPositions = persistPositions;
    state.persistTime = persistTime;

    // ALWAYS initialize tracking state so the map and telemetry work
    state.escalationEnabled = enableEscalation;
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

    // Only set AI authentication if the AI Commander is enabled
    if (enableAiCommander) {
        const o = aiOptions || {};
        commanderEngine = new CommanderEngine({
            ...o,
            modelFast: o.modelFast || modelName,
            gemini: { authMethod, credential: authCredential }
        }, { ui: (m, t) => mainWindow && mainWindow.webContents.send('log-message', m, t) });
    }

    // Apply JSON state file generation/update if requested
    if (enablePersistence && state.persistState && persistence.currentFile) {
        if (!persistence.state.mission_info) persistence.state.mission_info = {};
        persistence.state.mission_info.instructionsRed = instructionsRed;
        persistence.state.mission_info.instructionsBlue = instructionsBlue;
        persistence.setBallisticMissiles(bmRed, bmBlue);
        persistence.state.mission_info.unitProfiles = unitProfiles;
        persistence.saveState();
    }
    
    if (processIntervalId) clearInterval(processIntervalId);

    startPlanLoop();
    
    // Only run the AI Commander monitoring loop if it was enabled
    if (enableAiCommander) {
        const intervalMs = intervalTime * 1000;
        let isProcessing = false;
        
        processIntervalId = setInterval(async () => {
            if (isProcessing) {
                logger.info("Previous commander cycle still running. Skipping this interval.");
                return;
            }
            
            isProcessing = true;
            try {
                if (state.red.forces) {
                    await processCommander('red');
                }
                
                if (state.red.forces && state.blue.forces) {
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
                
                if (state.blue.forces) {
                    await processCommander('blue');
                }
            } catch (err) {
                logger.error("Error in commander execution loop:", err);
            } finally {
                isProcessing = false;
            }
        }, intervalMs);
    }
    
    return true;
});

ipcMain.handle('stop-monitor', async () => {
    if (processIntervalId) {
        clearInterval(processIntervalId);
        processIntervalId = null;
        stopPlanLoop();
    }

    // Execute .miz modification based on toggle preferences
    let groupsToPatch = (state.enablePersistence && state.persistPositions) ? groupsToPersist : [];
    let timeToPatch = (state.enablePersistence && state.persistTime) ? missionAbsTime : null;

    if (state.enablePersistence && ((groupsToPatch && groupsToPatch.length > 0) || timeToPatch > 0)) {
        const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Mission File',
            message: 'Mission persistence data is available.\n\nPlease select the .miz file you were using to update it. A backup copy will be created automatically in the same folder.',
            buttons: ['Select file', 'Do not update'],
            defaultId: 0,
            cancelId: 1
        });

        if (response === 0) {
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
                title: 'Select the .miz file to update',
                properties: ['openFile'],
                filters: [{ name: 'DCS Mission Files', extensions: ['miz'] }]
            });

            if (!canceled && filePaths.length > 0) {
                const selectedFilePath = filePaths[0];
                const patcher = new MizPatcher(selectedFilePath);
                
                // Pass the strictly filtered arrays/nulls based on user toggles
                const success = patcher.process(groupsToPatch, timeToPatch);
                
                if (success && mainWindow) {
                    mainWindow.webContents.send('log-message', `Mission backup created and file updated: ${path.basename(selectedFilePath)}`, 'success');
                } else if (mainWindow) {
                    mainWindow.webContents.send('log-message', 'Failed to apply persistence to the selected mission file.', 'error');
                }
            } else {
                if (mainWindow) mainWindow.webContents.send('log-message', 'Mission update skipped by user.', 'info');
            }
        } else {
            if (mainWindow) mainWindow.webContents.send('log-message', 'Mission update skipped by user.', 'info');
        }
    }

    state.red.forces = null; 
    state.blue.forces = null;
    persistence = new PersistenceManager();
    plan.reset();
    activeDeployments = {};
    groupsToPersist = [];
    missionAbsTime = 0;

    if (mainWindow) mainWindow.webContents.send('log-message', 'Operations suspended by user.', 'info');
    if (commanderEngine) logger.info('AI usage: ' + commanderEngine.cost.summary());
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

// Helper to get the correct path in both dev and production packaged builds
function getBeaconsFolderPath() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'beacons');
    }
    return path.join(__dirname, 'beacons');
}

ipcMain.handle('get-map-beacons', async (event, theatreName) => {
    if (!theatreName) return [];

    const beaconsDir = getBeaconsFolderPath();
    // Sanitize the name just in case and look for [Theatre].json
    const safeTheatreName = path.basename(theatreName); 
    const filePath = path.join(beaconsDir, `${safeTheatreName}.json`);

    if (!fs.existsSync(filePath)) {
        logger.info(`No beacon file found for map: ${safeTheatreName} (Expected at: ${filePath})`);
        return [];
    }

    try {
        const fileData = fs.readFileSync(filePath, 'utf8');
        const beaconList = JSON.parse(fileData);
        logger.info(`Loaded ${beaconList.length} beacons for ${safeTheatreName}`);
        return beaconList;
    } catch (err) {
        logger.error(`Error reading beacons file for ${safeTheatreName}:`, err);
        return [];
    }
});

ipcMain.handle('inject-lua-script', async (event, settings) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select the .miz file to inject the AEM Scripts into',
        properties: ['openFile'],
        filters: [{ name: 'DCS Mission Files', extensions: ['miz'] }]
    });

    if (canceled || filePaths.length === 0) return false;
    const selectedMiz = filePaths[0];
    const missionName = path.basename(selectedMiz, '.miz');

    const scriptsDir = app.isPackaged ? path.join(process.resourcesPath, 'lua_scripts') : path.join(__dirname, 'lua_scripts');
    const readFileSafe = (fileName) => {
        try { return fs.readFileSync(path.join(scriptsDir, fileName), 'utf8'); } 
        catch (err) { logger.error(`Could not read ${fileName}:`, err); return ""; }
    };

    let filesToInject = [];
    let civData = { templates: [], namesArray: [], count: 0 };

    // Prepare civilian templates and populate the Lua variables
    if (settings.moduleCiv) {
        civData = prepareCivAircraftTemplates(settings.civSelection || []);
        settings.civTemplates = civData.namesArray; // Pass the new generated names into the values script
        logger.info(`Prepared ${civData.count} civilian aircraft templates for physical injection`);
    }

    // Dependencies
    if (settings.includeMoose) filesToInject.push({ name: "moose.lua", content: readFileSafe("moose.lua") });
    if (settings.includeMist) filesToInject.push({ name: "mist.lua", content: readFileSafe("mist.lua") });

    // Format Lua arrays helper
    const toLuaArray = (arr) => `{${arr.map(s => `"${s}"`).join(', ')}}`;

    // Generate aem-commander-values.lua
    const dynamicValuesContent = `
-------------------------------------------------------------------------
-- AEM COMMANDER AUTOGENERATED CONFIGURATION
-------------------------------------------------------------------------
MISSION_NAME = "${missionName}"
HOST_IP = "${settings.hostIp}"
SOCKET_MAX_RETRIES = 2
AUTO_CONNECT = true
FIND_IP = false
MODULE_DEBUG = true
MODULE_WILDFIRES = false

-- AI Commander
${settings.moduleAi ? `
RED_EW = "${settings.redEw}"
RED_SAM = "${settings.redSam}"
RED_BORDER = "${settings.redBorder}"
BLUE_EW = "${settings.blueEw}"
BLUE_SAM = "${settings.blueSam}"
BLUE_BORDER = "${settings.blueBorder}"
STATIC_RESOURCE = "${settings.staticRes}"
TEMPLATE_PREFIX = "${settings.templatePrefix}"
RED_INFANTRY = "${settings.redInf}"
BLUE_INFANTRY = "${settings.blueInf}"
SCHEDULER_ISR_FREQ_RED = ${Math.max(10, settings.isrRed)}
SCHEDULER_ISR_FREQ_BLUE = ${Math.max(10, settings.isrBlue)}
UNLIMITED_FUEL = ${settings.unlimitedFuel ? 'true' : 'false'}
BALLISTIC_MISSILE_RANGE = ${settings.ballisticRange}
` : `
RED_EW = "NONE"
RED_SAM = "NONE"
RED_BORDER = "NONE"
BLUE_EW = "NONE"
BLUE_SAM = "NONE"
BLUE_BORDER = "NONE"
STATIC_RESOURCE = "NONE"
TEMPLATE_PREFIX = "NONE"
RED_INFANTRY = "NONE"
BLUE_INFANTRY = "NONE"
SCHEDULER_ISR_FREQ_RED = 60
SCHEDULER_ISR_FREQ_BLUE = 60
UNLIMITED_FUEL = false
BALLISTIC_MISSILE_RANGE = 290000
`}

-- CSAR
MODULE_CSAR = ${settings.moduleCsar ? 'true' : 'false'}
BLUE_RAFT = "BLUE LIFE RAFT"
BLUE_PILOT = "BLUE DOWNED PILOT"
RED_RAFT = "RED LIFE RAFT"
RED_PILOT = "RED DOWNED PILOT"
__CSAR_SOS = "${settings.csarSos}"

-- Civilian Traffic
MODULE_CIV_TRAFFIC = ${settings.moduleCiv ? 'true' : 'false'}
CIV_TEMPLATES = ${toLuaArray(settings.civTemplates)}
CIV_SELECTION = {${(settings.civSelection || []).map(luaQuote).join(', ')}}
CIV_ZONE_PREFIX = "${settings.civZone}"
CIV_INIT_FLIGHTS = ${settings.civInit}
CIV_MAX_FLIGHTS = ${settings.civMax}
CIV_MIN_DIST_METERS = ${settings.civMinDistMeters}
CIV_ALLOWED_AIRBASES = ${toLuaArray(settings.civAirbases)}

-- QRA
MODULE_QRA = ${settings.moduleQra ? 'true' : 'false'}
QRA_BOGEY_TEMPLATE = "${settings.qraBogey}"
QRA_BASE_CHANCE = 5
QRA_MAX_CHANCE = 85
RADIO_MESSAGES_FILES = {}
RADIO_MESSAGES_SUBTITLES = {}

-- BFM TRAINER
MODULE_BFM = ${settings.moduleBfm ? 'true' : 'false'}
BFM_FRIENDLY_TEMPLATE = "${settings.bfmFriendly}"
BFM_ADVERSARY_TEMPLATE = "${settings.bfmAdversary}"
BFM_MAX_FUEL_LBS = ${settings.bfmFuel}
BFM_HARD_DECK_FT = ${settings.bfmDeck}

-- Persistence
PERSISTENCE_KEYWORD = "${settings.modulePersist ? settings.persistKeyword : 'DO_NOT_PERSIST_ANYTHING'}"
`;

    filesToInject.push({ name: "aem-commander-values.lua", content: dynamicValuesContent });
    filesToInject.push({ name: "aem-commander-code.lua", content: readFileSafe("aem-commander-code.lua") });

    // Handle Media Files
    let mediaFiles = [];
    if (settings.moduleCsar) {
        if (settings.useDefaultSos) {
            const defaultSosPath = app.isPackaged ? path.join(process.resourcesPath, 'media', 'morse-sos.ogg') : path.join(__dirname, 'media', 'morse-sos.ogg');
            if (fs.existsSync(defaultSosPath)) {
                mediaFiles.push({ name: "morse-sos.ogg", buffer: fs.readFileSync(defaultSosPath) });
            } else {
                logger.warn("Default SOS file not found at " + defaultSosPath);
            }
        } else if (settings.customSosPath) {
            if (fs.existsSync(settings.customSosPath)) {
                mediaFiles.push({ name: settings.csarSosFileName, buffer: fs.readFileSync(settings.customSosPath) });
            } else {
                // If path doesn't exist on disk, assume it was previously loaded from a .miz and is already inside the archive
                logger.info(`Custom SOS path ${settings.customSosPath} not found locally. Assuming it's already in the .miz.`);
            }
        }
    }

    // Handle Kneeboard Files
    let kneeboardFiles = [];
    if (settings.moduleKneeboard) {
        const dimonDir = app.isPackaged ? path.join(process.resourcesPath, 'dimon') : path.join(__dirname, 'dimon');
        if (fs.existsSync(dimonDir)) {
            const files = fs.readdirSync(dimonDir);
            const prefix = `04_AD_${settings.kbTime}_${settings.kbMap}_`;
            
            files.forEach(file => {
                if (file.startsWith(prefix) && file.toLowerCase().endsWith('.png')) {
                    kneeboardFiles.push({
                        name: file,
                        buffer: fs.readFileSync(path.join(dimonDir, file))
                    });
                }
            });
            logger.info(`Prepared ${kneeboardFiles.length} kneeboard images for ${settings.kbMap} (${settings.kbTime})`);
        } else {
            logger.warn(`Kneeboard folder not found at ${dimonDir}`);
        }
    }

    const patcher = new MizPatcher(selectedMiz);
    const outputPath = patcher.injectScripts(filesToInject, mediaFiles, civData.templates, settings, kneeboardFiles);

    if (outputPath) {
        logger.info(`Successfully injected AEM Commander scripts. Original: ${selectedMiz} | Output: ${outputPath}`);
        return { success: true, fileName: path.basename(outputPath) };
    } else {
        return { success: false };
    }

});

ipcMain.handle('extract-miz-settings', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select a .miz file to load AEM Settings from',
        properties: ['openFile'],
        filters: [{ name: 'DCS Mission Files', extensions: ['miz'] }]
    });

    const StaticExtractor = require('./utils/staticExtractor.js');

    if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };
    const selectedMiz = filePaths[0];

    try {
        const zip = new AdmZip(selectedMiz);
        
        // 1. Check if the trigger is properly declared
        const missionEntry = zip.getEntry('mission');
        if (!missionEntry) return { success: false, error: 'Invalid .miz file (no mission file found).' };
        const missionText = zip.readAsText(missionEntry, 'utf8');
        const hasTrigger = missionText.includes("AEM Commander Auto-Inject");

        // Extract the theatre/map name directly from the DCS mission file
        const theatreMatch = missionText.match(/\["theatre"\]\s*=\s*"([^"]+)"/);
        const theatre = theatreMatch ? theatreMatch[1] : null;

        // 2. Check if the values file was injected
        const valuesEntry = zip.getEntry('l10n/DEFAULT/aem-commander-values.lua');
        if (!valuesEntry) return { success: false, error: 'No AEM Commander settings found in this .miz file.' };

        const luaText = zip.readAsText(valuesEntry, 'utf8');

        // 3. Regex Helpers to parse the Lua text
        const getStr = (key) => { const m = luaText.match(new RegExp(`${key}\\s*=\\s*"([^"]+)"`)); return m ? m[1] : null; };
        const getBool = (key) => { const m = luaText.match(new RegExp(`${key}\\s*=\\s*(true|false)`)); return m ? (m[1] === 'true') : null; };
        const getNum = (key) => { const m = luaText.match(new RegExp(`${key}\\s*=\\s*(\\d+)`)); return m ? parseInt(m[1], 10) : null; };
        const getArr = (key) => { 
            const m = luaText.match(new RegExp(`${key}\\s*=\\s*\\{([^}]+)\\}`)); 
            if (!m) return [];
            return m[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(s => s);
        };

        // 4. Map the extracted data
        const settings = {
            hostIp: getStr('HOST_IP'),
            moduleAi: getStr('RED_EW') !== "NONE", // We injected "NONE" if AI module was disabled
            redEw: getStr('RED_EW'),
            redSam: getStr('RED_SAM'),
            redBorder: getStr('RED_BORDER'),
            blueEw: getStr('BLUE_EW'),
            blueSam: getStr('BLUE_SAM'),
            blueBorder: getStr('BLUE_BORDER'),
            staticRes: getStr('STATIC_RESOURCE'),
            templatePrefix: getStr('TEMPLATE_PREFIX'),
            redInf: getStr('RED_INFANTRY'),
            blueInf: getStr('BLUE_INFANTRY'),
            isrRed: getNum('SCHEDULER_ISR_FREQ_RED'),
            isrBlue: getNum('SCHEDULER_ISR_FREQ_BLUE'),
            unlimitedFuel: getBool('UNLIMITED_FUEL'),
            ballisticRange: getNum('BALLISTIC_MISSILE_RANGE'),

            moduleCsar: getBool('MODULE_CSAR'),
            csarSos: getStr('__CSAR_SOS'),

            moduleCiv: getBool('MODULE_CIV_TRAFFIC'),
            civTemplates: getArr('CIV_TEMPLATES'),
            civSelection: parseCivSelection(luaText),
            civAirbases: getArr('CIV_ALLOWED_AIRBASES'),
            civZone: getStr('CIV_ZONE_PREFIX'),
            civInit: getNum('CIV_INIT_FLIGHTS'),
            civMax: getNum('CIV_MAX_FLIGHTS'),
            civMinDistMeters: getNum('CIV_MIN_DIST_METERS'),

            moduleQra: getBool('MODULE_QRA'),
            qraBogey: getStr('QRA_BOGEY_TEMPLATE'),

            moduleBfm: getBool('MODULE_BFM'),
            bfmFriendly: getStr('BFM_FRIENDLY_TEMPLATE'),
            bfmAdversary: getStr('BFM_ADVERSARY_TEMPLATE'),
            bfmFuel: getNum('BFM_MAX_FUEL_LBS'),
            bfmDeck: getNum('BFM_HARD_DECK_FT'),

            modulePersist: getStr('PERSISTENCE_KEYWORD') !== 'DO_NOT_PERSIST_ANYTHING',
            persistKeyword: getStr('PERSISTENCE_KEYWORD'),
            
            theatre: theatre,
            hasTrigger: hasTrigger,

            missionName: getStr('MISSION_NAME')
        };

        // Scan AEM_RES statics (preview for the UI; the injection re-scans the target .miz itself)
        let staticScan = { statics: [], templates: [], skipped: [] };
        try {
            const dictEntry = zip.getEntry('l10n/DEFAULT/dictionary');
            const dictText = dictEntry ? zip.readAsText(dictEntry, 'utf8') : '';
            staticScan = StaticExtractor.extract(
                missionText, dictText,
                settings.moduleAi ? settings.staticRes : null,
                settings.moduleAi ? settings.templatePrefix : null
            );
        } catch (e) {
            logger.warn(`Static scan failed: ${e.message}`);
        }

        // Mission layout for the Mission Map section
        let layout = null;
        try {
            const dEntry = zip.getEntry('l10n/DEFAULT/dictionary');
            layout = MissionScanner.scan(missionText, dEntry ? zip.readAsText(dEntry, 'utf8') : '', {
                redBorder: settings.redBorder, blueBorder: settings.blueBorder,
                redEw: settings.redEw, blueEw: settings.blueEw,
                redSam: settings.redSam, blueSam: settings.blueSam,
                staticRes: settings.staticRes, templatePrefix: settings.templatePrefix
            });
            layout.missionName = settings.missionName || path.basename(selectedMiz, '.miz');
        } catch (e) {
            logger.warn(`Mission layout scan failed: ${e.message}`);
        }

        return { success: true, settings, fileName: path.basename(selectedMiz), staticScan, layout };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('select-audio-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select CSAR SOS Audio File',
        properties: ['openFile'],
        filters: [{ name: 'Audio Files', extensions: ['ogg', 'wav'] }]
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
});

ipcMain.handle('get-log-content', async () => {
    try {
        const logPath = path.join(app.getPath('logs'), 'aem_commander.log');
        if (fs.existsSync(logPath)) {
            return fs.readFileSync(logPath, 'utf8');
        }
        return "Log file is empty or does not exist yet.";
    } catch (err) {
        return `Error reading log file: ${err.message}`;
    }
});

ipcMain.handle('clear-log-content', async () => {
    try {
        const logPath = path.join(app.getPath('logs'), 'aem_commander.log');
        if (fs.existsSync(logPath)) {
            fs.writeFileSync(logPath, '', 'utf8');
        }
        return true;
    } catch (err) {
        logger.error("Failed to clear log file:", err);
        return false;
    }
});

ipcMain.handle('extract-loadouts', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Loadout Master .miz',
        properties: ['openFile'],
        filters: [{ name: 'DCS Mission Files', extensions: ['miz'] }]
    });
    
    if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };

    // Resolve the fixed loadouts directory based on dev/packaged environment
    const loadoutsDir = app.isPackaged ? path.join(process.resourcesPath, 'loadouts') : path.join(__dirname, 'loadouts');
    
    // Ensure the directory exists
    if (!fs.existsSync(loadoutsDir)) {
        fs.mkdirSync(loadoutsDir, { recursive: true });
    }

    const savePath = path.join(loadoutsDir, 'loadouts.json');

    try {
        const LoadoutExtractor = require('./utils/loadoutExtractor.js');
        const count = LoadoutExtractor.extractFromMaster(filePaths[0], savePath);
        
        logger.info(`Successfully extracted loadouts for ${count} airframes to ${savePath}`);
        return { success: true, count, fileName: path.basename(savePath) };
    } catch (err) {
        logger.error(`Loadout extraction failed: ${err.message}`);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('extract-civ-templates', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Civilian Master .miz',
        properties: ['openFile'],
        filters: [{ name: 'DCS Mission Files', extensions: ['miz'] }]
    });
    
    if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };

    // Resolve the fixed civ directory based on dev/packaged environment
    const civDir = app.isPackaged ? path.join(process.resourcesPath, 'civ') : path.join(__dirname, 'civ');
    
    if (!fs.existsSync(civDir)) {
        fs.mkdirSync(civDir, { recursive: true });
    }

    const savePath = path.join(civDir, 'civil_aircrafts.json');

    try {
        // Ensure you saved the script from the previous step as utils/civExtractor.js
        const CivExtractor = require('./utils/civExtractor.js');
        const count = CivExtractor.extractFromMaster(filePaths[0], savePath);
        
        logger.info(`Successfully extracted civ templates for ${count} airframes to ${savePath}`);
        return { success: true, count, fileName: path.basename(savePath) };
    } catch (err) {
        logger.error(`Civ extraction failed: ${err.message}`);
        return { success: false, error: err.message };
    }
});

// ---------------------------------------------------------------------------
// Civilian aircraft catalog (civ/civil_aircrafts.json, built by CivExtractor)
// ---------------------------------------------------------------------------

function getCivJsonPath() {
    const civDir = app.isPackaged ? path.join(process.resourcesPath, 'civ') : path.join(__dirname, 'civ');
    return path.join(civDir, 'civil_aircrafts.json');
}

// Lua string literal ("..." with backslashes, quotes and newlines escaped)
function luaQuote(value) {
    return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
}

// Reads the CIV_SELECTION list ("airframe::livery" strings) back from a values file
function parseCivSelection(luaText) {
    const block = luaText.match(/CIV_SELECTION\s*=\s*\{((?:[^}"]|"(?:[^"\\]|\\.)*")*)\}/);
    if (!block) return [];
    const result = [];
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(block[1])) !== null) result.push(m[1].replace(/\\(["\\])/g, '$1'));
    return result;
}

// Prepares the raw civilian group templates to be physically injected into the .miz file
function prepareCivAircraftTemplates(selection) {
    let catalog = {};
    if (selection.length > 0) {
        try {
            catalog = JSON.parse(fs.readFileSync(getCivJsonPath(), 'utf8'));
        } catch (err) {
            logger.warn(`Could not read civilian catalog: ${err.message}`);
        }
    }

    let templates = [];
    let namesArray = [];
    let count = 0;

    for (const key of selection) {
        const sep = key.indexOf('::');
        if (sep === -1) continue;
        const airframe = key.slice(0, sep);
        const livery = key.slice(sep + 2);

        const info = catalog[airframe];
        const entry = info && info.liveries && info.liveries[livery];
        if (!entry || !entry.template) {
            logger.warn(`Civilian template not found in catalog, skipped: ${key}`);
            continue;
        }

        count++;
        // Generate a clean, predictable name for the injected group
        const name = `CIV_GEN_${String(count).padStart(3, '0')}`;
        namesArray.push(name);

        templates.push({
            name: name,
            originalName: entry.groupName, // e.g., "CIV_TPL_A330-5"
            template: entry.template
        });
    }

    return { templates, namesArray, count };
}

// Light version of the catalog for the UI (no Lua templates)
ipcMain.handle('get-civ-catalog', async () => {
    try {
        const jsonPath = getCivJsonPath();
        if (!fs.existsSync(jsonPath)) return { success: true, catalog: {} };

        const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const catalog = {};
        for (const [airframe, info] of Object.entries(raw)) {
            catalog[airframe] = {
                category: info.category,
                liveries: Object.entries(info.liveries || {})
                    .map(([id, l]) => ({ id, country: l.country, coalition: l.coalition, unitCount: l.unitCount }))
                    .sort((a, b) => a.id.localeCompare(b.id))
            };
        }
        return { success: true, catalog };
    } catch (err) {
        logger.error(`Failed to read civilian catalog: ${err.message}`);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('extract-csar-templates', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select CSAR Master .miz',
        properties: ['openFile'],
        filters: [{ name: 'DCS Mission Files', extensions: ['miz'] }]
    });
    
    if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };

    // Resolve the fixed directory based on dev/packaged environment
    const csarDir = app.isPackaged ? path.join(process.resourcesPath, 'csar') : path.join(__dirname, 'csar');
    
    if (!fs.existsSync(csarDir)) {
        fs.mkdirSync(csarDir, { recursive: true });
    }

    const savePath = path.join(csarDir, 'csar.json');

    try {
        const CsarExtractor = require('./utils/csarExtractor.js');
        const count = CsarExtractor.extractFromMaster(filePaths[0], savePath);
        
        logger.info(`Successfully extracted ${count} CSAR templates to ${savePath}`);
        return { success: true, count, fileName: path.basename(savePath) };
    } catch (err) {
        logger.error(`CSAR extraction failed: ${err.message}`);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('scan-mission-layout', async (event, opts) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select a .miz file to preview its layout',
        properties: ['openFile'],
        filters: [{ name: 'DCS Mission Files', extensions: ['miz'] }]
    });
    if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };
    try {
        const layout = MissionScanner.scanFromMiz(filePaths[0], opts || {});
        return { success: true, layout, fileName: path.basename(filePaths[0]) };
    } catch (err) {
        logger.error(`Mission layout scan failed: ${err.message}`);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('plan-load', async (event, missionName) => {
    const p = new MissionPlan();
    const file = getPlanPath(missionName);
    const res = p.load(file);
    return {
        success: res.errors.length === 0, exists: res.loaded, path: file,
        plan: p.data, warnings: res.warnings, errors: res.errors, goalTypes: MissionPlan.GOAL_TYPES
    };
});

ipcMain.handle('plan-save', async (event, missionName, rawPlan) => {
    try {
        const p = new MissionPlan();
        const warnings = [];
        p.data = p.normalize(rawPlan, warnings);          // drops invalid custom goals, cleans fields
        p.validate().forEach(w => warnings.push(w));      // dependency cycles
        const file = getPlanPath(missionName);
        p.save(file);
        logger.info(`[plan] Saved ${file}`);
        return { success: true, path: file, plan: p.data, warnings };
    } catch (err) {
        logger.error(`[plan] Save failed: ${err.message}`);
        return { success: false, error: err.message };
    }
});

app.whenReady().then(createWindow);