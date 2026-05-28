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

---
*Note: As this is an early-stage development, advanced features, code robustness, and complex strategic capabilities will be expanded in future iterations as this technical foundation is consolidated.*
