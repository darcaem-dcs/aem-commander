const path = require('path');
const AdmZip = require('adm-zip');
const CivExtractor = require('./civExtractor.js');
const { xyToLatLon, hasProjection } = require('./dcsProjection.js');

const field = (b, k) => (b ? CivExtractor.getTopLevelField(b, k) : null);
const children = b => (b ? CivExtractor.getChildTables(b) : []);

const GROUP_CATEGORIES = { plane: 'Air', helicopter: 'Helo', vehicle: 'Ground', ship: 'Naval' };
const STATIC_CATEGORIES = { Planes: 'Air', Helicopters: 'Helo', Ships: 'Naval' };   // anything else -> Ground
const TAGS = ['INTERCEPT', 'CAP', 'SEAD', 'CAS', 'STRIKE', 'ANTI-SHIP', 'ESCORT', 'CSAR', 'ASSAULT',
    'FIRE_SUPPORT', 'BALLISTIC', 'TRANSPORT_TROOPS', 'TRANSPORT_LOGISTICS', 'AWACS', 'TANKER', 'EW', 'SAM', 'AAA'];

const DEFAULTS = {
    redBorder: 'RED BORDER', blueBorder: 'BLUE BORDER',
    redEw: 'RED EW', blueEw: 'BLUE EW', redSam: 'RED SAM', blueSam: 'BLUE SAM',
    staticRes: 'AEM_RES', templatePrefix: 'AEM_TPL_'
};

const tagsFromName = name => { const u = name.toUpperCase(); return TAGS.filter(t => u.includes(t)); };
const r5 = n => Math.round(n * 1e5) / 1e5;
const headingDeg = rad => { const d = ((rad || 0) * 180 / Math.PI) % 360; return Math.round(d < 0 ? d + 360 : d); };

class MissionScanner {

