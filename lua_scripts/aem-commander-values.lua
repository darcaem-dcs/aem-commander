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
-- Wildfires
--
--	Wildfires can start and expand over forest and urban areas
--
--  WILDFIRE_MAX_PROPAGATION
--  FIRE_STEP_DISTANCE
--  MIN_FIRE_SPACING
--  DROP_RADIUS
--  MAX_WATER_ALTITUDE
--  MAX_WATER_SPEED
--  IGNITE_CHANCE
--
-------------------------------------------------------------------------

MODULE_WILDFIRES = false
WILDFIRE_MAX_PROPAGATION = 25
FIRE_STEP_DISTANCE = 60  -- Distancia en metros entre focos (evita apelotonamiento)
MIN_FIRE_SPACING = 35  -- Distancia mínima a otros fuegos existentes
DROP_RADIUS = 80  -- Radio de efecto del agua en metros
MAX_WATER_ALTITUDE = 75  -- Altitud máxima (AGL) en metros para soltar agua (~250 ft)
MAX_WATER_SPEED = 40  -- Velocidad máxima (m/s) para soltar agua (~75 nudos)
IGNITE_CHANCE = 10

-------------------------------------------------------------------------
-- Debug messages
--
--	Show on screen messages (can be switched ingame with F10 menu)
--
-------------------------------------------------------------------------

MODULE_DEBUG = true