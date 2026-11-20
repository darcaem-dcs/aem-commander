// JSON-Schema (lower-case types) for the single-shot commander answer.
// Gemini gets it converted (upper-case types) by llmProviders.js.
const TASKS = [
    'INTERCEPT', 'CAP', 'SEAD', 'CAS', 'STRIKE', 'ANTI-SHIP', 'ESCORT', 'CSAR',
    'ASSAULT', 'TRANSPORT_TROOPS', 'TRANSPORT_LOGISTICS', 'FIRE_SUPPORT', 'BALLISTIC', 'RTB'
];

const ORDER_SCHEMA = {
    type: 'object',
    properties: {
        mission_log: {
            type: 'string',
            description: 'Short strategic summary (max 3 sentences). Only mention unit types that appear in the brief.'
        },
        actions: {
            type: 'array',
            description: 'Orders to issue. Empty array if no action is needed.',
            items: {
                type: 'object',
                properties: {
                    action_type: { type: 'string', enum: ['new', 'existing'] },
                    group_name: { type: 'string', description: "Active group id (ONLY for 'existing')." },
                    unit_names: { type: 'array', items: { type: 'string' }, description: "Reserve unit ids taken from the brief (ONLY for 'new')." },
                    task: { type: 'string', enum: TASKS },
                    target_area: {
                        type: 'object',
                        properties: { lat: { type: 'number' }, long: { type: 'number' } },
                        required: ['lat', 'long']
                    },
                    target_name: { type: 'string', description: 'Goal id, if the order serves a goal.' },
                    route_via: { type: 'string', description: 'border_crossing goal id (ground forces entering enemy territory).' },
                    reference_entity: { type: 'string', description: 'Group/unit referenced by the task (INTERCEPT target, ESCORT group, CSAR pilot).' },
                    rationale: { type: 'string', description: 'One short sentence.' }
                },
                required: ['action_type', 'task']
            }
        }
    },
    required: ['mission_log', 'actions']
};

module.exports = { ORDER_SCHEMA, TASKS };
