-------------------------------------------------------------------------
-- Variables
--
--	*_EW: prefix for EW groups on mission editor. They can be any type of
--	unit and will contribute with their sensors to the enemy's detection,
--	ground or aerial radar, naval units, jtac, etc.
--
--	*_SAM: prefix for SAM groups 
--
--	*_BORDER: late activation group defining the coalition's border. Its
--	first and last WPs will be virtually joined to create a polygon
--
--	STATIC_RESOURCE: prefix of static units that will be passed to the AI
--	commander for them to task. Their names must also contain at least 
--	one task it can perform: CAP, SEAD, CAS, STRIKE, ANTI-SHIP, ESCORT,
--	TRANSPORT
--		"[STATIC_RESOURCE]RED_PLACEHOLDER_SU24M_SEAD_Kuweires_00004"
--
--	TEMPLATE_PREFIX: prefix for late activation group templates that will
--	be used when AI commander issues orders (using MOOSE SPAWN class). 
--	Name must contain, strictly in this, order the coalition, task and 
--	type class name
--		"[TEMPLATE_PREFIX]RED SEAD Su-24M"
--
--	SCHEDULER_ISR_FREQ_*: seconds passed between each ISR update data 
--	passed to AI Commander
--
--	SCHEDULER_TASKING_FREQ: seconds passed between each checking for new
--	tasking available
--
-------------------------------------------------------------------------

RED_EW = "RED EW"
RED_SAM = "RED SAM"
RED_BORDER = "RED BORDER"

BLUE_EW = "BLUE EW"
BLUE_SAM = "BLUE SAM"
BLUE_BORDER = "BLUE BORDER"

STATIC_RESOURCE = "AEM_RES"
TEMPLATE_PREFIX = "AEM_TPL_"

SCHEDULER_ISR_FREQ_RED = 60
SCHEDULER_ISR_FREQ_BLUE = 60
SCHEDULER_TASKING_FREQ = 60

-------------------------------------------------------------------------
-- // Code: DO NOT EDIT BEYOND THIS POINT
-------------------------------------------------------------------------

-- Global Resource Pools (Dictionaries for fast lookup)
-- Structure: Pool["AirbaseName|UnitType"] = { count=X, static_ids={...} }
AEM_Pool_Red = {}
AEM_Pool_Blue = {}

-- ======================================================================
-- Order of Battle
--
-- Generates the initial force composition and available resources.
-- ======================================================================

-- CONFIGURATION
local OUTPUT_DIR = ""
if lfs then
    OUTPUT_DIR = lfs.writedir() .. "Logs/"
end

local FILE_ACTIVE_RED     = OUTPUT_DIR .. "aem-active-red.json"
local FILE_ACTIVE_BLUE    = OUTPUT_DIR .. "aem-active-blue.json"
local FILE_AVAILABLE_RED  = OUTPUT_DIR .. "aem-available-red.json"
local FILE_AVAILABLE_BLUE = OUTPUT_DIR .. "aem-available-blue.json"
local FILE_GOALS_RED      = OUTPUT_DIR .. "aem-goals-red.json"
local FILE_GOALS_BLUE     = OUTPUT_DIR .. "aem-goals-blue.json"
local FILE_ISR_RED        = OUTPUT_DIR .. "aem-isr-red.json"
local FILE_ISR_BLUE       = OUTPUT_DIR .. "aem-isr-blue.json"
local FILE_ORDERS_RED     = OUTPUT_DIR .. "aem-orders-red.json"
local FILE_ORDERS_BLUE    = OUTPUT_DIR .. "aem-orders-blue.json"
local FILE_BORDER_RED     = OUTPUT_DIR .. "aem-border-red.json"
local FILE_BORDER_BLUE    = OUTPUT_DIR .. "aem-border-blue.json"

