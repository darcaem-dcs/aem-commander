const AdmZip = require('adm-zip');
const CivExtractor = require('./civExtractor.js'); // reuse the Lua table helpers

const TASK_KEYWORDS = [
    'INTERCEPT', 'CAP', 'SEAD', 'CAS', 'STRIKE', 'ANTI-SHIP', 'ESCORT', 'CSAR',
    'ASSAULT', 'FIRE_SUPPORT', 'BALLISTIC',
    'TRANSPORT_TROOPS', 'TRANSPORT_LOGISTICS', 'AWACS', 'TANKER'
];

// DCS static "category" -> group table category
const AIR_CATEGORIES = { 'Planes': 'plane', 'Helicopters': 'helicopter' };
const GROUND_CATEGORIES = [
    'Armor', 'Artillery', 'Air Defence', 'Unarmed', 'Infantry',
    'MissilesSS', 'Locomotive', 'Carriage'
];
const CATEGORY_MAP = {
    ...AIR_CATEGORIES,
    ...Object.fromEntries(GROUND_CATEGORIES.map(c => [c, 'vehicle']))
};

class StaticExtractor {

    static extractFromMiz(mizPath, staticPrefix, templatePrefix) {
        const zip = new AdmZip(mizPath);
        const missionEntry = zip.getEntry('mission');
        if (!missionEntry) throw new Error("Invalid .miz file (no mission file found).");
        const dictEntry = zip.getEntry('l10n/DEFAULT/dictionary');
        return this.extract(
            zip.readAsText(missionEntry, 'utf8'),
            dictEntry ? zip.readAsText(dictEntry, 'utf8') : '',
            staticPrefix, templatePrefix
        );
    }

    /**
     * @returns {{ statics: Array, templates: Array, skipped: Array }}
     *  templates: one entry per (side, task, type) -> "<templatePrefix><SIDE> <TASK> <type>"
     */
    static extract(missionText, dictText = '', staticPrefix = 'AEM_RES', templatePrefix = 'AEM_TPL_') {
        staticPrefix = staticPrefix || 'AEM_RES';
        templatePrefix = templatePrefix || 'AEM_TPL_';

        const dict = CivExtractor.parseDictionary(dictText);
        const resolve = (v) => (v !== null && dict[v] !== undefined) ? dict[v] : v;

        const rootStart = missionText.indexOf('{');
        if (rootStart === -1) throw new Error("Invalid mission file.");
        const root = missionText.substring(rootStart);
        const coalitions = CivExtractor.getTopLevelField(root, 'coalition');
        if (!coalitions) throw new Error("Invalid mission file (no coalition table found).");

        const statics = [];
        const skipped = [];

        for (const side of ['red', 'blue']) {
            const sideBlock = CivExtractor.getTopLevelField(coalitions, side);
            if (!sideBlock) continue;
            const countries = CivExtractor.getTopLevelField(sideBlock, 'country');
            if (!countries) continue;

            for (const countryBlock of CivExtractor.getChildTables(countries)) {
                const staticTbl = CivExtractor.getTopLevelField(countryBlock, 'static');
                const groups = staticTbl && CivExtractor.getTopLevelField(staticTbl, 'group');
                if (!groups) continue;

                const countryId = parseInt(CivExtractor.getTopLevelField(countryBlock, 'id'), 10);
                const countryName = resolve(CivExtractor.getTopLevelField(countryBlock, 'name')) || 'Unknown';

                for (const groupBlock of CivExtractor.getChildTables(groups)) {
                    const unitsBlock = CivExtractor.getTopLevelField(groupBlock, 'units');
                    if (!unitsBlock) continue;

                    for (const unitBlock of CivExtractor.getChildTables(unitsBlock)) {
                        const name = resolve(CivExtractor.getTopLevelField(unitBlock, 'name'));
                        if (!name || !name.startsWith(staticPrefix)) continue;

                        // Same semantics as GetMissionsFromName in the Lua (plain "contains", upper case)
                        const upper = name.substring(staticPrefix.length).toUpperCase();
                        const tasks = TASK_KEYWORDS.filter(k => upper.includes(k));
                        if (tasks.length === 0) continue;

                        const type = CivExtractor.getTopLevelField(unitBlock, 'type');
                        const category = CivExtractor.getTopLevelField(unitBlock, 'category');

                        if (!type || !CATEGORY_MAP[category]) {
                            skipped.push({ name, type, category, reason: 'Unsupported static category (only Planes, Helicopters and Ground Units)' });
                            continue;
                        }

                        statics.push({
                            name, side, type, tasks,
                            countryId, countryName,
                            category: CATEGORY_MAP[category],
                            livery: CivExtractor.getTopLevelField(unitBlock, 'livery_id') || null,
                            x: parseFloat(CivExtractor.getTopLevelField(unitBlock, 'x')),
                            y: parseFloat(CivExtractor.getTopLevelField(unitBlock, 'y')),
                            heading: parseFloat(CivExtractor.getTopLevelField(unitBlock, 'heading')) || 0
                        });
                    }
                }
            }
        }

        return { statics, templates: this.buildTemplates(statics, templatePrefix), skipped };
    }

    static buildTemplates(statics, templatePrefix) {
        const map = new Map();
        for (const s of statics) {
            for (const task of s.tasks) {
                const key = `${s.side}|${task}|${s.type}`;
                if (!map.has(key)) {
                    map.set(key, {
                        templateName: `${templatePrefix}${s.side.toUpperCase()} ${task} ${s.type}`,
                        side: s.side, task, type: s.type, category: s.category,
                        countryId: s.countryId, countryName: s.countryName,
                        livery: s.livery, x: s.x, y: s.y, heading: s.heading,
                        staticCount: 0, staticNames: []
                    });
                }
                const entry = map.get(key);
                entry.staticCount++;
                entry.staticNames.push(s.name);
            }
        }
        return [...map.values()];
    }
}

module.exports = StaticExtractor;