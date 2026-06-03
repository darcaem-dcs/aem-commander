const fs = require('fs');

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
                ]
            }
        ];
		
		console.log("Starting Gemini with model: " + model);
		
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
                console.error("Error reading project_id", err);
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
            const MAX_TOOL_LOOPS = 12;
			const HARD_KILL_LIMIT = 14;
			
			while (calls && calls.length > 0) {
                loopCount++;
				if (loopCount >= HARD_KILL_LIMIT) {
                    console.log("[Tool Call] Force exit.");
                    break;
                }
				
                const toolResponses = []; 

                for (const call of calls) {
                    let apiResponse = {};
                    console.log(`[Tool Call] AI requested: ${call.name}`);

                    if (loopCount > MAX_TOOL_LOOPS) {
                        apiResponse = { system_error: "TIME EXPIRED. GENERATE THE FINAL JSON NOW." };
                    } else {
						if (call.name === "find_closest_capable_group") {
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
						} else {
                            apiResponse = { error: "Function not implemented." };
                        }
                    }

                    toolResponses.push({
                        functionResponse: {
                            id: call.id, 
                            name: call.name,
                            response: apiResponse
                        }
                    });
                }

                // Devolvemos los resultados a la IA
                response = await armedForces.session.sendMessage({ message: toolResponses });
                calls = extractAndDeduplicateCalls(response);
			}
			
			const textPart = response.candidates?.[0]?.content?.parts?.find(p => p.text);
            if (textPart && textPart.text) {
                return textPart.text;
            }
			
			return "";
            
        } catch (err) {
            console.error("Gemini API Error:", err);
            return null;
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
            console.error("Re-base Error:", err);
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
                        console.log("--- Cleanup failed (Regex extract):", jsonMatch[0]);
                        return null;
                    }
                } else {
                    console.log("--- Cleanup failed (No JSON structure found):", sanitized);
                    return null;
                }
            }
        }
    }

}