-- HELPER: Guess Mission from Group Name and return as an Array
local function GetMissionsFromName(groupName)
    local upperName = string.upper(groupName)
    local missions = {}
    
    if string.find(upperName, "CAP") then table.insert(missions, "CAP") end
    if string.find(upperName, "SEAD") then table.insert(missions, "SEAD") end
    if string.find(upperName, "CAS") then table.insert(missions, "CAS") end
    if string.find(upperName, "STRIKE") then table.insert(missions, "STRIKE") end
    if string.find(upperName, "ANTI-SHIP") then table.insert(missions, "ANTI-SHIP") end
    if string.find(upperName, "AWACS") then table.insert(missions, "AWACS") end
    if string.find(upperName, "TANKER") then table.insert(missions, "TANKER") end
    if string.find(upperName, "ESCORT") then table.insert(missions, "ESCORT") end
    if string.find(upperName, "SAM") then table.insert(missions, "SAM") end
    if string.find(upperName, "EW") then table.insert(missions, "EW") end
    if string.find(upperName, "TRANSPORT") then table.insert(missions, "TRANSPORT") end
    if string.find(upperName, "MBT") then table.insert(missions, "MBT") end
    
    -- Default if no keywords matched
    if #missions == 0 then table.insert(missions, "Idle") end
    
    return missions
end

-- HELPER: Get Category for Statics based on DCS internal descriptors
local function GetCategoryFromDCSStatic(staticObj)
    local dcsStatic = staticObj:GetDCSObject()
    
    if dcsStatic then
        local desc = dcsStatic:getDesc()
        
        if desc and desc.category then
            if desc.category == Unit.Category.AIRPLANE then 
                return "Air"
			elseif desc.category == Unit.Category.HELICOPTER then
				return "Helo"
            elseif desc.category == Unit.Category.GROUND_UNIT or desc.category == Unit.Category.STRUCTURE then 
                return "Ground"
            elseif desc.category == Unit.Category.SHIP then 
                return "Naval"
            end
        end
    end
    
    return "Unknown" -- Fallback assumption
end

-- HELPER: Safe JSON Writer
local function WriteJSONSafe(data, path)
    local success, err = pcall(function()
        UTILS.WriteJSON(data, path)
    end)
    if not success then
        env.info("AEM Export Error for " .. path .. ": " .. tostring(err))
    end
end

