-------------------------------------------------------------------------
-- CUSTOM SETTINGS
--
-- MISSION_NAME: Name of the mission for the persistence file
--
-- HOST_IP: IP address where the AEM Commander app is running. It is 
-- designed to run on the same machine as DCS (127.0.0.1) or on a
-- different machine in the same LAN. Port 49080 must be available
-- and not blocked by firewalls.
--
-- SOCKET_MAX_RETRIES: Number of times the script will try to connect to
-- the AEM Commander companion app. If failed, network loop will stop so
-- the mission can continue to be player without external AI control.
--
-- AUTO_CONNECT: opens connection with companion app automatically when
-- mission starts, or adds an F10 menu option to connect manually.
-- IP_RANGE_*: if not AUTO_CONNECT allows you to change the IP directly
-- through the F10 menu before connecting.
-- FIND_IP: if AUTO_CONNECT, scans the local network for the companion 
-- app and connects to the first one found. Only works if the companion 
-- app is running on a different machine in the same LAN.
--
-------------------------------------------------------------------------

MISSION_NAME = "Marianas sandbox"  -- SET YOUR MISSION NAME HERE

HOST_IP = "192.168.1.39"        -- CHANGE TO 127.0.0.1 or your LAN IP !!!
SOCKET_MAX_RETRIES = 2

AUTO_CONNECT = false
IP_RANGE_FROM = 39
IP_RANGE_TO = 45
FIND_IP = AUTO_CONNECT and true

-------------------------------------------------------------------------
-- AI Commander
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
--  UNLIMITED_FUEL: AI spawned flights will have unlimited fuel
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
RED_INFANTRY = "AEM_RED_INFANTRY"
BLUE_INFANTRY = "AEM_BLUE_INFANTRY"

SCHEDULER_ISR_FREQ_RED = 60
SCHEDULER_ISR_FREQ_BLUE = 60

UNLIMITED_FUEL = true

-------------------------------------------------------------------------
-- CSAR
--
--	*_RAFT: late activation group name for the water template
--	*_PILOT: late activation group name for the ground template
--	SINKING_SHIP: not used yet
--
--	__CSAR_SOS: filename that will be used as beacon. Add the file to
--  the mission by placing a "sound for country" trigger
--
-------------------------------------------------------------------------

MODULE_CSAR = true
BLUE_RAFT = "BLUE LIFE RAFT"
BLUE_PILOT = "BLUE DOWNED PILOT"
RED_RAFT = "RED LIFE RAFT"
RED_PILOT = "RED DOWNED PILOT"
__CSAR_SOS = "morse-sos.ogg"        -- ADD YOUR OWN SOUND FILE

-------------------------------------------------------------------------
-- CIVILIAN TRAFFIC
--
--  Generates neutral background traffic between airbases and zones.
--
--  CIV_TEMPLATES: name of the late activation templates
--  CIV_ZONE_PREFIX: to determine spawn and despawn zones
--  CIV_INIT_FLIGHTS: how many flights will spawn at mission start
--  CIV_MAX_FLIGHTS: max number of flights alive at any given time
--  CIV_MIN_DIST_METERS: minimum distance between origin and destination
--  CIV_ALLOWED_AIRBASES: table with the airports that can be used
--
-------------------------------------------------------------------------

MODULE_CIV_TRAFFIC = true
CIV_TEMPLATES = {
	"CIV_TPL_B737",
	"CIV_TPL_B737-1",
	"CIV_TPL_B737-2",
	"CIV_TPL_B737-3",
	"CIV_TPL_B737-4",
	"CIV_TPL_A320", 
	"CIV_TPL_A320-1", 
	"CIV_TPL_A320-2",
	"CIV_TPL_A320-3",
	"CIV_TPL_A320-4",
	"CIV_TPL_A330",
	"CIV_TPL_A330-1",
	"CIV_TPL_A330-2",
	"CIV_TPL_A330-3"
}
CIV_ZONE_PREFIX = "CIV_ZONE"
CIV_INIT_FLIGHTS = 5
CIV_MAX_FLIGHTS = 20
CIV_MIN_DIST_METERS = 185200 -- 100nm (185 km aprox)
CIV_ALLOWED_AIRBASES = {
    "Antonio B. Won Pat Intl",
    "Saipan Intl",
    "Rota Intl"
}

-------------------------------------------------------------------------
-- Ballistic missiles
--
--	BALLISTIC_MISSILE_RANGE: max range of the available launchers, 290km
--  for SCUDs or 400km for Iskanders
--
-------------------------------------------------------------------------

BALLISTIC_MISSILE_RANGE = 400000

-------------------------------------------------------------------------
-- Debug messages
--
--	Show on screen messages (can be switched ingame with F10 menu)
--
-------------------------------------------------------------------------

MODULE_DEBUG = true

-------------------------------------------------------------------------
--
-- // Code: DO NOT EDIT BEYOND THIS POINT //
--
-------------------------------------------------------------------------

HOST_PORT = 49080

-- ======================================================================
-- F10 menu
-- ======================================================================

local function switchDebug()
	MODULE_DEBUG = not MODULE_DEBUG
	trigger.action.outText("AEM Commander debug messages " .. ("activated" and MODULE_DEBUG or "deactivated"), t)
end

local menuAEM = missionCommands.addSubMenu("AEM Commander", nil)
missionCommands.addCommand("Show debug messages", menuAEM, function() switchDebug() end, nil)

-- ======================================================================
-- Log
-- ======================================================================

local function messageToAll(message, t)
	if MODULE_DEBUG then
		trigger.action.outText(message, t or 15)
	end
end

local function messageToCoalition(coalition, message, t)
    if MODULE_DEBUG then
        trigger.action.outTextForCoalition(coalition, message, t)
    end
end

local function printBootStatus()
    env.info("==================================================")
    env.info(" AEM COMMANDER: SCRIPT LOADED")
    env.info("==================================================")
    
    -- Feature Toggles
    env.info(" -> MODULE_CSAR: " .. tostring(MODULE_CSAR))
	env.info(" -> MODULE_DEBUG: " .. tostring(MODULE_DEBUG))
    
    -- Network info
    if AUTO_CONNECT then
	    env.info(" -> TCP BRIDGE: " .. tostring(HOST_IP) .. ":" .. tostring(HOST_PORT))
    else 
	    env.info(" -> TCP BRIDGE MANUAL CONNECTION")
    end
    
    -- Basic Settings
    env.info(" -> ISR UPDATE FREQ (RED): " .. tostring(SCHEDULER_ISR_FREQ_RED) .. "s")
    env.info(" -> ISR UPDATE FREQ (BLUE): " .. tostring(SCHEDULER_ISR_FREQ_BLUE) .. "s")
    
    env.info("==================================================")
    
    -- Feedback in-game
    messageToAll("AEM Commander loaded successfully.", 15)
end

-- ======================================================================
-- AEM NETWORK BRIDGE
-- ======================================================================

package.path  = package.path..";.\\LuaSocket\\?.lua;"
package.cpath = package.cpath..";.\\LuaSocket\\?.dll;"

local socket = require("socket")
local tcp_conn = nil
local AEM_Socket_Retries = 0
local menuConnectServer = nil
local FIND_IP_COUNTER = IP_RANGE_FROM
local scan_initialized = false

-- Helper function to replace the last number of the IP
local function setHostIP(newOctet)
    -- Uses regex to capture everything up to the final dot in the IP string
    local baseIP = string.match(HOST_IP, "^(.*%.)%d+$")
    if baseIP then
        HOST_IP = baseIP .. tostring(newOctet)
        trigger.action.outText("AEM Commander HQ IP updated to: " .. HOST_IP, 10)
    else
        trigger.action.outText("AEM Commander Error: Malformed Base IP", 10)
    end
end

local function SendToNode(dataType, coalitionStr, payload)
    if not tcp_conn then return end

    local message = {
        type = dataType,
        coalition = string.upper(coalitionStr),
        data = payload
    }
    
    local success, jsonString = pcall(json.encode, message)
    if success then
        local _, err = tcp_conn:send(jsonString .. "\n")
        
        if err and err ~= "timeout" then
			messageToAll("AEM Commander: connection with HQ lost", 15)
            env.info("AEM Commander disconnected while sending data: " .. tostring(err))
            tcp_conn:close()
            tcp_conn = nil
        end
    else
		messageToAll("AEM Commander: failed to send intelligence to HQ", 15)
        env.info("AEM Commander: Error encoding JSON for " .. dataType)
    end
end

local function AEM_ConnectTCP()
    tcp_conn = socket.tcp()
    tcp_conn:settimeout(0.5) 
	local success, err = tcp_conn:connect(HOST_IP, HOST_PORT)
	if not success then
        messageToAll("AEM Commander: failed to init connection with HQ", 15)
        env.info("AEM Commander failed to init TCP " .. HOST_IP .. ":" .. HOST_PORT .. " - " .. tostring(err))
        tcp_conn = nil
    else
        tcp_conn:settimeout(0)
        env.info("AEM Commander: TCP Connection established successfully!")
		messageToAll("AEM Commander: connection with HQ established", 15)
		SendToNode("INIT", "ALL", { 
            mission_name = MISSION_NAME, 
            ballistic_range = BALLISTIC_MISSILE_RANGE 
        })
        if menuConnectServer ~= nil then
            missionCommands.removeItem(menuConnectServer)
            menuConnectServer = nil
        end

        -- Scan battlefield and send initial report
        timer.scheduleFunction(ExportOrderOfBattle, nil, timer.getTime() + 1)
        timer.scheduleFunction(ExportGoals, nil, timer.getTime() + 2)
        timer.scheduleFunction(ExportBorders, nil, timer.getTime() + 3)
    end
end