    static scanFromMiz(mizPath, opts = {}) {
        const zip = new AdmZip(mizPath);
        const missionEntry = zip.getEntry('mission');
        if (!missionEntry) throw new Error('Invalid .miz file (no mission file found).');
        const dictEntry = zip.getEntry('l10n/DEFAULT/dictionary');
        const layout = this.scan(zip.readAsText(missionEntry, 'utf8'), dictEntry ? zip.readAsText(dictEntry, 'utf8') : '', opts);

        // Name used by the plan: MISSION_NAME of an injected mission, otherwise the file name
        let missionName = path.basename(mizPath, '.miz');
        const valuesEntry = zip.getEntry('l10n/DEFAULT/aem-commander-values.lua');
        if (valuesEntry) {
            const m = zip.readAsText(valuesEntry, 'utf8').match(/MISSION_NAME\s*=\s*"([^"]+)"/);
            if (m) missionName = m[1];
        }
        layout.missionName = missionName;
        return layout;
    }

    static scan(missionText, dictText = '', opts = {}) {
        const o = { ...DEFAULTS };
        for (const k of Object.keys(opts || {})) if (opts[k] && opts[k] !== 'NONE') o[k] = opts[k];

        const dict = CivExtractor.parseDictionary(dictText);
        const resolve = v => (v !== null && v !== undefined && dict[v] !== undefined) ? dict[v] : v;

        const theatreMatch = missionText.match(/\["theatre"\]\s*=\s*"([^"]+)"/);
        const theatre = theatreMatch ? theatreMatch[1] : null;

        const layout = { theatre, bounds: null, groups: [], statics: [], goals: [], borders: { red: [], blue: [] } };
        if (!hasProjection(theatre)) {
            layout.projectionError = `No coordinate projection available for theatre "${theatre}".`;
            return layout;
        }

        const b = { south: 90, west: 180, north: -90, east: -180 };
        const pt = (x, y) => {
            const p = xyToLatLon(theatre, x, y);
            if (!p) return null;
            b.south = Math.min(b.south, p.lat); b.north = Math.max(b.north, p.lat);
            b.west = Math.min(b.west, p.lon);   b.east = Math.max(b.east, p.lon);
            return [r5(p.lat), r5(p.lon)];
        };
        const num = (blk, k) => parseFloat(field(blk, k));

        const rootStart = missionText.indexOf('{');
        if (rootStart === -1) throw new Error('Invalid mission file.');
        const root = missionText.substring(rootStart);
        const coalitions = field(root, 'coalition');
        if (!coalitions) throw new Error('Invalid mission file (no coalition table found).');

        for (const side of ['red', 'blue']) {
            const countries = field(field(coalitions, side), 'country');
            for (const countryBlock of children(countries)) {

                // Groups: planes, helicopters, vehicles, ships
                for (const [key, category] of Object.entries(GROUP_CATEGORIES)) {
                    for (const g of children(field(field(countryBlock, key), 'group'))) {
                        const name = resolve(field(g, 'name')) || '';
                        const units = children(field(g, 'units'));
                        if (units.length === 0) continue;

                        const routePts = children(field(field(g, 'route'), 'points'))
                            .map(w => pt(num(w, 'x'), num(w, 'y'))).filter(Boolean);

                        // Border definition groups: only their route matters
                        if (name === o[side + 'Border']) { layout.borders[side] = routePts; continue; }

                        const lead = units[0];
                        const pos = pt(num(lead, 'x') || num(g, 'x'), num(lead, 'y') || num(g, 'y'));
                        if (!pos) continue;

                        const tags = tagsFromName(name);
                        if (name.startsWith(o[side + 'Ew']) && !tags.includes('EW')) tags.push('EW');
                        if (name.startsWith(o[side + 'Sam']) && !tags.includes('SAM')) tags.push('SAM');

                        layout.groups.push({
                            id: name, side, category,
                            type: field(lead, 'type') || '?',
                            count: units.length, tags,
                            late: field(g, 'lateActivation') === 'true' || name.startsWith(o.templatePrefix),
                            lat: pos[0], lon: pos[1],
                            heading: headingDeg(num(lead, 'heading')),
                            route: routePts.length > 1 ? routePts : []
                        });
                    }
                }

                // Statics (AEM_RES ones are the commander's reserves)
                for (const g of children(field(field(countryBlock, 'static'), 'group'))) {
                    for (const u of children(field(g, 'units'))) {
                        const name = resolve(field(u, 'name')) || '';
                        const pos = pt(num(u, 'x'), num(u, 'y'));
                        if (!pos) continue;
                        const reserve = name.startsWith(o.staticRes);
                        layout.statics.push({
                            id: name, side, reserve,
                            category: STATIC_CATEGORIES[field(u, 'category')] || 'Ground',
                            type: field(u, 'type') || '?',
                            tags: reserve ? tagsFromName(name.substring(o.staticRes.length)) : [],
                            lat: pos[0], lon: pos[1],
                            heading: headingDeg(num(u, 'heading'))
                        });
                    }
                }
            }
        }

        // Goals: trigger zones GOAL_RED* / GOAL_BLUE* (same convention as ExportGoals in the Lua)
        for (const z of children(field(field(root, 'triggers'), 'zones'))) {
            const name = resolve(field(z, 'name')) || '';
            const m = /^GOAL_(RED|BLUE)/.exec(name);
            if (!m) continue;
            const props = {};
            children(field(z, 'properties')).forEach(p => { props[resolve(field(p, 'key'))] = resolve(field(p, 'value')); });
            const pos = pt(num(z, 'x'), num(z, 'y'));
            if (!pos) continue;
            layout.goals.push({
                id: name, side: m[1].toLowerCase(), lat: pos[0], lon: pos[1],
                radius: num(z, 'radius') || 0,
                type: props.type || 'unknown',
                priority: parseFloat(props.priority || 1),
                peacetime: props.peacetime === 'true',
                props
            });
        }

        if (b.south <= b.north) layout.bounds = b;
        return layout;
    }
}

module.exports = MissionScanner;