-------------------------------------------------------------------------
-- GENERATE OOB
-------------------------------------------------------------------------
function ExportOrderOfBattle()

    local active_red = {}
    local active_blue = {}
    local available_red_list = {}
    local available_blue_list = {}

    -- 1. DETECT ACTIVE FORCES (Deployed Groups)
    local ActiveSet = SET_GROUP:New():FilterActive():FilterStart()
    
    ActiveSet:ForEachGroup(function(group)
        local groupName = group:GetName()
        local coalitionVal = group:GetCoalition()
        
        if coalitionVal ~= coalition.side.NEUTRAL then
            local firstUnit = group:GetFirstUnitAlive()
            if firstUnit then
                local unitType = firstUnit:GetTypeName()
                local category = "Unknown"
                
                if group:IsAir() then category = "Air"
                elseif group:IsGround() then category = "Ground"
                elseif group:IsShip() then category = "Naval"
                end

                local coord = group:GetCoordinate()
                local lat, lon = coord:GetLLDDM()
                
                -- Determine Airbase Presence
                local nearestBase = coord:GetClosestAirbase()
                local airbaseName = ""
                if nearestBase and coord:Get2DDistance(nearestBase:GetCoordinate()) < 5000 then
                    airbaseName = nearestBase:GetName()
                end

                local entry = {
                    category = category,
                    count = group:CountAliveUnits(),
                    location = { lat = lat, long = lon },
                    airbase = airbaseName,
                    mission = GetMissionsFromName(groupName),
                    type = unitType,
                    id = groupName -- Useful for app tracking
                }
                
                if coalitionVal == coalition.side.RED then
                    table.insert(active_red, entry)
                else
                    table.insert(active_blue, entry)
                end
            end
        end
    end)

    -- 2. DETECT AVAILABLE RESOURCES (Statics with Prefix)
    -- This now populates the Global Pools: AEM_Pool_Red / AEM_Pool_Blue
    local StaticSet = SET_STATIC:New():FilterPrefixes(STATIC_RESOURCE):FilterStart()
    
    -- Reset pools just in case
    AEM_Pool_Red = {}
    AEM_Pool_Blue = {}

    StaticSet:ForEachStatic(function(static)
        local coalitionVal = static:GetCoalition()
        
        if coalitionVal ~= coalition.side.NEUTRAL then
            local typeName = static:GetTypeName()
            local staticName = static:GetName()
            local category = GetCategoryFromDCSStatic(static)
            
            local coord = static:GetCoordinate()
            local nearestBase = coord:GetClosestAirbase()
            local airbaseName = ""
            
            if nearestBase and coord:Get2DDistance(nearestBase:GetCoordinate()) < 5000 then
                airbaseName = nearestBase:GetName()
            end

            -- Create Key for Dictionary: "AirbaseName|UnitTypeName"
            local key = string.format("%s|%s", airbaseName, typeName)
            
            -- Select the correct global pool
            local dict = (coalitionVal == coalition.side.RED) and AEM_Pool_Red or AEM_Pool_Blue
            
            if not dict[key] then
                local lat, lon = coord:GetLLDDM()
                dict[key] = {
                    category = category,
                    count = 0,
                    location = { lat = lat, long = lon },
                    airbase = airbaseName,
                    mission = GetMissionsFromName(staticName),
                    type = typeName,
                    static_ids = {} -- Store list of actual static names
                }
            end
            
            dict[key].count = dict[key].count + 1
            table.insert(dict[key].static_ids, staticName)
        end
    end)

    -- Convert the Global Dictionary Pools back to Arrays for the JSON export
    for _, res in pairs(AEM_Pool_Red) do table.insert(available_red_list, res) end
    for _, res in pairs(AEM_Pool_Blue) do table.insert(available_blue_list, res) end

    -- 3. WRITE TO JSON FILES
    WriteJSONSafe(active_red, FILE_ACTIVE_RED)
    WriteJSONSafe(active_blue, FILE_ACTIVE_BLUE)
    WriteJSONSafe(available_red_list, FILE_AVAILABLE_RED)
    WriteJSONSafe(available_blue_list, FILE_AVAILABLE_BLUE)

    trigger.action.outText("AEM: Order of Battle Exported", 15)
end

-- Run once at 1 second into the mission
timer.scheduleFunction(ExportOrderOfBattle, nil, timer.getTime() + 1)

-- ======================================================================
-- Mission Goals
--
-- Exports mission goals defined by trigger zones with GOAL_RED / GOAL_BLUE
-- ======================================================================

function ExportGoals()
    local goals_red = {}
    local goals_blue = {}

    -- Parse env.mission.triggers.zones to directly read DCS Zone Properties
    if env.mission and env.mission.triggers and env.mission.triggers.zones then
        for _, zoneData in pairs(env.mission.triggers.zones) do
            local zoneName = zoneData.name
            
            if zoneName and (string.find(zoneName, "^GOAL_RED") or string.find(zoneName, "^GOAL_BLUE")) then
			
                -- Get Coordinates using MOOSE wrapper
                local mooseZone = ZONE:FindByName(zoneName)
                local lat, lon = 0, 0
                if mooseZone then
                    local coord = mooseZone:GetCoordinate()
                    lat, lon = coord:GetLLDDM()
                end

                local entry = {
                    id = zoneName,
                    target_area = { lat = lat, long = lon }
                }
                
				-- Extract custom properties from the Mission Editor
                if zoneData.properties then
                    for _, prop in pairs(zoneData.properties) do
						entry[prop.key] = prop.value
                    end
                end
				
                if string.find(zoneName, "^GOAL_RED") then
                    table.insert(goals_red, entry)
                elseif string.find(zoneName, "^GOAL_BLUE") then
                    table.insert(goals_blue, entry)
                end
            end
        end
    end

    -- Write to JSON Files
    WriteJSONSafe(goals_red, FILE_GOALS_RED)
    WriteJSONSafe(goals_blue, FILE_GOALS_BLUE)

    trigger.action.outText("AEM: Mission Goals Exported", 15)
