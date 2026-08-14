const fs = require('fs');
const logger = require('./log.js');

module.exports = function() {

    this.initModel = function (authMethod, authCredential, model, instructions, temperature, maxTokens) {
		
		const commanderTools = [
            {
                functionDeclarations: [
                    {
                        name: "find_closest_capable_group",
						description: "Finds the closest available reserve units capable of performing a specific mission. Returns the airbase, distance, and an array of available static unit IDs you can pick from to form your flight.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                mission_type: { 
                                    type: "STRING", 
                                    description: "The required capability (e.g., 'CAP', 'SEAD', 'CAS', 'STRIKE', 'ESCORT')" 
                                },
                                target_lat: { type: "NUMBER", description: "Target latitude" },
                                target_lon: { type: "NUMBER", description: "Target longitude" }
                            },
                            required: ["mission_type", "target_lat", "target_lon"]
                        }
                    },
					{
                        name: "get_top_priority_goals",
                        description: "Retrieves the highest priority strategic goals currently active in the theater.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                count: { 
                                    type: "INTEGER", 
                                    description: "The maximum number of top goals to retrieve (e.g., 3)" 
                                }
                            },
                            required: ["count"]
                        }
                    },
                    {
                        name: "get_goals_by_type",
                        description: "Retrieves active goals filtered by a specific mission type (e.g., 'strike', 'cap').",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                mission_type: { 
                                    type: "STRING", 
                                    description: "The type of goal to find (e.g., 'strike')" 
                                }
                            },
                            required: ["mission_type"]
                        }
                    },
					{
                        name: "is_target_in_friendly_territory",
                        description: "Checks if a specific coordinate (latitude and longitude) is inside friendly coalition territory. Use this to ensure assets are not blindly sent into hostile airspace without support.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                target_lat: { type: "NUMBER", description: "Target latitude" },
                                target_lon: { type: "NUMBER", description: "Target longitude" }
                            },
                            required: ["target_lat", "target_lon"]
                        }
                    },
					{
                        name: "get_theater_reserves_summary",
                        description: "Provides a high-level summary of all available reserve units categorized by their mission capabilities (e.g., total number of CAP, SEAD, or STRIKE capable units). Use this to check overall force health.",
						parameters: {
                            type: "OBJECT",
                            properties: {
                                execute: { 
                                    type: "BOOLEAN", 
                                    description: "Always set this to true to execute the summary." 
                                }
                            },
                            required: ["execute"]
                        }
                    },
					{
                        name: "get_active_groups_by_mission",
                        description: "Retrieves a list of friendly groups that are ALREADY DEPLOYED and currently performing a specific mission (e.g., 'SAM', 'EW', 'AWACS', 'CAP'). Use this to check your existing defenses or active patrols.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                mission_type: { 
                                    type: "STRING", 
                                    description: "The mission type to filter by (e.g., 'SAM', 'EW')" 
                                }
                            },
                            required: ["mission_type"]
                        }
                    },
                    {
                        name: "get_closest_active_group",
                        description: "Finds the closest ALREADY DEPLOYED friendly group performing a specific mission relative to a target location. Use this to check if a target is covered by friendly SAMs or nearby CAP.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                mission_type: { type: "STRING", description: "The mission type (e.g., 'SAM', 'CAP')" },
                                target_lat: { type: "NUMBER", description: "Target latitude" },
                                target_lon: { type: "NUMBER", description: "Target longitude" }
                            },
                            required: ["mission_type", "target_lat", "target_lon"]
                        }
                    },
					{
                        name: "get_enemy_threats_near_location",
                        description: "ISR REPORT: Scans for KNOWN ENEMY threats (SAMs, CAP, EW, etc.) within a specific radius of a target coordinate. Use this to evaluate the danger of a strike zone.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                target_lat: { type: "NUMBER", description: "Target latitude" },
                                target_lon: { type: "NUMBER", description: "Target longitude" },
                                radius_km: { type: "NUMBER", description: "Search radius in kilometers (e.g., 80)" }
                            },
                            required: ["target_lat", "target_lon", "radius_km"]
                        }
                    },
					{
                        name: "get_known_enemy_threats_by_type",
                        description: "ISR REPORT: Retrieves a theater-wide list of all known ENEMY units matching a specific threat class (e.g., 'SAM', 'CAP', 'AWACS').",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                threat_class: { 
                                    type: "STRING", 
                                    description: "The enemy threat class to filter by (e.g., 'SAM', 'CAP')" 
                                }
                            },
                            required: ["threat_class"]
                        }
                    },
                    {
                        name: "get_full_tactical_intel",
                        description: "MACRO-TOOL: Retrieves a complete tactical intelligence report for a specific target location. It automatically returns territory status, nearby enemy threats, the closest capable reserve group for your mission, and nearby friendly SAM/CAP cover. Use this to evaluate a strike or assault zone in a single action.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                target_lat: { type: "NUMBER", description: "Target latitude" },
                                target_lon: { type: "NUMBER", description: "Target longitude" },
                                required_mission_type: { 
                                    type: "STRING", 
                                    description: "The capability you need to deploy (e.g., 'STRIKE', 'TRANSPORT_TROOPS')" 
                                },
                                threat_radius_km: { type: "NUMBER", description: "Radius to scan for enemy threats (e.g., 50 or 80)" }
                            },
                            required: ["target_lat", "target_lon", "required_mission_type", "threat_radius_km"]
                        }
                    },
                    {
                        name: "get_all_active_groups",
                        description: "Retrieves a complete list of ALL friendly groups currently deployed in the theater across all mission types. Use this to get a full picture of your active forces without calling multiple tools.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                execute: { type: "BOOLEAN", description: "Always set to true" }
                            },
                            required: ["execute"]
                        }
                    },
                    {
                        name: "submit_commander_orders",
                        description: "FINAL STEP: Use this tool to submit your final tactical plan and end your turn. Call this ONLY when you have gathered all necessary intelligence and are ready to issue orders.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                mission_log: { 
                                    type: "STRING",
                                    description: "Strategic summary and assessment of history. Do not mention vehicle names or types that do not explicitly exist in your available_assets list."
                                },
                                actions: {
                                    type: "ARRAY",
                                    description: "Array of orders to issue to your forces. Leave empty if no action is needed.",
                                    items: {
                                        type: "OBJECT",
                                        properties: {
                                            action_type: { type: "STRING", description: "MUST be 'new' or 'existing'" },
                                            group_name: { type: "STRING", description: "The 'id' from active_assets (ONLY if 'existing')" },
                                            unit_names: { type: "ARRAY", items: { type: "STRING" }, description: "Array of static IDs. Exactly 'unit_count' IDs (ONLY if 'new')" },
                                            unit_type: { type: "STRING", description: "Exact type from asset list (e.g., 'F-16C', 'M1A2')" },
                                            location: { type: "STRING", description: "Origin location (ONLY if 'new')" },
                                            airbase: { type: "STRING", description: "Airbase name (ONLY if 'new')" },
                                            unit_count: { type: "INTEGER", description: "Must be 2 for air units. 1 or more for ground/helos." },
                                            task: { type: "STRING", description: "MUST match a value in the unit's 'mission' array exactly, OR be 'RTB'." },
                                            target_area: { 
                                                type: "OBJECT",
                                                description: "Coordinates for the task",
                                                properties: {
                                                    lat: { type: "NUMBER" },
                                                    long: { type: "NUMBER" }
                                                }
                                            },
                                            target_name: { type: "STRING", description: "targetName from goals (if applicable)" },
                                            route_via: { type: "STRING", description: "targetName of the 'border_crossing' goal (Only required if invading AND such a goal exists in your list. Otherwise null)" },
                                            reference_entity: { type: "STRING", description: "name of the group or unit referenced by the task (if applicable)" },
                                            rationale: { type: "STRING", description: "Military reasoning, including a capability verification check." }
                                        },
                                        required: ["action_type", "task", "rationale"]
                                    }
                                }
                            },
                            required: ["mission_log", "actions"]
                        }
                    }
                ]
            }
        ];
		
		logger.info("Starting Gemini with model: " + model);
		
		let aiClient;
		
		if (authMethod === 'apikey') {
			const genai = require('@google/genai');
			GoogleGenAI = genai.GoogleGenAI;
            HarmCategory = genai.HarmCategory;
            HarmBlockThreshold = genai.HarmBlockThreshold;
			aiClient = new GoogleGenAI({ apiKey: authCredential });
		} else if (authMethod === 'vertex') {
            let projectId = "";
            try {
                const svcAccountData = fs.readFileSync(authCredential, 'utf8');
                const svcAccountJson = JSON.parse(svcAccountData);
                projectId = svcAccountJson.project_id;
            } catch (err) {
                logger.error("Error reading project_id", err);
            }
			
			process.env.GOOGLE_APPLICATION_CREDENTIALS = authCredential;
            process.env.GOOGLE_CLOUD_PROJECT = projectId;
            process.env.GOOGLE_CLOUD_LOCATION = 'global';
			
			const genai = require('@google/genai');
            GoogleGenAI = genai.GoogleGenAI;
            HarmCategory = genai.HarmCategory;
            HarmBlockThreshold = genai.HarmBlockThreshold;

            aiClient = new GoogleGenAI({
                vertexai: { 
                    project: projectId, 
                    location: 'global'
                }
            });
        }
		
		return {
            client: aiClient,
            model: model,
            config: {
                systemInstruction: instructions,
                tools: commanderTools,
                temperature: temperature || 0.1,
                maxOutputTokens: maxTokens || 4096,
                responseMimeType: 'application/json',
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
                ]
            }
        };
		
    }
	
    this.startChatSession = function(modelObj, history = []) {
		return modelObj.client.chats.create({
            model: modelObj.model,
            config: modelObj.config,
            history: history
        });
    }

    this.sendChatUpdate = async function(prompt, armedForces, coalitionTargets, coalitionTerritory) {
        try {
            let response = await armedForces.session.sendMessage({ message: prompt });
            
            const extractAndDeduplicateCalls = (res) => {
                const parts = res.candidates?.[0]?.content?.parts || [];
                return parts.filter(p => p.functionCall).map(p => p.functionCall);
            };
            
            let calls = extractAndDeduplicateCalls(response);
            let loopCount = 0;
            const MAX_TOOL_LOOPS = 25; // Presupuesto total
            const WARNING_THRESHOLD = 20; // Aviso previo

            while (calls && calls.length > 0) {
                loopCount++;
                logger.info(`[Tool Loop ${loopCount}/${MAX_TOOL_LOOPS}] Processed tool calls.`);

                // Válvula de seguridad extrema: Si la IA ignora el corte y sigue pidiendo herramientas, abortamos limpiamente.
                if (loopCount > MAX_TOOL_LOOPS) {
                    logger.info(`[Tool Call] AI refused to stop calling tools. Forcing graceful abort.`);
                    return JSON.stringify({ mission_log: "Intelligence gathering taking too long. Maintaining holding pattern for this cycle.", actions: [] });
                }

                const toolResponses = []; 

                for (const call of calls) {
                    let apiResponse = {};
                    logger.info(`[Tool Call] AI requested: ${call.name} | Args: ${JSON.stringify(call.args)}`);

                    // 1. Corte de suministro: Si llegamos al límite, todas las funciones devuelven un error estricto.
                    if (loopCount === MAX_TOOL_LOOPS) {
                        apiResponse = { 
                            status: "FORCE_END",
                            tactical_directive: "INTELLIGENCE GATHERING WINDOW EXPIRED. Stop calling tools. Output your final JSON actions array IMMEDIATELY based solely on the data you currently have." ,
                            expected_format: { mission_log: "Finalizing plan...", actions: [] }
                        };
                    } else {
                        // Ejecución normal de las herramientas
                        if (call.name === "submit_commander_orders") {
                            logger.info(`[Tool Call] AI submitted final orders. Exiting loop successfully.`);
                            return JSON.stringify(call.args);
                        } else if (call.name === "find_closest_capable_group") {
                            apiResponse = armedForces.findClosestCapableGroup(call.args.mission_type, call.args.target_lat, call.args.target_lon);
                        } else if (call.name === "get_theater_reserves_summary") {
                            apiResponse = armedForces.getTheaterReservesSummary();
                        } else if (call.name === "get_active_groups_by_mission") {
                            apiResponse = armedForces.getActiveGroupsByMission(call.args.mission_type);
                        } else if (call.name === "get_closest_active_group") {
                            apiResponse = armedForces.getClosestActiveGroup(call.args.mission_type, call.args.target_lat, call.args.target_lon);
                        } else if (call.name === "get_top_priority_goals") {
                            apiResponse = coalitionTargets.getTopPriorityGoals(call.args.count);
                        } else if (call.name === "get_goals_by_type") {
                            apiResponse = coalitionTargets.getGoalsByType(call.args.mission_type);
                        } else if (call.name === "is_target_in_friendly_territory") {
                            apiResponse = coalitionTerritory.isTargetInFriendlyTerritory(call.args.target_lat, call.args.target_lon);
                        } else if (call.name === "get_enemy_threats_near_location") {
                            apiResponse = armedForces.getEnemyThreatsNearLocation(call.args.target_lat, call.args.target_lon, call.args.radius_km);
                        } else if (call.name === "get_known_enemy_threats_by_type") {
                            apiResponse = armedForces.getKnownEnemyThreatsByType(call.args.threat_class);
                        } else if (call.name === "get_full_tactical_intel") {
                            // 1. Territory
                            const territoryCheck = coalitionTerritory.isTargetInFriendlyTerritory(call.args.target_lat, call.args.target_lon);
                            
                            // 2. Enemy Threats
                            const threatsCheck = armedForces.getEnemyThreatsNearLocation(call.args.target_lat, call.args.target_lon, call.args.threat_radius_km);
                            
                            // 3. Closest Reserves
                            const reservesCheck = armedForces.findClosestCapableGroup(call.args.required_mission_type, call.args.target_lat, call.args.target_lon);
                            
                            // 4. Closest Friendly Cover (SAM)
                            const coverCheck = armedForces.getClosestActiveGroup('SAM', call.args.target_lat, call.args.target_lon);

                            apiResponse = {
                                territory_status: territoryCheck,
                                closest_reserves_available: reservesCheck,
                                nearby_enemy_threats: threatsCheck,
                                closest_friendly_sam_cover: coverCheck
                            };
                        } else if (call.name === "get_all_active_groups") {
                            apiResponse = armedForces.getAllActiveGroups();
                        } else {
                            apiResponse = { error: "Function not implemented." };
                        }

                        // 2. Advertencia suave
                        if (loopCount >= WARNING_THRESHOLD) {
                            apiResponse._system_notice = `WARNING: Only ${MAX_TOOL_LOOPS - loopCount} tool rounds remaining. Prepare to finalize your strategy.`;
                        }
                    }

                    // Empaquetamos la respuesta en el formato estricto que exige la SDK
                    toolResponses.push({
                        functionResponse: {
                            id: call.id, 
                            name: call.name,
                            response: apiResponse
                        }
                    });
                }

                // Devolvemos los resultados (o los bloqueos) a la IA
                response = await armedForces.session.sendMessage({ message: toolResponses });
                calls = extractAndDeduplicateCalls(response);
            }
            
            // Extracción final del texto
            const textPart = response.candidates?.[0]?.content?.parts?.find(p => p.text);
            if (textPart && textPart.text) {
                return textPart.text;
            }
            
            // 3. Fallback seguro: Si no generó texto (por fallo o censura), devolvemos un JSON inofensivo para evitar petar main.js
            return JSON.stringify({ mission_log: "Commander is assessing the situation. No new orders issued.", actions: [] });
            
        } catch (err) {
            logger.error("Gemini API Error:", err);
            throw new Error(`API Request Failed: ${err.message || "Unknown communication error."}`);
        }
    }
	
	/**
	 * Re-bases the chat session to keep context while clearing old tactical noise.
	 * @param {Object} modelObj
	 * @param {Object} oldSession - The current active chat session.
	 * @param {number} keepTurns - Number of recent messages to retain (default: 4).
	 */
	this.rebaseChatSession = async function(modelObj, oldSession, keepTurns = 4) {
		try {
            const fullHistory = typeof oldSession.getHistory === 'function' 
                ? await oldSession.getHistory() 
                : oldSession.history || [];
            
            const truncatedHistory = fullHistory.slice(-keepTurns);
            
            return modelObj.client.chats.create({
                model: modelObj.model,
                config: modelObj.config,
                history: truncatedHistory
            });
        } catch (err) {
            logger.error("Re-base Error:", err);
            return oldSession;
        }
	}
	
	this.aiSanitizeJson = function(input) {
        if (!input) return null;

        try {
            return JSON.parse(input);
        } catch (err1) {
            let sanitized = input.replace(/```json/g, '').replace(/```/g, '').trim();
            try {
                return JSON.parse(sanitized);
            } catch (err2) {
                const jsonMatch = sanitized.match(/\{[\s\S]*\}/);
                
                if (jsonMatch && jsonMatch[0]) {
                    try {
                        return JSON.parse(jsonMatch[0]);
                    } catch (err3) {
                        logger.info("--- Cleanup failed (Regex extract):", jsonMatch[0]);
                        return null;
                    }
                } else {
                    logger.info("--- Cleanup failed (No JSON structure found):", sanitized);
                    return null;
                }
            }
        }
    }

}