function AEM_ReceiveOrders(jsonString)
    local success, msg = pcall(json.decode, jsonString)
    
    if success and msg then
        if msg.type == "ORDERS" then
            if ProcessAIOrders then
                ProcessAIOrders(msg.actions, msg.coalition)
            end   
        elseif msg.type == "MESSAGE" then
            local side = string.upper(msg.coalition)
            local dcsCoalition = (side == "RED") and coalition.side.RED or (side == "BLUE" and coalition.side.BLUE or coalition.side.ALL)
            
            if dcsCoalition == coalition.side.ALL then
                messageToAll("AEM Commander: " .. tostring(msg.text), 15)
            else
                messageToCoalition(dcsCoalition, "AEM Commander: " .. tostring(msg.text), 15)
            end
        end
    else
        messageToAll("AEM Commander: failed to recieve orders from HQ", 15)
        env.info("AEM Commander: Error decoding tasks or JSON malformed.")
    end

end

local function AEM_NetworkLoop()
    
    if not tcp_conn then
		if not FIND_IP and AEM_Socket_Retries >= SOCKET_MAX_RETRIES then
            env.info("AEM Commander: max TCP retires reached (" .. SOCKET_MAX_RETRIES .. "). Stopping network loop.")
            messageToAll("AEM Commander: HQ offline. Free flight.", 15)
            return nil
        end
        AEM_Socket_Retries = AEM_Socket_Retries + 1
        AEM_ConnectTCP()
        if not tcp_conn then
            if FIND_IP then
                if scan_initialized then
                    FIND_IP_COUNTER = FIND_IP_COUNTER + 1
                else
                    FIND_IP_COUNTER = IP_RANGE_FROM
                    scan_initialized = true
                end
                if FIND_IP_COUNTER <= IP_RANGE_TO then
                    setHostIP(FIND_IP_COUNTER)
                    return timer.getTime() + 1 -- Reintentar en 1 segundos
                else
                    env.info("AEM Commander: server IP not found in range (" .. IP_RANGE_FROM .. " - " .. IP_RANGE_TO .. "). Stopping network loop.")
                    messageToAll("AEM Commander: HQ offline. Free flight.", 15)
                    return nil
                end
            else
                return timer.getTime() + 5 -- Reintentar en 5 segundos
            end
        end
    end
	
	if tcp_conn then
        AEM_Socket_Retries = 0
    end

	-- Read new data
    while true do
        local line, err = tcp_conn:receive("*l")
        
        if line then
            AEM_ReceiveOrders(line)
        else
            if err == "closed" then
				messageToAll("AEM Commander: connection with HQ lost", 15)
                env.info("AEM Commander: La conexión TCP fue cerrada por el servidor.")
                tcp_conn:close()
                tcp_conn = nil
                return timer.getTime() + 5
			elseif err == "timeout" then
                -- No new data
                break
            else
                env.info("AEM Commander unexpected TCP error: " .. tostring(err))
                tcp_conn:close()
                tcp_conn = nil
                return timer.getTime() + 5
            end
        end
    end

    return timer.getTime() + 0.1 -- Ejecuta este chequeo 10 veces por segundo
end

-- ======================================================================
-- Event handlers
-- ======================================================================

AEM_Events_Red = {}
AEM_Events_Blue = {}

local function PushEvent(coalitionStr, eventData)
    local q = (string.lower(coalitionStr) == "red") and AEM_Events_Red or AEM_Events_Blue
    table.insert(q, eventData)
end

local function FlushEvents()
    if #AEM_Events_Red > 0 then
        SendToNode("EVENTS", "RED", AEM_Events_Red)
        AEM_Events_Red = {} 
    end
    if #AEM_Events_Blue > 0 then
        SendToNode("EVENTS", "BLUE", AEM_Events_Blue)
        AEM_Events_Blue = {}
    end
end

SCHEDULER:New(nil, FlushEvents, {}, 10, 30)

local AEM_DeathHandler = {}
function AEM_DeathHandler:onEvent(event)
    -- Only listen for Dead or Crash events
    if event.id == world.event.S_EVENT_DEAD or event.id == world.event.S_EVENT_CRASH then
        if not event.initiator then return end
        
        -- Ignore missiles, bombs, and scenery objects
        local success, category = pcall(function() return event.initiator:getCategory() end)
        if not success or (category ~= Object.Category.UNIT and category ~= Object.Category.STATIC) then
            return
        end
        
        local targetGroupName = nil
        local targetUnitName = nil
        local coalStr = nil

        pcall(function()
            -- Get Coalition
            local c = event.initiator:getCoalition()
            if c == 1 then coalStr = "red"
            elseif c == 2 then coalStr = "blue" end
            
            -- Try to get Group Name first
            if event.initiator.getGroup then
                local grp = event.initiator:getGroup()
                if grp then
                    targetGroupName = grp:getName()
                end
            end
            
            -- Fallback to Unit Name
            targetUnitName = event.initiator:getName()

            if not groupName and unitName then
                -- Match everything up to the last dash followed by digits
                local derivedGroup = string.match(unitName, "^(.*)-%d+$")
                if derivedGroup then
                    groupName = derivedGroup
                else
                    groupName = unitName -- Fallback for statics or un-numbered units
                end
            end
        end)

        if targetUnitName and coalStr then
            env.info("AEM Commander: unit destroyed -> " .. tostring(targetUnitName))
            PushEvent(coalStr, {
                type = "destroyed",
                coalition = coalStr,
                unitName = targetUnitName,
                groupName = targetGroupName
            })
            FlushEvents() -- Send to Node.js immediately
        end
    end
end
world.addEventHandler(AEM_DeathHandler)

-- ======================================================================
-- Order of Battle
--
-- Generates the initial force composition and available resources.
-- ======================================================================

-- HELPER: Guess Mission from Group Name and return as an Array
local function GetMissionsFromName(groupName)
    local upperName = string.upper(groupName)
    local missions = {}
    
    -- Aereal combat missions
    if string.find(upperName, "INTERCEPT") then table.insert(missions, "INTERCEPT") end
    if string.find(upperName, "CAP") then table.insert(missions, "CAP") end
    if string.find(upperName, "SEAD") then table.insert(missions, "SEAD") end
    if string.find(upperName, "CAS") then table.insert(missions, "CAS") end
    if string.find(upperName, "STRIKE") then table.insert(missions, "STRIKE") end
    if string.find(upperName, "ANTI%-SHIP") then table.insert(missions, "ANTI-SHIP") end
    if string.find(upperName, "ESCORT") then table.insert(missions, "ESCORT") end
	if string.find(upperName, "CSAR") then table.insert(missions, "CSAR") end

    -- Ground combat missions
    if string.find(upperName, "ASSAULT") then table.insert(missions, "ASSAULT") end
    if string.find(upperName, "FIRE_SUPPORT") then table.insert(missions, "FIRE_SUPPORT") end
    if string.find(upperName, "BALLISTIC") then table.insert(missions, "BALLISTIC") end

    -- Transport and logistic missions
    if string.find(upperName, "TRANSPORT_TROOPS") then table.insert(missions, "TRANSPORT_TROOPS") end
    if string.find(upperName, "TRANSPORT_LOGISTICS") then table.insert(missions, "TRANSPORT_LOGISTICS") end
    
    -- Non-IA controlled units
    if string.find(upperName, "AWACS") then table.insert(missions, "AWACS") end
    if string.find(upperName, "TANKER") then table.insert(missions, "TANKER") end
    if string.find(upperName, "EW") then table.insert(missions, "EW") end
    if string.find(upperName, "SAM") then table.insert(missions, "SAM") end
    if string.find(upperName, "AAA") then table.insert(missions, "AAA") end
    
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

-- ======================================================================
-- Performance Optimization: Cached Airbases
-- ======================================================================
local AEM_CachedAirbases = nil

local function GetFastAirbasePresence(vec3)
    if not vec3 then return "" end
    
    -- Build the cache only once
    if not AEM_CachedAirbases then
        AEM_CachedAirbases = {}
        if world and world.getAirbases then
            for _, airbase in pairs(world.getAirbases()) do
                if airbase and airbase:isExist() then
                    local point = airbase:getPoint()
                    table.insert(AEM_CachedAirbases, {
                        name = airbase:getName(),
                        x = point.x,
                        z = point.z
                    })
                end
            end
        end
    end

    local closestName = ""
    local minDistSq = 25000000 -- 5000m squared (equivalent to your 5km check)

    -- Ultra-fast native Lua distance check
    for _, base in ipairs(AEM_CachedAirbases) do
        local dx = vec3.x - base.x
        local dz = vec3.z - base.z
        local distSq = (dx * dx) + (dz * dz) -- 2D distance calculation
        
        if distSq < minDistSq then
            minDistSq = distSq
            closestName = base.name
        end
    end

    return closestName
end