end

-- Run once at 2 seconds into the mission
timer.scheduleFunction(ExportGoals, nil, timer.getTime() + 2)

-- ======================================================================
-- Map Borders
--
-- Exports the route points of specific late-activation groups to define borders
-- ======================================================================

function ExportBorders()
    
    -- Helper function to extract waypoints from a group's template
    local function GetGroupRouteCoordinates(groupName)
        local coordsArray = {}
        
        -- Find the group in the MOOSE database (works perfectly for late activation)
        local groupObj = GROUP:FindByName(groupName)
        
        if groupObj then
            -- Get the internal Mission Editor template for the group
            local template = groupObj:GetTemplate()
            
            if template and template.route and template.route.points then
                for _, wp in ipairs(template.route.points) do
                    -- In the DCS Mission Editor table, x is North/South, y is East/West
                    local coord = COORDINATE:NewFromVec2({x = wp.x, y = wp.y})
                    local lat, lon = coord:GetLLDDM()
                    
                    table.insert(coordsArray, {
                        lat = lat,
                        long = lon
                    })
                end
            end
        else
            env.info("AEM: Border group not found: " .. tostring(groupName))
        end
        
        return coordsArray
    end

    -- Extract both borders
	if (RED_BORDER) then
		local red_border_coords = GetGroupRouteCoordinates(RED_BORDER)
		WriteJSONSafe(red_border_coords, FILE_BORDER_RED)
	end
	if (BLUE_BORDER) then
		local blue_border_coords = GetGroupRouteCoordinates(BLUE_BORDER)
		WriteJSONSafe(blue_border_coords, FILE_BORDER_BLUE)
	end

    trigger.action.outText("AEM: Borders Exported", 15)
end

-- Run once at 3 seconds into the mission, staggering it from the other exports
timer.scheduleFunction(ExportBorders, nil, timer.getTime() + 3)

-- ======================================================================
-- ISR (Intelligence, Surveillance, Reconnaissance)
--
-- Updates the situation of enemy forces detected
-- ======================================================================

local BlueRecceSet = SET_GROUP:New():FilterPrefixes(BLUE_EW):FilterStart()
local BlueIntel = DETECTION_AREAS:New(BlueRecceSet, 30000)
BlueIntel:Start()

local RedRecceSet = SET_GROUP:New():FilterPrefixes(RED_EW):FilterStart()
local RedIntel = DETECTION_AREAS:New(RedRecceSet, 30000)
RedIntel:Start()

local ContactTracks = {}

-- Helper function to calculate heading/speed
local function GetTargetTelemetry(trackKey, currentCoord, timeNow)
    local speed = 0
    local heading = 0
    
    local trackData = ContactTracks[trackKey]
    if trackData then
        local timeDiff = timeNow - trackData.time
        if timeDiff > 0 then
            -- DCS Coordinates: x is North/South, z is East/West
            -- Extract raw primitive numbers to avoid Lua memory reference mutation
            local dx = currentCoord.x - trackData.x
            local dz = currentCoord.z - trackData.z
            
            -- Calculate 2D Distance
            local dist = math.sqrt((dx * dx) + (dz * dz))
            local speedMPS = dist / timeDiff
            speed = UTILS.MpsToKnots(speedMPS)
            
            -- Only update heading if moved a meaningful distance (> 50m)
            if dist > 50 then 
                local headingRad = math.atan2(dz, dx)
                heading = math.deg(headingRad)
                if heading < 0 then heading = heading + 360 end
            else
                -- Maintain previous heading if stationary/hovering
                heading = trackData.heading or 0 
            end
        end
    end
    
    -- Store raw coordinates (not the object) so they freeze in time
    ContactTracks[trackKey] = { 
        time = timeNow, 
        x = currentCoord.x, 
        z = currentCoord.z,
        heading = heading 
    }
    
    return speed, heading
end

