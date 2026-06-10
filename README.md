<p align="center">
  <img src="aem-commander.png" alt="AEM Commander image" width="50%">
</p>

# AEM Commander - Autonomous Engagement Monitor

`aem-commander` is a tool designed to connect the DCS World simulation environment with external Artificial Intelligence agents, enabling dynamic and automated decision-making in real-time.

## Project Status: Proof of Concept (PoC)

Currently, the project is in a **Proof of Concept (PoC)** stage. The system is fully functional, but it features only the minimal and strictly necessary capabilities to validate the end-to-end technical architecture.

The main goal of this phase is to certify that the entire critical data flow operates correctly:

1. **Data Collection:** Capturing events and the current state of the environment within the DCS World mission.
2. **App Transmission:** Sending the collected information to the local external application.
3. **AI Agent:** Processing and analyzing the data by an Artificial Intelligence agent to determine the next actions.
4. **Instruction Injection:** Sending the AI-generated directives and commands back into the simulator.
5. **Execution via MOOSE:** Receiving and successfully executing the instructions in-game using the **MOOSE** (Mission Object Oriented Scripting Environment) framework.

## Instalation and usage

> [!WARNING]  
> **API Usage Costs** > Please be aware that running the external AI agent requires connecting to a third-party AI provider (currently only Google Gemini) via API. **This will incur real-world costs based on token usage.** As the mission progresses and data is continuously analyzed, token consumption can increase. You are responsible for providing your own API key and monitoring your billing limits.

Currently the app only uses Google Gemini through [Gen AI](https://www.npmjs.com/package/@google/genai) API. You must be authenticated to use it, either with:
- API Key: it can be obtained in [Google AI Studio](https://aistudio.google.com/welcome) > pricing depend on your region, some region do offer free tier for some models. For me, while testing this app, in Spain, Europe, there is no free tier large enough available. Most likely you will need to activate billing.
- Service account's json for Vertex AI (now called Gemini Enterprise Agent Platform): harder to set up, but **you get $300 free credits to spend during 3 months**. You must sign up on [Google Cloud](https://cloud.google.com/free) and set up billing to recieve the free credits (remember to deactive your account after the 3 months period to avoid any charges).

Actual cost depends on usage, the longer your playtime, the more queries to the API. In my testing, a 1 hour long mission do not exceed $1.

### Mission editor configuration

1. `json.lua` must be loaded into the mission (external library by [rxi](https://github.com/rxi/json.lua) used on the main script)
2. Add statics representing available units for the commander to task. Each static's name must start with a prefix and contain the name of the tasks it can perform on its name, e.g.: `AEM_RES CAP intercept RED_PLACEHOLDER_Mig21Bis_Mezzeh_0007` - `AEM_RES` is my prefix and `CAP` and `intercept` its tasks
3. Place a late activation groups for each type of available unit/task. With the example above we need to place two groups one for Mig21 CAP and another for Mig21 interceptors. The group's name must follow exactly this structure: `TEMPLATE_PREFIX` + [`"red"`/`"blue"`] + `" "` + `task` + `" "` + `unit type`, e.g.: `AEM_TPL_red CAP MiG-21Bis`
4. Define each coalition's border with a late activation group
5. Place late activation groups representing downed pilot on land and water for both coalitions, and the sound's filename acting as transmited signal for their "SOS beacon"

### aem-commander.lua configuration

Before running the mission, you need to edit the `aem-commander.lua` script to ensure the variables match the group names, prefixes, and configurations used in your DCS Mission Editor.

### Naming Conventions & Options

| Variable / Prefix | Description | Default Value / Example |
| :--- | :--- | :--- |
| `*_EW` | Prefix for EW groups. Can be any unit type. They contribute with their sensors to enemy detection (ground/aerial radar, naval, JTAC, etc.). | `"RED EW"` / `"BLUE EW"` |
| `*_SAM` | Prefix for SAM groups. | `"RED SAM"` / `"BLUE SAM"` |
| `*_BORDER` | Late activation group defining the coalition's border. Its first and last waypoints are virtually joined to create a polygon. | `"RED BORDER"` / `"BLUE BORDER"` |
| `STATIC_RESOURCE` | Prefix for static units tasked by the AI. The name **must** contain at least one valid task (CAP, SEAD, CAS, STRIKE, ANTI-SHIP, ESCORT, TRANSPORT). | `"AEM_RES"`<br>*(e.g., `[AEM_RES]RED_SU24M_SEAD`)* |
| `TEMPLATE_PREFIX` | Prefix for late activation group templates used by the AI (via MOOSE SPAWN). The name **must** contain the coalition, task, and type class name strictly in that order. | `"AEM_TPL_"`<br>*(e.g., `[AEM_TPL_]RED SEAD Su-24M`)* |
| `SCHEDULER_ISR_FREQ_*` | Time in seconds between each ISR data update sent to the AI Commander. | `60` |
| `*_RAFT` / `*_PILOT` | CSAR late activation group names for water and ground templates. | `"BLUE LIFE RAFT"`, etc. |
| `__CSAR_SOS` | Audio filename used as the SOS beacon. | `"morse-sos.ogg"` |

### Lua Variables

Locate the following block inside your `aem-commander.lua` file and adjust the strings to match your mission setup:

```lua
-- General Variables
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

-- CSAR Variables
BLUE_RAFT = "BLUE LIFE RAFT"
BLUE_PILOT = "BLUE DOWNED PILOT"
RED_RAFT = "RED LIFE RAFT"
RED_PILOT = "RED DOWNED PILOT"
__CSAR_SOS = "morse-sos.ogg"
```

## Building from source code

Once you have [NodeJs installed](https://nodejs.org/en/download), you can build the app with the following commands (only tested on windows):
```bash
npm run package-win
```
```bash
npm run package-mac
```
```bash
npm run package-linux
```
---
*Note: As this is an early-stage development, advanced features, code robustness, and complex strategic capabilities will be expanded in future iterations as this technical foundation is consolidated.*