function ExportOrderOfBattle()

    env.info("==================================================")
    env.info(" AEM COMMANDER: ORDER OF BATTLE")
    env.info("==================================================")

    local active_red = {}
    local active_blue = {}
    local available_red_list = {}
    local available_blue_list = {}
	local AEM_Pool_Red = {}
    local AEM_Pool_Blue = {}

    -- 1. DETECT ACTIVE FORCES (Deployed Groups)
    local ActiveSet = SET_GROUP:New():FilterStart()
    
	env.info("Active groups:")
	
    ActiveSet:ForEachGroup(function(group)
        local groupName = group:GetName()
        local coalitionVal = group:GetCoalition()
        
		if coalitionVal ~= coalition.side.NEUTRAL and group:IsAlive() then
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
				
				local key = string.format("%s|%s|%s", airbaseName, unitType, table.concat(entry.mission, ","))
				env.info(" -> " .. key .. " (" .. coalitionVal .. ")")
                
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
	
	env.info("Static units:")

    StaticSet:ForEachStatic(function(static)
        local coalitionVal = static:GetCoalition()
        
        if coalitionVal ~= coalition.side.NEUTRAL then
            local typeName = static:GetTypeName()
            local staticName = static:GetName()
            local category = GetCategoryFromDCSStatic(static)
            
            local coord = static:GetCoordinate()
			
			-- Determine Airbase Presence (Optimized)
			local rawPoint = coord:GetVec3()
            local airbaseName = GetFastAirbasePresence(rawPoint)
			
			local staticMissions = GetMissionsFromName(staticName)
            table.sort(staticMissions)
            local missionString = table.concat(staticMissions, "_")

            -- Create Key for Dictionary: "AirbaseName|UnitTypeName|Missions"
            local key = string.format("%s|%s|%s", airbaseName, typeName, missionString)
			env.info(" -> " .. key .. " (" .. coalitionVal .. ")")
            
            -- Select the correct global pool
            local dict = (coalitionVal == coalition.side.RED) and AEM_Pool_Red or AEM_Pool_Blue
            
            if not dict[key] then
                local lat, lon = coord:GetLLDDM()
                dict[key] = {
                    category = category,
                    count = 0,
                    location = { lat = lat, long = lon },
                    airbase = airbaseName,
                    mission = staticMissions, -- Pass the accurately parsed array
                    type = typeName,
                    static_ids = {}
                }
            end
            
            dict[key].count = dict[key].count + 1
            table.insert(dict[key].static_ids, staticName)
			
        end
    end)

    -- Convert the Global Dictionary Pools back to Arrays for the JSON export
    for _, res in pairs(AEM_Pool_Red) do table.insert(available_red_list, res) end
    for _, res in pairs(AEM_Pool_Blue) do table.insert(available_blue_list, res) end

	SendToNode("ACTIVE", "RED", active_red)
    SendToNode("ACTIVE", "BLUE", active_blue)
    SendToNode("AVAILABLE", "RED", available_red_list)
    SendToNode("AVAILABLE", "BLUE", available_blue_list)

    env.info("==================================================")
    messageToAll("AEM: Order of Battle Exported", 15)
end

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
    SendToNode("GOALS", "RED", goals_red)
    SendToNode("GOALS", "BLUE", goals_blue)

    messageToAll("AEM: Mission Goals Exported", 15)
end

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
		SendToNode("BORDER", "RED", red_border_coords)
	end
	if (BLUE_BORDER) then
		local blue_border_coords = GetGroupRouteCoordinates(BLUE_BORDER)
		SendToNode("BORDER", "BLUE", blue_border_coords)
	end

    messageToAll("AEM: Borders Exported", 15)
end

-- ======================================================================
-- ISR (Intelligence, Surveillance, Reconnaissance)
--
-- Updates the situation of enemy forces detected
-- ======================================================================

local RedActiveSet = SET_GROUP:New():FilterCoalitions("red"):FilterStart()
local BlueActiveSet = SET_GROUP:New():FilterCoalitions("blue"):FilterStart()

local BlueRecceSet = SET_GROUP:New():FilterPrefixes(BLUE_EW):FilterStart()
local BlueIntel = DETECTION_AREAS:New(BlueRecceSet, 30000)
BlueIntel:Start()

local RedRecceSet = SET_GROUP:New():FilterPrefixes(RED_EW):FilterStart()
local RedIntel = DETECTION_AREAS:New(RedRecceSet, 30000)
RedIntel:Start()

local RedSamSet = SET_GROUP:New():FilterPrefixes(RED_SAM):FilterStart()
local BlueSamSet = SET_GROUP:New():FilterPrefixes(BLUE_SAM):FilterStart()

local ContactTracks = {}

-- Función auxiliar para extraer datos de todos los grupos vivos de un bando
local function GetActiveForcesData(ActiveSet)
    local active_forces = {}
    
    ActiveSet:ForEachGroupAlive(function(group)
        local groupName = group:GetName()
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
            local heading = firstUnit:GetHeading() -- Obtenemos el rumbo (0-360)

			-- Determine Airbase Presence (Optimized)
            local rawPoint = coord:GetVec3()
            local airbaseName = GetFastAirbasePresence(rawPoint)

            local entry = {
                category = category,
                count = group:CountAliveUnits(),
                location = { lat = lat, long = lon },
                airbase = airbaseName,
                mission = GetMissionsFromName(groupName),
                type = unitType,
                id = groupName,
                heading = math.floor(heading or 0) -- Añadimos el rumbo al JSON
            }
            
            table.insert(active_forces, entry)
        end
    end)
    
    return active_forces
end

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
		local threatClass = "Unknown"
        local threatScore = 0
        local firstUnit = enemySet:GetFirst()
        
        if firstUnit then
            if firstUnit:IsAir() then 
				threatClass = "CAP"
				
                -- Check helicopters first
                if firstUnit:HasAttribute("Attack helicopters") then
                    threatClass = "ATTACK_HELO"
                elseif firstUnit:HasAttribute("Transport helicopters") then
                    threatClass = "TRANSPORT_HELO"
                    
                -- Check specialized fixed-wing
                elseif firstUnit:HasAttribute("AWACS") then 
                    threatClass = "AWACS" 
                elseif firstUnit:HasAttribute("Tankers") then 
                    threatClass = "TANKER"
                elseif firstUnit:HasAttribute("Transports") then 
                    threatClass = "TRANSPORT"
                    
                -- Check combat fixed-wing
                elseif firstUnit:HasAttribute("Bombers") then 
                    -- Note: DCS categorizes dedicated ground-attack jets (A-10, Su-25) here too
                    threatClass = "STRIKE" 
                elseif firstUnit:HasAttribute("Multirole fighters") or firstUnit:HasAttribute("Fighters") then
                    threatClass = "CAP"
                end
                
                -- Base threat per aircraft
                local baseThreat = 10 
                
                -- Speed Modifiers
                if speed > 400 then baseThreat = baseThreat + 10      -- Fast Jet
                elseif speed > 250 then baseThreat = baseThreat + 5   -- Subsonic/Cruising
                else baseThreat = baseThreat - 5 end                  -- Helo/Slow Prop
                
                -- Altitude Modifiers
                if alt_ft < 3000 and speed > 350 then 
                    baseThreat = baseThreat + 20 -- Fast & Low (Strike Profile!)
                elseif alt_ft > 25000 then
                    baseThreat = baseThreat + 5 -- High Altitude (Fighter/Bomber)
                end
                
                -- Attribute Modifiers (If the radar was able to identify the exact type)
                if firstUnit:HasAttribute("Fighters") then baseThreat = baseThreat + 10 end
                if firstUnit:HasAttribute("Bombers") then baseThreat = baseThreat + 15 end
                
                threatScore = baseThreat
                
            elseif firstUnit:IsGround() then 
				threatClass = "GROUND"
				threatScore = 1 * unitCount
                
                -- 1. Anti-Air Threats (Highest priority for aviation safety)
                if firstUnit:HasAttribute("Air Defence") then
                    -- Distinguish between flak/guns and missile systems
                    if firstUnit:HasAttribute("AAA") then
                        threatClass = "AAA"
						threatScore = threatScore + 15
                    else
                        threatClass = "SAM"
						threatScore = threatScore + 30
                    end
                    
                -- 2. Indirect Fire Threats (Massive threat to stationary goals/bases)
                elseif firstUnit:HasAttribute("Artillery") or firstUnit:HasAttribute("MLRS") then
                    threatClass = "ARTILLERY"
					threatScore = threatScore + 5
                    
                -- 3. Direct Combat Threats (Threats to friendly troops)
                elseif firstUnit:HasAttribute("Tanks") or firstUnit:HasAttribute("IFV") or firstUnit:HasAttribute("APC") then
                    threatClass = "ARMOR"
					threatScore = threatScore + 10
                    
                -- 4. Unarmed/Supply (Soft targets)
                elseif firstUnit:HasAttribute("Unarmed vehicles") then
                    threatClass = "LOGISTICS"
                end
                
            elseif firstUnit:IsShip() then 
				threatClass = "NAVAL"
                
                -- 1. Strategic Naval Assets
                if firstUnit:HasAttribute("Aircraft Carriers") then
                    threatClass = "CARRIER"
					threatScore = 50
                    
                -- 2. Subsurface Threats
                elseif firstUnit:HasAttribute("Submarines") then
                    threatClass = "SUBMARINE"
					threatScore = 10
                    
                -- 3. Surface Combatants (Cruisers, Destroyers, Frigates - often carry heavy SAMs)
                elseif firstUnit:HasAttribute("Armed ships") then
                    threatClass = "WARSHIP"
					threatScore = 30
                    
                -- 4. Unarmed/Transport Ships
                elseif firstUnit:HasAttribute("Unarmed ships") then
                    threatClass = "LOGISTICS_NAVAL"
					threatScore = 1 * unitCount
                end
				
            end
        end

        local contactData = {
            id = zoneName,
            detectedBy = detectorSide,
            coalition = targetSide,
            type = threatClass,
            category = (firstUnit and firstUnit:IsAir()) and "Air" or "Ground",
            count = unitCount,
			location = { lat = latNum, long = lonNum },
            altitude_ft = alt_ft,
            speed_kts = math.floor(speed),
            heading = math.floor(heading),
			threat = threatClass,
            threat_score = math.floor(threatScore),
            timestamp = timeNow
        }
        
        table.insert(jsonArray, contactData)
    end
    
    return jsonArray
end

local function GetKnownSAMs(SamSet, targetCoalitionStr, detectorSideStr, timeNow)
    local jsonArray = {}

    SamSet:ForEachGroupAlive(function(group)
        local groupName = group:GetName()
        local firstUnit = group:GetFirstUnitAlive()
        
        if firstUnit then
            local coord = group:GetCoordinate()
            local latNum, lonNum = coord:GetLLDDM()
            local alt_ft = math.floor(coord.y * 3.28084)
            local unitCount = group:CountAliveUnits()

            table.insert(jsonArray, {
                id = groupName,
                detectedBy = "SIGINT/SATELLITE", -- Identificador inmersivo para la app
                coalition = targetCoalitionStr,
                type = "SAM",
                category = "Ground",
                count = unitCount,
                location = { lat = latNum, long = lonNum },
                altitude_ft = alt_ft,
                speed_kts = 0,
                heading = 0,
                threat = "SAM",
                threat_score = 30 + unitCount, -- Misma escala de puntos que en ProcessIntelData
                timestamp = timeNow
            })
        end
    end)
    
    return jsonArray
end

SCHEDULER:New(nil, function()
	
	local timeNow = timer.getTime()
    -- Inteligencia dinámica (radares/EW rojos escaneando el espacio)
    local redJsonArray = ProcessIntelData(RedIntel, "RED", "BLUE", timeNow)
    
    -- Añadimos la inteligencia estática (SAMs azules conocidos desde el HQ)
    local knownBlueSAMs = GetKnownSAMs(BlueSamSet, "BLUE", "RED", timeNow)
    for _, samData in ipairs(knownBlueSAMs) do
        table.insert(redJsonArray, samData)
    end
    
    SendToNode("ISR", "RED", redJsonArray)
	
	local activeRed = GetActiveForcesData(RedActiveSet)
    SendToNode("ACTIVE", "RED", activeRed)
	
end, {}, 30, SCHEDULER_ISR_FREQ_RED)

SCHEDULER:New(nil, function()
	
	local timeNow = timer.getTime()
    -- Inteligencia dinámica (radares/EW azules escaneando el espacio)
    local blueJsonArray = ProcessIntelData(BlueIntel, "BLUE", "RED", timeNow)
    
    -- Añadimos la inteligencia estática (SAMs rojos conocidos desde el HQ)
    local knownRedSAMs = GetKnownSAMs(RedSamSet, "RED", "BLUE", timeNow)
    for _, samData in ipairs(knownRedSAMs) do
        table.insert(blueJsonArray, samData)
    end
    
    SendToNode("ISR", "BLUE", blueJsonArray)
	
	local activeBlue = GetActiveForcesData(BlueActiveSet)
    SendToNode("ACTIVE", "BLUE", activeBlue)
	
end, {}, 35, SCHEDULER_ISR_FREQ_BLUE)

-- ======================================================================
-- CSAR
--
-- Logic related to csar mission
-- ======================================================================

if MODULE_CSAR then	-- activate module CSAR

	menuCSARblue = nil
	menuCSARred = nil
	
	local function launchFlare(unitFlaring) unitFlaring:FlareRed() end

	local function radioTransmit(unitTransmiting, freq)
        local success, err = pcall(function()
			unitTransmiting:GetRadio():NewUnitTransmission(__CSAR_SOS, "SOS signal transmiting", 10, freq or 44.00, radio.modulation.FM, true):Broadcast(true)
		end)
		if not success then
			env.info("AEM Commander CSAR Warning: Failed to broadcast SOS. Is the audio file '" .. tostring(__CSAR_SOS) .. "' embedded in the Mission Editor? Error: " .. tostring(err))
		end
	end

	local function attemptRescue(rescuedGroup, menuPathFlare, menuPathRescue, rescueCoalitionStr)
		local playerDCSUnit = world.getPlayer()
		if playerDCSUnit then
			local playerMooseUnit = UNIT:Find(playerDCSUnit)
			local timeInZone = 0
			local rescueTimer = TIMER:New(function(self)
				local dist3D = playerMooseUnit:GetCoordinate():Get3DDistance(rescuedGroup:GetCoordinate())
				local speedKMH = playerMooseUnit:GetVelocityKMH()
				if dist3D <= 50 and speedKMH <= 10 then
					timeInZone = timeInZone + 1
					if timeInZone == 5 then messageToAll("Pilot boarding... hold steady!", 5) end
					if timeInZone >= 10 then
						messageToAll("Pilot successfully rescued! Get them back to base.", 10)
                        
                        -- Delete all CSAR menu items for the coalition that performed the rescue
                        local dcsCoalition = rescueCoalitionStr == "red" and coalition.side.RED or coalition.side.BLUE
                        if menuPathFlare ~= nil then missionCommands.removeItemForCoalition(dcsCoalition, menuPathFlare) end
						if menuPathRescue ~= nil then missionCommands.removeItemForCoalition(dcsCoalition, menuPathRescue) end
						
						-- Send "Rescued" event to Node.js
						PushEvent(rescueCoalitionStr, {
							type = "rescued",
							coalition = rescueCoalitionStr,
							name = rescuedGroup:GetName()
						})

						rescuedGroup:Destroy()
						self:Stop()
					end
				else
					if timeInZone > 5 then
						messageToAll("Rescue aborted! You moved out of the zone or exceeded speed limits.", 5)
						self:Stop()
					end
				end
			end)
			rescueTimer:Start(1, 1)
		end
	end

	local function InitializeDownedPilot(SpawnGroup, coalStr)
		local _unit = SpawnGroup:GetFirstUnit()
		local freq = math.random(30, 59) + (0.01 * math.random(0, 99))
		radioTransmit(_unit, freq)
		
		local unitCoord = _unit:GetCoordinate()
		local lat, lon = unitCoord:GetLLDDM()
		local approxCoords = unitCoord:ToStringLLDDM()
		local limitedCoords = string.gsub(approxCoords, "%.%d+", "")
		
		local dcsCoalition = coalStr == "red" and coalition.side.RED or coalition.side.BLUE
		local menuCSAR = coalStr == "red" and menuCSARred or menuCSARblue

		if menuCSAR == nil then
			menuCSAR = missionCommands.addSubMenuForCoalition(dcsCoalition, "CSAR", nil)
			if coalStr == "red" then menuCSARred = menuCSAR else menuCSARblue = menuCSAR end
		end

        local f10CommandPathFlare = missionCommands.addCommandForCoalition(dcsCoalition, limitedCoords.." / FM "..string.format("%.2f", freq)..": Launch flare", menuCSAR, function() launchFlare(_unit) end, nil)
		local f10CommandPath = nil
		f10CommandPath = missionCommands.addCommandForCoalition(dcsCoalition, limitedCoords.." / FM "..string.format("%.2f", freq)..": Attempt rescue", menuCSAR, function() attemptRescue(SpawnGroup, f10CommandPathFlare, f10CommandPathRescue, coalStr) end, nil)

		-- Notify Node.js that the pilot is on the ground
		PushEvent(coalStr, {
			type = "csar",
			coalition = coalStr,
			name = SpawnGroup:GetName(),

			lat = lat,
			lon = lon
		})
	end

	BLUE_LIFE_RAFT = SPAWN:New(BLUE_RAFT):InitLimit(100, 100):OnSpawnGroup(function(grp) InitializeDownedPilot(grp, "blue") end)
	BLUE_DOWNED_PILOT = SPAWN:New(BLUE_PILOT):InitLimit(100, 100):OnSpawnGroup(function(grp) InitializeDownedPilot(grp, "blue") end)
	RED_LIFE_RAFT = SPAWN:New(RED_RAFT):InitLimit(100, 100):OnSpawnGroup(function(grp) InitializeDownedPilot(grp, "red") end)
	RED_DOWNED_PILOT = SPAWN:New(RED_PILOT):InitLimit(100, 100):OnSpawnGroup(function(grp) InitializeDownedPilot(grp, "red") end)
	
	local CSAR_EventHandler = {}
	function CSAR_EventHandler:onEvent(Event)
		local chuteObject = nil
		local isBailout = false
		
		-- Fighter Jets (Ejection Seats)
		if Event.id == world.event.S_EVENT_EJECTION then
			if Event.target then
				chuteObject = Event.target
				isBailout = true
			end
			
		-- Heavy Aircraft / Helis (Manual Bailouts)
		elseif Event.id == world.event.S_EVENT_BIRTH then
			if Event.initiator and Event.initiator:isExist() then
				local successName, unitName = pcall(function() return Event.initiator:getName() end)
				if successName and unitName then
					if string.find(unitName, BLUE_RAFT) or string.find(unitName, BLUE_PILOT) or string.find(unitName, RED_RAFT) or string.find(unitName, RED_PILOT) then
						return -- Stop processing this event immediately!
					end
				end
				local success, typeName = pcall(function() return Event.initiator:getTypeName() end)
				if success and typeName and type(typeName) == "string" then
					local lowerName = string.lower(typeName)
					if string.find(lowerName, "parachute") or string.find(lowerName, "paratrooper") or string.find(lowerName, "pilot") then
						chuteObject = Event.initiator
						isBailout = true
					end
				end
			end
		end
		
		-- Execute Rescue Spawn Logic
		if isBailout and chuteObject then
			local rawVec3 = chuteObject:getPoint()
			local parachuteCoord = COORDINATE:NewFromVec3(rawVec3)
			local altMeters = parachuteCoord:GetY()
			local ejectCoalition = chuteObject:getCoalition()
			
			local staggerDelay = math.random(0, 15)
			local fallTime = math.max(altMeters / 5.5, 5) + staggerDelay 
			local maxDrift = math.min(altMeters * 0.5, 3000) 
			local spawnCoord = parachuteCoord:GetRandomCoordinateInRadius(maxDrift, 100)
			
			messageToAll("EJECTION DETECTED! Surface ETA: " .. math.floor(fallTime) .. " seconds.", 15)
			
			timer.scheduleFunction(function()
				local surface = spawnCoord:GetSurfaceType()
				local isWater = (surface == land.SurfaceType.WATER or surface == land.SurfaceType.SHALLOW_WATER)
				
				if isWater then
					if ejectCoalition == coalition.side.BLUE then BLUE_LIFE_RAFT:SpawnFromCoordinate(spawnCoord)
					elseif ejectCoalition == coalition.side.RED then RED_LIFE_RAFT:SpawnFromCoordinate(spawnCoord) end
				else
					if ejectCoalition == coalition.side.BLUE then BLUE_DOWNED_PILOT:SpawnFromCoordinate(spawnCoord)
					elseif ejectCoalition == coalition.side.RED then RED_DOWNED_PILOT:SpawnFromCoordinate(spawnCoord) end
				end
			end, nil, timer.getTime() + fallTime)
			
		end	
	end
	world.addEventHandler(CSAR_EventHandler)
	
end	-- module CSAR

-- ======================================================================
-- CIVILIAN TRAFFIC
--
-- Generates neutral background traffic between airbases and zones.
-- ======================================================================

local CivSpawners = {}

if MODULE_CIV_TRAFFIC then
    env.info("AEM Commander: Starting Civilian Traffic Module...")
    local CivActiveFlights = 0

    -- 1. Recopilar aeropuertos permitidos y zonas de tránsito
    local function GetCivDestinations()
        local dests = {}
        local allowedDict = {}
        for _, v in ipairs(CIV_ALLOWED_AIRBASES) do allowedDict[v] = true end

        if world and world.getAirbases then
            for _, airbase in pairs(world.getAirbases()) do
                if airbase:isExist() and airbase:getDesc().category == 0 then
                    if allowedDict[airbase:getName()] then
                        table.insert(dests, { id = airbase:getName(), type = "AIRBASE", coord = COORDINATE:NewFromVec3(airbase:getPoint()) })
                    end
                end
            end
        end
        if env.mission and env.mission.triggers and env.mission.triggers.zones then
            for _, zoneData in pairs(env.mission.triggers.zones) do
                if string.find(zoneData.name, "^" .. CIV_ZONE_PREFIX) then
                    local mz = ZONE:FindByName(zoneData.name)
                    if mz then table.insert(dests, { id = zoneData.name, type = "ZONE", coord = mz:GetCoordinate() }) end
                end
            end
        end
        return dests
    end

    local CivPoints = GetCivDestinations()

    function AEM_DespawnCivGroup(groupName)
        local g = GROUP:FindByName(groupName)
        if g and g:IsAlive() then
            g:Destroy()
            CivActiveFlights = CivActiveFlights - 1
            env.info("AEM Commander: Civ flight " .. groupName .. " left the airspace.")
        end
    end

    -- 2. Función principal de generación
    local function AEM_SpawnCivFlight()
        if #CivPoints < 2 then return end

        local origin = CivPoints[math.random(1, #CivPoints)]
        local dest = CivPoints[math.random(1, #CivPoints)]
        local attempts = 0

        while (origin.id == dest.id or origin.coord:Get2DDistance(dest.coord) < CIV_MIN_DIST_METERS) and attempts < 10 do
            dest = CivPoints[math.random(1, #CivPoints)]
            attempts = attempts + 1
        end
        if attempts >= 10 then return end

        -- Reservamos el slot para evitar que el bucle inicial genere de más
        CivActiveFlights = CivActiveFlights + 1 
        
        local template = CIV_TEMPLATES[math.random(1, #CIV_TEMPLATES)]
        if not CivSpawners[template] then
            CivSpawners[template] = SPAWN:New(template)
        end
        local SpawnObj = CivSpawners[template]

        SpawnObj:OnSpawnGroup(function(NewGroup)
            local groupName = NewGroup:GetName()
            local speed, alt = 400, math.random(25000, 39999)  * 0.3048
            local waypoints = {}
            
            -- Obtener coordenadas base
            local startCoord = (origin.type == "AIRBASE") and NewGroup:GetCoordinate() or origin.coord:SetAltitude(alt)
            local endCoord = dest.coord
            
            table.insert(waypoints, startCoord:WaypointAir(speed, "Turning Point", "Fly Over", alt))

            -- Waypoints intermedios aleatorios
            local dist = startCoord:Get2DDistance(endCoord)
            local heading = startCoord:HeadingTo(endCoord)
            local numMidPoints = math.random(1, 3) -- Genera 1, 2 o 3 puntos de quiebro
            
            for i = 1, numMidPoints do
                local fraction = i / (numMidPoints + 1)
                local baseMidCoord = startCoord:Translate(dist * fraction, heading)
                -- Desvío aleatorio de hasta 15km
                local offsetCoord = baseMidCoord:GetRandomCoordinateInRadius(15000, 2000)
                table.insert(waypoints, offsetCoord:WaypointAir(speed, "Turning Point", "Fly Over", alt))
            end

            -- Waypoint final (Aterrizar o Desaparecer)
            if dest.type == "AIRBASE" then
                table.insert(waypoints, endCoord:WaypointAir(speed, "Land", "Landing", 0))
            else
                local wpEnd = endCoord:WaypointAir(speed, "Turning Point", "Fly Over", alt)
                wpEnd.task = NewGroup:TaskCombo({ NewGroup:TaskFunction("AEM_DespawnCivGroup", groupName) })
                table.insert(waypoints, wpEnd)
            end
            
            NewGroup:Route(waypoints)
        end)

        if origin.type == "AIRBASE" then
            SpawnObj:SpawnAtAirbase(AIRBASE:FindByName(origin.id), SPAWN.Takeoff.Cold)
        else
            local spawnCoord = origin.coord:SetAltitude(math.random(25000, 39999) * 0.3048)
            SpawnObj:SpawnFromCoordinate(spawnCoord)
        end
    end

    -- 3. Generación inicial (Spawn burst)
    -- Esperamos 20 segundos al inicio para que el mundo cargue bien y lanzamos todos.
    timer.scheduleFunction(function()
        for i = 1, CIV_INIT_FLIGHTS do
            AEM_SpawnCivFlight()
        end
		messageToAll("AEM Commander: civilian traffic activated", 15)
    end, nil, timer.getTime() + 20)

    -- 4. Reposición de vuelos perdidos
    SCHEDULER:New(nil, function()
        if CivActiveFlights < CIV_MAX_FLIGHTS then
            AEM_SpawnCivFlight()
        end
    end, {}, 60, 120) -- Revisa cada 2 minutos

    -- 5. Limpieza al apagar motores
    local CivEventHandler = EVENTHANDLER:New()
    CivEventHandler:HandleEvent(EVENTS.EngineShutdown)
    function CivEventHandler:OnEventEngineShutdown(EventData)
        if EventData.IniGroup then
            local name = EventData.IniGroup:GetName()
            for _, tpl in ipairs(CIV_TEMPLATES) do
                if string.find(name, tpl) then
                    EventData.IniGroup:Destroy()
                    CivActiveFlights = CivActiveFlights - 1
                    break
                end
            end
        end
    end
	
end -- module civilian traffic

-- ======================================================================
-- Field command
--
-- Receive strategic tasking from commander and generate tactical orders
-- Includes Rendezvous (RV) Package Manager for coordinated strikes
-- ======================================================================

-- Global Spawner Registry to ensure persistence
AEM_Spawners = {}
AEM_Packages = AEM_Packages or {}

function AEM_DeployInfantry(groupName, coalitionStr)
    local group = GROUP:FindByName(groupName)
    if group and group:IsAlive() then
        local currentCoord = group:GetCoordinate()
        local template = (string.upper(coalitionStr) == "RED") and RED_INFANTRY or BLUE_INFANTRY
        
        -- Buscamos el Spawner en el registro global, o lo creamos si es la primera vez
        local spawnObj = AEM_Spawners[template]
        
        if not spawnObj then
            spawnObj = SPAWN:New(template)
            AEM_Spawners[template] = spawnObj
            env.info("AEM Commander: Registered new Spawner for " .. template)
        end
        
        if spawnObj then
            spawnObj:SpawnFromCoordinate(currentCoord)
            messageToAll("AEM Commander: Infantry deployed at target zone by " .. groupName, 10)
            env.info("AEM Commander: Infantry deployed at target zone by " .. groupName)
        else
            env.error("AEM Commander: Infantry template not found: " .. tostring(template))
        end
        
        -- Tras desplegar la infantería, ordenamos RTB
        group:ClearTasks()
        group:RouteRTB()
    end
end

local function RouteGroundUnit(group, targetCoord, speed, route_via_name, taskType, coalitionStr)
    local waypoints = {}
    local startCoord = group:GetCoordinate()
    
    -- 1. Punto de inicio: Viajaremos "Off Road" (campo a través) para salir de la base
    table.insert(waypoints, startCoord:WaypointGround(speed, "Off Road"))
    
    -- 2. Buscamos la carretera más cercana al punto de aparición para iniciar la ruta de asfalto
    local roadCoord = startCoord:GetClosestPointToRoad()
    if roadCoord then
        table.insert(waypoints, roadCoord:WaypointGround(speed, "On Road"))
    end
    
    -- 3. Si hay un punto de cruce (choke point), nos aseguramos de que también se ajuste a la carretera
    if route_via_name and route_via_name ~= "" then
        local chokeZone = ZONE:FindByName(route_via_name)
        if chokeZone then
            local chokeCoord = chokeZone:GetCoordinate():GetClosestPointToRoad() or chokeZone:GetCoordinate()
            table.insert(waypoints, chokeCoord:WaypointGround(speed, "On Road"))
        end
    end
    
    -- 4. Punto de destino final, también ajustado a la carretera más cercana para evitar colapsos
    local finalCoord = targetCoord:GetClosestPointToRoad() or targetCoord
    local wpTarget = finalCoord:WaypointGround(speed, "On Road")
    
    table.insert(waypoints, wpTarget)
    group:Route(waypoints)
	
	-- Fallback
	local groupName = group:GetName()
    
    timer.scheduleFunction(function()
        -- Volvemos a buscar el grupo por si ha sido destruido en estos 20 segundos
        local checkGroup = GROUP:FindByName(groupName)
        if checkGroup and checkGroup:IsAlive() then
            local currentCoord = checkGroup:GetCoordinate()
            local distMoved = currentCoord:Get2DDistance(startCoord)
            local currentSpeed = checkGroup:GetVelocityKMH()
            
            -- Si se ha movido menos de 10 metros y su velocidad es prácticamente nula, está atascado
            if distMoved < 10 and currentSpeed < 1 then
                env.info("AEM Commander: Pathfinding failed for " .. groupName .. ". Forcing OFF ROAD direct route.")
                
                local fallbackWaypoints = {}
                table.insert(fallbackWaypoints, currentCoord:WaypointGround(speed, "Off Road"))
                
                local wpFallbackTarget = targetCoord:WaypointGround(speed, "Off Road")
                if taskType == "TRANSPORT_TROOPS" then
                    local fallbackDeploy = checkGroup:TaskFunction("AEM_DeployInfantry", groupName, coalitionStr)
                    wpFallbackTarget.task = checkGroup:TaskCombo({ fallbackDeploy })
                end
                
                table.insert(fallbackWaypoints, wpFallbackTarget)
                
                -- Sobrescribimos la ruta anterior con la nueva ruta directa de contingencia
                checkGroup:Route(fallbackWaypoints)
            end
        end
    end, nil, timer.getTime() + 60)
	
	if taskType == "TRANSPORT_TROOPS" then
        local arrivalTimer
        arrivalTimer = TIMER:New(function()
            local checkGroup = GROUP:FindByName(groupName)
            
            if checkGroup and checkGroup:IsAlive() then
                local currentCoord = checkGroup:GetCoordinate()
                -- Medimos la distancia contra el target original
                local distToTarget = currentCoord:Get2DDistance(targetCoord)
                local currentSpeed = checkGroup:GetVelocityKMH()

                -- Si está a menos de 600 metros de la zona y se ha detenido (velocidad < 2)
                if distToTarget < 600 and currentSpeed < 2 then
                    env.info("AEM Commander: " .. groupName .. " reached destination zone. Deploying infantry!")
                    AEM_DeployInfantry(groupName, coalitionStr)
                    
                    -- Paramos el temporizador para que no siga creando infantería en bucle
                    arrivalTimer:Stop()
                end
            else
                -- Si el grupo es destruido por el enemigo antes de llegar, matamos el temporizador
                arrivalTimer:Stop()
            end
        end)
        
        -- Iniciamos el escáner: Espera 30 segundos de gracia, y luego comprueba cada 5 segundos
        arrivalTimer:Start(30, 5)
    end
	
end

local function RouteAirplaneDrop(group, targetCoord, speed, altitude, taskType, coalitionStr)
    local waypoints = {}
    table.insert(waypoints, group:GetCoordinate():WaypointAir(speed, "Turning Point", "Fly Over", altitude))
    
    local wpTarget = targetCoord:WaypointAir(speed, "Turning Point", "Fly Over", altitude)
    if taskType == "TRANSPORT_TROOPS" then
        local taskDeploy = group:TaskFunction("AEM_DeployInfantry", group:GetName(), coalitionStr)
        wpTarget.task = group:TaskCombo({ taskDeploy })
    end
    
    table.insert(waypoints, wpTarget)
    group:Route(waypoints)
end

local function RouteHeloDrop(group, targetCoord, speed, altitude, taskType, coalitionStr)
    local waypoints = {}
    table.insert(waypoints, group:GetCoordinate():WaypointAir(speed, "Turning Point", "Fly Over", altitude))
    
    -- DCS Native action: Obliga al helicóptero a buscar donde posarse en esa zona
    table.insert(waypoints, targetCoord:WaypointAir(speed, "Land", "Landing", 0))
    group:Route(waypoints)
    
    -- Esperamos pacientemente el evento de aterrizaje
    group:HandleEvent(EVENTS.Land)
    function group:OnEventLand(EventData)
        if EventData.IniGroup == self then
            local dist = self:GetCoordinate():Get2DDistance(targetCoord)
            if dist < 2000 then -- Damos un margen de 2km por si el terreno es irregular
                if taskType == "TRANSPORT_TROOPS" then
                    AEM_DeployInfantry(self:GetName(), coalitionStr)
                else
                    -- Si era solo logística (suministros), no hace spawn pero hace RTB
                    self:ClearTasks()
                    self:RouteRTB() -- TODO: implementar la construcción de los suministros
                end
                self:UnHandleEvent(EVENTS.Land) -- Apagamos el listener
            end
        end
    end
end

-- Package Manager Scheduler (Monitors RV Points and Go/No-Go criteria)
SCHEDULER:New(nil, function()
    local timeNow = timer.getTime()
    for pkgKey, pkg in pairs(AEM_Packages) do
        
        if pkg.state == "ASSEMBLY" or pkg.state == "PUSH" then
            local allAtRV = true
            local aliveCount = 0
            local aliveTasks = {}

            for _, grpData in ipairs(pkg.groups) do
                if grpData.mooseGroup:IsAlive() then
                    aliveCount = aliveCount + 1
                    aliveTasks[grpData.task] = true 
                    
                    if pkg.state == "ASSEMBLY" then
                        local currentCoord = grpData.mooseGroup:GetCoordinate()
                        local dist = currentCoord:Get2DDistance(pkg.rvCoord)
                        if dist > 15000 then
                            allAtRV = false
                        end
                    end
                end
            end

            local missingCriticalTask = false
            local failedTaskName = ""
            
            for reqTask, _ in pairs(pkg.requiredTasks) do
                if not aliveTasks[reqTask] then
                    missingCriticalTask = true
                    failedTaskName = reqTask
                    break
                end
            end

            if missingCriticalTask then
                pkg.state = "ABORTED"
                messageToAll("AEM Commander: Strike Package " .. pkgKey .. " ABORTED! Lost all " .. failedTaskName .. " cover. RTB ordered.", 15)
                
                for _, grpData in ipairs(pkg.groups) do
                    if grpData.mooseGroup:IsAlive() then
                        if grpData.rvMission then grpData.rvMission:Cancel() end
                        if grpData.combatMission then grpData.combatMission:Cancel() end
                        grpData.mooseGroup:ClearTasks()
                        grpData.mooseGroup:RouteRTB()
                    end
                end
                
            elseif pkg.state == "ASSEMBLY" then
                if (allAtRV and aliveCount > 0) or (timeNow > pkg.timeout and aliveCount > 0) then
                    pkg.state = "PUSH"
                    messageToAll("AEM Commander: Strike Package " .. pkgKey .. " assembled. PUSHING to target at " .. math.floor(pkg.pushSpeed) .. " kts!", 15)

                    for _, grpData in ipairs(pkg.groups) do
                        if grpData.mooseGroup:IsAlive() then
                            if grpData.rvMission then
                                grpData.rvMission:Cancel()
                            end
                            -- Sincronizamos la velocidad de ataque a la del miembro más lento (pkg.pushSpeed)
                            grpData.flightGroup:AddWaypoint(grpData.targetCoord, pkg.pushSpeed, nil, grpData.altitude, true)
                            grpData.flightGroup:AddMission(grpData.combatMission)
                        end
                    end
                end
            end
            
            if aliveCount == 0 then
                pkg.state = "DEAD"
            end
        end
    end
end, {}, 5, 10)

local function GetClosestParkingSpot(airbaseObj, targetCoord)
    local dcsAirbase = airbaseObj:GetDCSObject()
    if not dcsAirbase then return nil end
    local parkings = dcsAirbase:getParking(false)
    if not parkings then return nil end
    
    local closestIndex = nil
    local minDist = math.huge
    local targetVec3 = targetCoord:GetVec3()
    
    for _, pData in ipairs(parkings) do
        if pData.vTerminalPos then
            local pPos = pData.vTerminalPos
            local dx = targetVec3.x - pPos.x
            local dz = targetVec3.z - pPos.z
            local distSq = (dx * dx) + (dz * dz)
            if distSq < minDist then
                minDist = distSq
                closestIndex = pData.Term_Index
            end
        end
    end
    return closestIndex
end

-- 1. Spawn Task Executor
local function SpawnAndTask(action, spawnTemplate, spawnAirbase, coalitionStr, parkingIDs, spawnCoords, unitCategory)
    
    local SpawnObj = AEM_Spawners[spawnTemplate]
    
    if not SpawnObj then
        SpawnObj = SPAWN:New(spawnTemplate)
        AEM_Spawners[spawnTemplate] = SpawnObj
        env.info("AEM: Registered new Spawner for " .. spawnTemplate)
    end
    
    if action.unit_count and action.unit_count > 0 then
        SpawnObj:InitGrouping(action.unit_count)
    end
	
	local isAirUnit = (unitCategory == "Air" or unitCategory == "Helo")
    
    SpawnObj:OnSpawnGroup(function(NewGroup)
        
		local FlightGroup = nil
		
		if isAirUnit then
		
			NewGroup:CommandSetUnlimitedFuel(UNLIMITED_FUEL)
			
            -- Forzar a que usen Chaff y Flares SOLO cuando detecten un misil en vuelo
            NewGroup:SetOption(AI.Option.Air.id.FLARE_USING, AI.Option.Air.val.FLARE_USING.AGAINST_FIRED_MISSILE)
            
            -- Forzar a que usen sus Pods de ECM
            NewGroup:SetOption(AI.Option.Air.id.ECM_USING, AI.Option.Air.val.ECM_USING.USE_IF_DETECTED_LOCK_BY_RADAR)
            
            -- Inicializar MOOSE FlightGroup SOLAMENTE para unidades aéreas
            FlightGroup = FLIGHTGROUP:New(NewGroup)
        end
        
        local groupName = NewGroup:GetName()
        messageToAll(string.format("AEM Commander %s: Executing Order - %s launched from %s", coalitionStr, action.unit_type, action.airbase or "field"), 15)
        
        local startCoord  = NewGroup:GetCoordinate()
        local startLat, startLon = startCoord:GetLLDDM()
        
        local targetLat = action.target_area.lat
        local targetLon = action.target_area.long
        local targetCoord = COORDINATE:NewFromLLDD(targetLat, targetLon)
        local zoneName = action.target_name or ("TGT-"..groupName)
        
        PushEvent(string.lower(coalitionStr), {
            type = "activated",
            coalition = string.lower(coalitionStr),
            staticUnits = action.unit_names, 
            group = {
                name = groupName,
                type = action.unit_type,
                category = unitCategory,
                mission = {action.task},
                lat = startLat,
                lon = startLon,
                airbase = action.airbase or "Field Deployment"
            }
        })
        
        local taskType = action.task
        local altitude = 20000
        local speed = 400
        local combatMission = nil
		
		if not isAirUnit then
            RouteGroundUnit(NewGroup, targetCoord, 40, action.route_via, taskType, coalitionStr)
		else
        
			if taskType == "CAP" or taskType == "ESCORT" then
				altitude = math.random(18000, 28000)
				speed = 420
				-- Reducimos radio a 60km para no distraerse
				combatMission = AUFTRAG:NewCAP(ZONE_RADIUS:New(zoneName, targetCoord:GetVec2(), 60000), altitude, speed, targetCoord)
				
				-- Si termina, orbita en lugar de volver a casa
				function combatMission:OnAfterDone(From, Event, To)
					local holdMission = AUFTRAG:NewORBIT(targetCoord, altitude, speed)
					FlightGroup:AddMission(holdMission)
				end
				
			elseif taskType == "INTERCEPT" then
				combatMission = missionIntercept(zoneName, targetCoord, action.reference_entity)
			elseif taskType == "CAS" then
				combatMission = missionCAS(zoneName, targetCoord)
			elseif taskType == "SEAD" then
				combatMission = missionSEAD(zoneName, targetCoord, FlightGroup)
			elseif taskType == "STRIKE" then
				combatMission = missionStrike(targetCoord, action.reference_entity, groupName, coalitionStr)
            elseif taskType == "TRANSPORT_TROOPS" or taskType == "TRANSPORT_LOGISTICS" then
                if unitCategory == "Helo" then
                    RouteHeloDrop(NewGroup, targetCoord, 120, 3000, taskType, coalitionStr)
                else
                    RouteAirplaneDrop(NewGroup, targetCoord, 250, 15000, taskType, coalitionStr)
                end
            end
			
			-- Package & Rendezvous Logic
			if combatMission then
				if taskType == "INTERCEPT" then
					FlightGroup:AddWaypoint(targetCoord, speed, nil, altitude, true)
					FlightGroup:AddMission(combatMission)
				else
					-- SISTEMA DE OLEADAS (WAVES)
					local basePkgKey = action.target_name or string.format("TGT_%.0f_%.0f", targetLat, targetLon)
					local pkgKey = basePkgKey
					
					local waveCounter = 1
					-- Si el paquete ya hizo PUSH o lleva más de 2 minutos ensamblándose, creamos una nueva oleada
					while AEM_Packages[pkgKey] and (AEM_Packages[pkgKey].state ~= "ASSEMBLY" or (timer.getTime() - AEM_Packages[pkgKey].creationTime > 120)) do
						waveCounter = waveCounter + 1
						pkgKey = basePkgKey .. "_Wave" .. waveCounter
					end

					if not AEM_Packages[pkgKey] then
						local bearingToStart = targetCoord:HeadingTo(startCoord)
						local totalDist = startCoord:Get2DDistance(targetCoord)
						local rvDist = math.max(20000, math.min(totalDist * 0.4, 60000))
						
						AEM_Packages[pkgKey] = {
							rvCoord = targetCoord:Translate(rvDist, bearingToStart),
							groups = {},
							requiredTasks = {},
							state = "ASSEMBLY",
							creationTime = timer.getTime(),
							timeout = timer.getTime() + 1800,
							pushSpeed = speed -- Inicializamos con la velocidad del primer grupo
						}
					end
					
					-- Sincronizamos la velocidad del paquete a la del grupo más lento
					if speed < AEM_Packages[pkgKey].pushSpeed then
						AEM_Packages[pkgKey].pushSpeed = speed
					end
					
					local rvMission = AUFTRAG:NewORBIT(AEM_Packages[pkgKey].rvCoord, altitude, speed)
					FlightGroup:AddWaypoint(AEM_Packages[pkgKey].rvCoord, speed, nil, altitude, true)
					FlightGroup:AddMission(rvMission)
					
					table.insert(AEM_Packages[pkgKey].groups, {
						flightGroup = FlightGroup,
						mooseGroup = NewGroup,
						task = taskType,
						combatMission = combatMission,
						rvMission = rvMission,
						targetCoord = targetCoord,
						altitude = altitude,
						speed = speed
					})
					
					AEM_Packages[pkgKey].requiredTasks[taskType] = true
				end
			end
		end
    end)
	
	if not isAirUnit then
        -- Las unidades de tierra aparecen exactamente en la coordenada del estático consumido
        if spawnCoords and #spawnCoords > 0 then
            SpawnObj:SpawnFromCoordinate(spawnCoords[1])
        else
            env.info("AEM Commander: cannot spawn " .. spawnTemplate .. " as no airbase nor coordinates provided")
        end
    else
		if spawnAirbase then
            if action.task == "INTERCEPT" then
                SpawnObj:SpawnAtAirbase(spawnAirbase, SPAWN.Takeoff.Runway, nil)
            else
                if parkingIDs and #parkingIDs > 0 then
                    SpawnObj:SpawnAtParkingSpot(spawnAirbase, parkingIDs, SPAWN.Takeoff.Cold)
                else
                    SpawnObj:SpawnAtAirbase(spawnAirbase, SPAWN.Takeoff.Hot, nil)
                end
            end
        else
			if spawnCoords and #spawnCoords > 0 then
                SpawnObj:SpawnFromCoordinate(spawnCoords[1])
            else
                env.info("AEM Commander: Missing airbase and coordinates to spawn air group " .. spawnTemplate)
            end
        end
    end
end

function ProcessAIOrders(actions, coalitionStr)
    
    if not actions then return end
    
    for _, action in ipairs(actions) do
		if action.action_type == "persistence_destroy" and action.unit_names then
            for _, unitName in ipairs(action.unit_names) do
                -- First check if it's a Static Object
                local staticObj = STATIC:FindByName(unitName, false)
                if staticObj then
                    staticObj:Destroy()
                else
                    -- Next check if it's a specific Unit
                    local unitObj = UNIT:FindByName(unitName)
                    if unitObj then
                        unitObj:Destroy()
                    else
                        -- Finally, check if it's a standard Group
                        local groupObj = GROUP:FindByName(unitName)
                        if groupObj then
                            groupObj:Destroy()
                        end
                    end
                end
            end
            env.info("AEM Commander: Persistence state applied. Destroyed " .. #action.unit_names .. " entities.")
        elseif action.action_type == "persistence_csar" and action.pilots then
            for _, pilot in ipairs(action.pilots) do
                if pilot.lat and pilot.lon and MODULE_CSAR then
                    local coord = COORDINATE:NewFromLLDD(pilot.lat, pilot.lon)
                    local surface = coord:GetSurfaceType()
                    local isWater = (surface == land.SurfaceType.WATER or surface == land.SurfaceType.SHALLOW_WATER)
                    
                    if pilot.coalition == "blue" then
                        if isWater then BLUE_LIFE_RAFT:SpawnFromCoordinate(coord)
                        else BLUE_DOWNED_PILOT:SpawnFromCoordinate(coord) end
                    elseif pilot.coalition == "red" then
                        if isWater then RED_LIFE_RAFT:SpawnFromCoordinate(coord)
                        else RED_DOWNED_PILOT:SpawnFromCoordinate(coord) end
                    end
                end
            end
            if #action.pilots > 0 then
                env.info("AEM Commander: Persistence state applied. Spawned " .. #action.pilots .. " CSAR targets.")
            end
		elseif action.action_type == "new" and action.unit_names then
            
            local templateName = TEMPLATE_PREFIX..coalitionStr.." "..action.task.." "..action.unit_type
			
			local Airbase = nil
            if action.airbase and action.airbase ~= "" then
                Airbase = AIRBASE:FindByName(action.airbase)
            end
            
			local TemplateGroup = GROUP:FindByName(templateName)
            
            if TemplateGroup then
                local staticsConsumed = 0
                local parkingIDs = {}
				local spawnCoords = {}
				local unitCategory = "Ground"
				
				for _, staticName in ipairs(action.unit_names) do
                    local staticObj = STATIC:FindByName(staticName, false)
                    if staticObj and staticObj:IsAlive() then
                        -- Guardamos la coordenada exacta y tipo antes de destruir el estático
						unitCategory = GetCategoryFromDCSStatic(staticObj)
                        table.insert(spawnCoords, staticObj:GetCoordinate())
                        
                        -- Solo buscamos parking si hay una base aérea válida
                        if Airbase then
                            local termID = GetClosestParkingSpot(Airbase, staticObj:GetCoordinate())
                            if termID then
                                table.insert(parkingIDs, termID)
                            end
                        end
                        staticObj:Destroy()
                        staticsConsumed = staticsConsumed + 1
                    end
                end
			
				if staticsConsumed > 0 then
                    timer.scheduleFunction(function(args)
                        SpawnAndTask(args.action, args.templateName, args.Airbase, args.coalitionStr, args.parkingIDs, args.spawnCoords, args.unitCategory)
                    end, {
                        action = action, 
                        templateName = templateName, 
                        Airbase = Airbase, 
                        coalitionStr = coalitionStr, 
                        parkingIDs = parkingIDs,
                        spawnCoords = spawnCoords,
						unitCategory = unitCategory
                    }, timer.getTime() + 1.0)
                else
                    env.info("AEM Commander: Requested static units were missing/dead.")
                end
            else
                env.info("AEM Commander: Missing template for " .. templateName)
            end
			
        elseif action.action_type == "existing" and action.group_name then
            local ExistingGroup = GROUP:FindByName(action.group_name)
            
            if ExistingGroup and ExistingGroup:IsAlive() then
            
				-- 1. Check if the group contains any human players
                local isHuman = false
                for _, unit in pairs(ExistingGroup:GetUnits()) do
                    if unit:GetPlayerName() ~= nil then
                        isHuman = true
                        break
                    end
                end
							
                if isHuman then	-- 2. If Human, send a message. If AI, apply tasking.
					
					-- Construct the text message with the orders
                    local msgText = "AEM COMMANDER ORDERS:\nTask: " .. tostring(action.task)
                    
                    if action.target_name then
                        msgText = msgText .. "\nTarget: " .. tostring(action.target_name)
                    end
                    
                    if action.reference_entity then
                        msgText = msgText .. "\nReference: " .. tostring(action.reference_entity)
                    end
                    
                    if action.task == "RTB" then
                        msgText = msgText .. "\nInfo: Return to base and preserve forces."
                    end
                    
                    -- Use MOOSE MESSAGE class to send text ONLY to this specific group
                    MESSAGE:New(msgText, 25, "HQ"):ToGroup(ExistingGroup)
                    env.info("AEM Commander: Orders relayed via text to human group " .. action.group_name)
					
				else	-- Standard AI Tasking Logic

					if action.task == "RTB" then
						ExistingGroup:ClearTasks()
						ExistingGroup:RouteRTB()
					else

                        local targetCoord = COORDINATE:NewFromLLDD(action.target_area.lat, action.target_area.long)
						local zoneName = action.target_name or ("TGT-"..action.group_name)
						local taskType = action.task
						
						local isAirUnit = ExistingGroup:IsAir() or ExistingGroup:IsHelicopter()
						local unitCategory = ExistingGroup:IsHelicopter() and "Helo" or (ExistingGroup:IsAir() and "Air" or "Ground")

                        if isAirUnit then
							local FlightGroup = FLIGHTGROUP:New(ExistingGroup)
							local combatMission = nil
						
							if taskType == "CAP" or taskType == "ESCORT" then
								combatMission = missionCAP(zoneName, targetCoord, FlightGroup)
							elseif taskType == "INTERCEPT" then
								combatMission = missionIntercept(zoneName, targetCoord, action.reference_entity)
							elseif taskType == "CAS" then
								combatMission = missionCAS(zoneName, targetCoord)
							elseif taskType == "SEAD" then
								combatMission = missionSEAD(zoneName, targetCoord, FlightGroup)
							elseif taskType == "STRIKE" then
								combatMission = missionStrike(targetCoord, action.reference_entity, action.group_name, coalitionStr)
							elseif taskType == "TRANSPORT_TROOPS" or taskType == "TRANSPORT_LOGISTICS" then
								if unitCategory == "Helo" then
									RouteHeloDrop(ExistingGroup, targetCoord, 120, 3000, taskType, coalitionStr)
								else
									RouteAirplaneDrop(ExistingGroup, targetCoord, 250, 15000, taskType, coalitionStr)
								end
							end
							
							-- Si generó una misión de combate AUFTRAG, la asignamos
							if combatMission then
								ExistingGroup:ClearTasks() 
								FlightGroup:AddMission(combatMission)
							end
						else
							if taskType == "BALLISTIC" then
								missionBalisticMissile(action.group_name, targetCoord.x, targetCoord.z, action.radius)
							else    -- ASSAULT
								RouteGroundUnit(ExistingGroup, targetCoord, 40, action.route_via, taskType, coalitionStr)
							end
						end
						
					end	
				end
            else
                env.info("AEM Commander: Attempted to command non-existent or dead group: " .. tostring(action.group_name))
            end
        end
    end
end

function missionCAP(zoneName, targetCoord, flightGroup)
	local altitude = math.random(18000, 28000)
	local speed = 420
	local combatMission = AUFTRAG:NewCAP(ZONE_RADIUS:New(zoneName, targetCoord:GetVec2(), 60000), altitude, speed, targetCoord)
						
	-- Hold over the target instead of RTB if task ends for any reasson
	function combatMission:OnAfterDone(From, Event, To)
		local holdMission = AUFTRAG:NewORBIT(targetCoord, altitude, speed)
		flightGroup:AddMission(holdMission)
	end
	
	return combatMission
end

function missionIntercept(zoneName, targetCoord, targetGroupName)
	local altitude = math.random(25000, 35000)
    local speed = 550
    local TargetGroup = targetGroupName and GROUP:FindByName(targetGroupName) or nil
	local combatMission
    if TargetGroup and TargetGroup:IsAlive() then
        combatMission = AUFTRAG:NewINTERCEPT(TargetGroup)
    else
		combatMission = AUFTRAG:NewCAP(ZONE_RADIUS:New(zoneName, targetCoord:GetVec2(), 50000), altitude, speed, targetCoord)
    end 
	return combatMission
end

function missionCAS(zoneName, targetCoord)
	local altitude = math.random(8000, 15000)
    local speed = 320
    return AUFTRAG:NewCAS(ZONE_RADIUS:New(zoneName, targetCoord:GetVec2(), 30000), altitude, speed, targetCoord)
end

function missionSEAD(zoneName, targetCoord, flightGroup)
	local altitude = math.random(18000, 24000)
	local speed = 400
	local combatMission = AUFTRAG:NewSEAD(ZONE_RADIUS:New(zoneName, targetCoord:GetVec2(), 60000), altitude)
				
	-- Orbit over the target instead of RTB if task ends, for example,
	-- because SAM radars are switched off momentarily
	function combatMission:OnAfterDone(From, Event, To)
		local holdMission = AUFTRAG:NewORBIT(targetCoord, altitude, speed)
		flightGroup:AddMission(holdMission)
	end
	
	return combatMission
end

function missionStrike(targetCoord, enemyGroupName, ownGroupName, coalitionStr)
	local altitude = math.random(12000, 18000)
    local speed = math.random(320, 380)
	local enemyGroupObj = enemyGroupName and GROUP:FindByName(enemyGroupName)
    local strikeTarget = enemyGroupObj or targetCoord
    
	local combatMission = AUFTRAG:NewBOMBING(strikeTarget, altitude, speed)
            
    function combatMission:OnAfterSuccess(From, Event, To)
        PushEvent(string.lower(coalitionStr), {
			type = "mission_completed",
            task = "STRIKE",
            status = "SUCCESS",
            groupName = ownGroupName,
            targetName = enemyGroupName or "Coordinate Target"
        })
    end

    function combatMission:OnAfterFailed(From, Event, To)
		PushEvent(string.lower(coalitionStr), {
			type = "mission_completed",
            task = "STRIKE",
            status = "FAILED",
            groupName = ownGroupName,
            targetName = enemyGroupName or "Coordinate Target"
        })
    end
	
	return combatMission
end

function missionBalisticMissile(groupName, posX, posZ, radius)
    
	radius = radius or 500 

    local LauncherGroup = GROUP:FindByName(groupName)
    
    if LauncherGroup then
        -- 1. Generamos el desvío aleatorio (dispersión)
        local angulo = math.random() * 2 * math.pi
        local distanciaAleatoria = math.sqrt(math.random()) * radius

        local offsetX = math.cos(angulo) * distanciaAleatoria
        local offsetZ = math.sin(angulo) * distanciaAleatoria

        -- Aplicamos el desvío a las coordenadas originales
        local posX_final = posX + offsetX
        local posZ_final = posZ + offsetZ

        -- 2. Creamos la coordenada dinámicamente con la dispersión aplicada
        local TargetCoord = COORDINATE:NewFromVec2({x = posX_final, y = posZ_final})
        
        -- 3. Obtenemos la posición de la lanzadera para calcular la distancia
        local ScudCoord = LauncherGroup:GetCoordinate()
        local distanciaMetros = TargetCoord:Get2DDistance(ScudCoord)
        local distanciaKm = math.floor(distanciaMetros / 1000)
        
        -- 4. Comprobamos la restricción física del SCUD en DCS (50km - 290km)
        if distanciaMetros >= 50000 and distanciaMetros <= BALLISTIC_MISSILE_RANGE then
            -- Ordenamos el fuego
            LauncherGroup:TaskArtillery(TargetCoord, nil, nil, 1)
            
            local mensajeLog = string.format("Lanzamiento SCUD ordenado. Error simulado de %d metros. Distancia: %d km", math.floor(distanciaAleatoria), distanciaKm)
            env.info(mensajeLog)
            
            -- Opcional: Descomentar la siguiente línea si quieres un mensaje en pantalla al disparar
            -- trigger.action.outText(mensajeLog, 10)
        else
            env.error("AEM Commander: balistic missile target is at " .. distanciaKm .. " km. Out of range (50-" .. BALLISTIC_MISSILE_RANGE .. " km)")
        end
    else
        env.error("AEM Commander: balistic missile group not found " .. LauncherGroup)
    end
end

-- ======================================================================
-- Start execution
-- ======================================================================

if AUTO_CONNECT then
    timer.scheduleFunction(AEM_NetworkLoop, nil, timer.getTime() + 1)
else
    menuConnectServer = missionCommands.addSubMenu("Connect to HQ", nil)
    local menuConnectServerCmd1 = missionCommands.addCommand("Connect", menuConnectServer, function() timer.scheduleFunction(AEM_NetworkLoop, nil, timer.getTime() + 1) end, nil)
    local menuChangeIP = missionCommands.addSubMenu("Change IP (Last Octet)", menuConnectServer)
    for i = IP_RANGE_FROM, IP_RANGE_TO do
        missionCommands.addCommand("Set IP to ." .. i, menuChangeIP, function() setHostIP(i) end, nil)
    end
    
end

printBootStatus()