-- Helper function to process an Intel object and return a JSON-ready array
local function ProcessIntelData(intelObject, detectorSide, targetSide, timeNow)

    local jsonArray = {}
	local detectedItems = intelObject:GetDetectedItems()
	
    for _, detectedItem in pairs(detectedItems) do
	
        local zone = detectedItem.Zone
        local zoneName = zone:GetName()
        local currentCoord = zone:GetCoordinate()
        local enemySet = detectedItem.Set 
        
        -- Create a unique track key to prevent Red and Blue from overwriting each other
        local trackKey = detectorSide .. "_" .. zoneName
		
		-- ----------------------------------------------------
        -- Gather Telemetry & Location
        -- ----------------------------------------------------
        local speed, heading = GetTargetTelemetry(trackKey, currentCoord, timeNow)
        local latNum, lonNum = currentCoord:GetLLDDM()
        
        -- Extract Altitude (currentCoord.y is in meters, convert to feet for standard aviation)
        local alt_ft = math.floor(currentCoord.y * 3.28084)
        
        local unitCount = enemySet:Count()
        
        -- ----------------------------------------------------
        -- Determine Type & Threat Score
        -- ----------------------------------------------------
        local primaryType = "Unknown"
        local threatScore = 0
        local firstUnit = enemySet:GetFirst()
        
        if firstUnit then
            if firstUnit:IsAir() then 
                primaryType = "Air"
                
                -- Base threat per aircraft
                local baseThreat = 10 
                
                -- Speed Modifiers
                if speed > 400 then baseThreat = baseThreat + 15      -- Fast Jet
                elseif speed > 250 then baseThreat = baseThreat + 5   -- Subsonic/Cruising
                else baseThreat = baseThreat - 5 end                  -- Helo/Slow Prop
                
                -- Altitude Modifiers
                if alt_ft < 3000 and speed > 350 then 
                    baseThreat = baseThreat + 20 -- Fast & Low (Strike Profile!)
                elseif alt_ft > 25000 then
                    baseThreat = baseThreat + 10 -- High Altitude (Fighter/Bomber)
                end
                
                -- Attribute Modifiers (If the radar was able to identify the exact type)
                if firstUnit:HasAttribute("Fighters") then baseThreat = baseThreat + 10 end
                if firstUnit:HasAttribute("Bombers") then baseThreat = baseThreat + 15 end
                
                threatScore = baseThreat * unitCount
                
            elseif firstUnit:IsGround() then 
                primaryType = "Ground"
                threatScore = 5 * unitCount
                
                -- Huge threat if the radar detects it's an enemy SAM system moving up
                if firstUnit:HasAttribute("Air Defence") then
                    threatScore = threatScore + 30 * unitCount
                end
                
            elseif firstUnit:IsShip() then 
                primaryType = "Naval"
                threatScore = 15 * unitCount
            end
        end

        local contactData = {
            id = zoneName,
            detectedBy = detectorSide,
            coalition = targetSide,
            type = primaryType,
            count = unitCount,
            latitude = latNum,
            longitude = lonNum,
            altitude_ft = alt_ft,
            speed_kts = math.floor(speed),
            heading = math.floor(heading),
            threat_score = math.floor(threatScore),
            timestamp = timeNow
        }
        
        table.insert(jsonArray, contactData)
    end
    
    return jsonArray
end

SCHEDULER:New(nil, function()

    local timeNow = timer.getTime()

    -- 1. Gather Red Intel (Red sensors detecting Blue units)
    local redJsonArray = ProcessIntelData(RedIntel, "RED", "BLUE", timeNow)
    WriteJSONSafe(redJsonArray, FILE_ISR_RED)

end, {}, 30, SCHEDULER_ISR_FREQ_RED)

SCHEDULER:New(nil, function()

    local timeNow = timer.getTime()
	
    -- 2. Gather Blue Intel (Blue sensors detecting Red units)
    local blueJsonArray = ProcessIntelData(BlueIntel, "BLUE", "RED", timeNow)
    WriteJSONSafe(blueJsonArray, FILE_ISR_BLUE)

end, {}, 35, SCHEDULER_ISR_FREQ_BLUE)

-- ======================================================================
-- Field command
--
-- Receive strategic tasking from commander and generate tactical orders
-- ======================================================================

-- Global Spawner Registry to ensure persistence
AEM_Spawners = {}

-- 1. Spawn Task Executor
local function SpawnAndTask(action, spawnTemplate, spawnAirbase)
    
    local SpawnObj = AEM_Spawners[spawnTemplate]
    
    if not SpawnObj then
        SpawnObj = SPAWN:New(spawnTemplate)
        AEM_Spawners[spawnTemplate] = SpawnObj
        env.info("AEM: Registered new Spawner for " .. spawnTemplate)
    end
    
    if action.unit_count and action.unit_count > 0 then
        SpawnObj:InitGrouping(action.unit_count)
    end
    
    -- Setup the callback *before* calling SpawnAtAirbase
    SpawnObj:OnSpawnGroup(function(NewGroup)
        
		-- NewGroup:CommandSetUnlimitedFuel(true)
		
        local groupName = NewGroup:GetName()
        trigger.action.outText(string.format("AEM: Executing Order - %s launched from %s", action.unit_type, action.airbase), 15)
        
        local FlightGroup = FLIGHTGROUP:New(NewGroup)
        local startCoord  = NewGroup:GetCoordinate()
        
        local targetLat = action.target_area.lat
        local targetLon = action.target_area.long
        local targetCoord = COORDINATE:NewFromLLDD(targetLat, targetLon)
        local zoneName = action.target_name or ("TGT-"..groupName)
        
        -- Radius default 20km
        local TargetZone = ZONE_RADIUS:New(zoneName, targetCoord:GetVec2(), 20000)	--- TODO:
        
        local Mission = nil
        local taskType = action.task
		local altitude = 20000
		local speed = 400
        
        if taskType == "CAP" or taskType == "ESCORT" then
		
			-- Flight parameters
			altitude = math.random(15000, 35000)
			speed = 450 -- knots TAS-ish
			
			-- Build a simple fighter sweep route
			local numWaypoints  = 3
			local lateralOffset = 60000

			local sweepWaypoint = nil

			for i = 1, numWaypoints do
				local bearing = startCoord:HeadingTo(targetCoord)
				local distance = startCoord:Get2DDistance(targetCoord)
				local step = distance * (i / (numWaypoints + 1))
				local side = math.random(0, 1) == 1 and 1 or -1
				local offset = side * math.random(lateralOffset * 0.4, lateralOffset)
				local wpCoord = startCoord:Translate(step, bearing)
				wpCoord = wpCoord:Translate(offset, bearing + 90 * side)

				sweepWaypoint = FlightGroup:AddWaypoint(
					wpCoord,
					speed,
					nil,
					altitude,
					false
				)
			end

			-- Final sweep center point
			FlightGroup:AddWaypoint(
				targetCoord,
				speed,
				nil,
				altitude,
				true
			)
			
			-- Fighter sweep mission
			local sweepMission = AUFTRAG:NewCAP(
				ZONE_RADIUS:New(zoneName, targetCoord:GetVec2(), 100000),
				altitude,
				speed,
				targetCoord
			)

			function FlightGroup:OnAfterPassingWaypoint(From, Event, To, Waypoint)
				if Waypoint.uid == sweepWaypoint.uid then
					self:AddMission(sweepMission)
				end
			end
            
        elseif taskType == "CAS" then
		
			-- Flight parameters
			altitude = math.random(8000, 18000)
			speed = 350
			
			-- Build a simple fighter sweep route
			local numWaypoints  = 3
			local lateralOffset = 40000

			local casTriggerWaypoint = nil

			for i = 1, numWaypoints do
				local bearing = startCoord:HeadingTo(targetCoord)
				local distance = startCoord:Get2DDistance(targetCoord)
				local step = distance * (i / (numWaypoints + 1))
				local side = math.random(0, 1) == 1 and 1 or -1
				local offset = side * math.random(lateralOffset * 0.3, lateralOffset)
				local wpCoord = startCoord:Translate(step, bearing)
				wpCoord = wpCoord:Translate(offset, bearing + 90 * side)

				casTriggerWaypoint = FlightGroup:AddWaypoint(
					wpCoord,
					speed,
					nil,
					altitude,
					false
				)
			end

			-- Final ingress point
			FlightGroup:AddWaypoint(
				targetCoord,
				speed,
				nil,
				altitude,
				true
			)
			
			local casMission = AUFTRAG:NewCAS(
				ZONE_RADIUS:New(zoneName, targetCoord:GetVec2(), 50000),
				math.random(4000, 10000),
				350,
				targetCoord
			)
			
			function FlightGroup:OnAfterPassingWaypoint(From, Event, To, Waypoint)
				if Waypoint.uid == casTriggerWaypoint.uid then
					self:AddMission(casMission)
				end
			end
            
        elseif taskType == "SEAD" then
		
			-- Flight parameters
			altitude = math.random(18000, 26000)
			speed = 420
			
			-- Build a simple fighter sweep route
			local numWaypoints  = 3
			local lateralOffset = 50000

			local seadTriggerWaypoint = nil

			for i = 1, numWaypoints do
				local bearing = startCoord:HeadingTo(targetCoord)
				local distance = startCoord:Get2DDistance(targetCoord)
				local step = distance * (i / (numWaypoints + 1))
				local side = math.random(0, 1) == 1 and 1 or -1
				local offset = side * math.random(lateralOffset * 0.3, lateralOffset)
				local wpCoord = startCoord:Translate(step, bearing)
				wpCoord = wpCoord:Translate(offset, bearing + 90 * side)

				seadTriggerWaypoint = FlightGroup:AddWaypoint(
					wpCoord,
					speed,
					nil,
					altitude,
					false
				)
			end

			-- Final approach
			FlightGroup:AddWaypoint(
				targetCoord,
				speed,
				nil,
				altitude,
				true
			)
			
			local seadMission = AUFTRAG:NewSEAD(
				ZONE_RADIUS:New(zoneName, targetCoord:GetVec2(), 100000),
				altitude
			)
			
			function FlightGroup:OnAfterPassingWaypoint(From, Event, To, Waypoint)
				if Waypoint.uid == seadTriggerWaypoint.uid then
					self:AddMission(seadMission)
				end
			end
        
		elseif taskType == "STRIKE" then
		
			-- Use NewCASENHANCED for area search/destroy or NewBOMBING if strict point
            -- Using NewCASENHANCED allows engaging targets in the zone area
            -- Mission = AUFTRAG:NewCASENHANCED(TargetZone, 15000, 350)
			
			-- Flight parameters for a high-speed ingress
			altitude = math.random(10000, 15000)
			speed = 350
			
			-- Build a basic strike routing
			local numWaypoints  = 3
			local lateralOffset = 30000

			local strikeTriggerWaypoint = nil

			for i = 1, numWaypoints do
				local bearing = startCoord:HeadingTo(targetCoord)
				local distance = startCoord:Get2DDistance(targetCoord)
				local step = distance * (i / (numWaypoints + 1))
				local side = math.random(0, 1) == 1 and 1 or -1
				local offset = side * math.random(lateralOffset * 0.2, lateralOffset)
				local wpCoord = startCoord:Translate(step, bearing)
				wpCoord = wpCoord:Translate(offset, bearing + 90 * side)

				strikeTriggerWaypoint = FlightGroup:AddWaypoint(
					wpCoord,
					speed,
					nil,
					altitude,
					false
				)
			end

			-- Final target waypoint
			FlightGroup:AddWaypoint(
				targetCoord,
				speed,
				nil,
				altitude,
				true
			)
			
			-- NewBOMBING is the standard MOOSE AUFTRAG for coordinate/point strikes
			local strikeMission = AUFTRAG:NewBOMBING(targetCoord, altitude, speed)
			
			function FlightGroup:OnAfterPassingWaypoint(From, Event, To, Waypoint)
				if Waypoint.uid == strikeTriggerWaypoint.uid then
					self:AddMission(strikeMission)
				end
			end
            
        elseif taskType == "AWACS" then
            -- NewAWACS(Coordinate, Altitude, Speed, Heading, Leg)
            -- Mission = AUFTRAG:NewAWACS(targetCoord, 25000, 350)
            
        elseif taskType == "TANKER" then
            -- NewTANKER(Coordinate, Altitude, Speed, Heading, Leg, RefuelSystem)
            -- Mission = AUFTRAG:NewTANKER(targetCoord, 20000, 350)
        end
        
    end)
    
    -- Trigger the spawn, which will eventually call the OnSpawnGroup function above
    SpawnObj:SpawnAtAirbase(spawnAirbase, SPAWN.Takeoff.Runway, nil) 
end

-- 2. Generic Order Processor using Global Resource Pools
local function ProcessOrderFile(filePath, resourcePool, coalition)
    
    -- 1. CHECK IF FILE EXISTS
    -- Attempt to open the file in read mode. If it fails, the file isn't there yet.
    local file = io.open(filePath, "r")
    if not file then 
        return -- File does not exist, exit silently and wait for the next 60s cycle
    end
    file:close() -- Always close the file handle after checking!
	
    -- 2. READ AND PROCESS ORDERS
    local actions = UTILS.ReadJSON(filePath)
    if not actions then return end
    
    local ordersExecuted = false
    
    for _, action in ipairs(actions) do
        if action.action_type == "new" then
            
            -- Construct the Dictionary Key based on Airbase and Type
            -- "AirbaseName|TypeName"
            local poolKey = action.airbase .. "|" .. action.unit_type
            local poolEntry = resourcePool[poolKey]
            
            local templateName = TEMPLATE_PREFIX..coalition.." "..action.task.." "..action.unit_type
            
            -- VALIDATION CHAIN
            -- 1. Check if we have resources in the pool
            if poolEntry and poolEntry.count > 0 then
                
                -- 2. Check if the Airbase exists in DCS
                local Airbase = AIRBASE:FindByName(action.airbase)
                if Airbase then
                    
                    -- 3. Check if Template Exists
                    if GROUP:FindByName(templateName) then
                        
                        -- 4. CONSUME RESOURCE
                        -- We iterate through the static_ids to find one that is still alive
                        local validStatic = nil
                        
                        while #poolEntry.static_ids > 0 do
                            local staticName = poolEntry.static_ids[1] -- Peek first item
                            local staticObj = STATIC:FindByName(staticName, false)
                            
                            -- Remove it from the list regardless of state (we are consuming it or cleaning it)
                            table.remove(poolEntry.static_ids, 1)
                            poolEntry.count = poolEntry.count - 1
                            
                            if staticObj and staticObj:IsAlive() then
                                validStatic = staticObj
                                break -- We found a live one!
                            end
                            -- If static was nil (bombed?), loop continues to check the next one
                        end
                        
                        if validStatic then
                            -- Execute
                            validStatic:Destroy() -- Consume the token
                            SpawnAndTask(action, templateName, Airbase)
                            ordersExecuted = true
                        else
                            env.info("AEM Commander: Pool had count but all statics were missing/dead for " .. poolKey)
                        end
                        
                    else
                        env.info("AEM Commander: Template not found " .. templateName)
                    end
                else
                    env.info("AEM Commander: Airbase not found " .. action.airbase)
                end
            else
                env.info("AEM Commander: No resources available in pool for " .. poolKey)
            end
        end
    end
    
    -- 3. DELETE THE FILE
    -- Once parsed (even if no valid orders were executed due to validation failures), 
    -- delete the file so the external app knows it was consumed and we don't process it again.
    os.remove(filePath)
end

-- 3. Scheduler to check Red and Blue orders
SCHEDULER:New(nil, function()

    ProcessOrderFile(FILE_ORDERS_RED, AEM_Pool_Red, "RED")
    -- ProcessOrderFile(FILE_ORDERS_BLUE, AEM_Pool_Blue, "BLUE") -- Ready for Blue AI

end, {}, 5, SCHEDULER_TASKING_FREQ)

trigger.action.outText("AEM Commander loaded", 15)