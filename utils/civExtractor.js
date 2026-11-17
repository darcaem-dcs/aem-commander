const fs = require('fs');
const AdmZip = require('adm-zip');

/**
 * Reads a "civilian master" .miz and extracts every aircraft group it contains
 * (planes and helicopters) into a JSON catalog grouped by airframe and livery.
 *
 * Output shape (civ/civil_aircrafts.json):
 * {
 *   "A-10C": {
 *     "category": "plane",
 *     "liveries": {
 *       "<livery_id>": {
 *         "groupName": "...", "coalition": "red|blue|neutrals",
 *         "country": "USA", "countryId": 2,
 *         "unitCount": 1, "lateActivation": true,
 *         "template": "{ ...raw Lua group table... }"
 *       }
 *     }
 *   }
 * }
 *
 * "template" is kept as raw Lua text (like the payloads in LoadoutExtractor),
 * so it can be embedded as-is in the Lua values file and used for MOOSE spawns.
 */
class CivExtractor {

    static extractFromMaster(mizPath, outputPath) {
        const zip = new AdmZip(mizPath);
        const missionEntry = zip.getEntry('mission');
        if (!missionEntry) throw new Error("Invalid .miz file (no mission file found).");

        const missionText = zip.readAsText(missionEntry, 'utf8');

        // Localized names (DictKey_...) live in the dictionary file
        const dictEntry = zip.getEntry('l10n/DEFAULT/dictionary');
        const dictText = dictEntry ? zip.readAsText(dictEntry, 'utf8') : '';

        const aircraft = this.parseMission(missionText, dictText);

        fs.writeFileSync(outputPath, JSON.stringify(aircraft, null, 4));
        return Object.keys(aircraft).length;
    }

    static parseMission(missionText, dictText = '') {
        const dict = this.parseDictionary(dictText);

        const rootStart = missionText.indexOf('{');
        if (rootStart === -1) throw new Error("Invalid mission file.");
        const root = missionText.substring(rootStart);

        const coalitions = this.getTopLevelField(root, 'coalition');
        if (!coalitions) throw new Error("Invalid mission file (no coalition table found).");

        const result = {};

        for (const side of ['red', 'blue', 'neutrals']) {
            const sideBlock = this.getTopLevelField(coalitions, side);
            if (!sideBlock) continue;

            const countries = this.getTopLevelField(sideBlock, 'country');
            if (!countries) continue;

            for (const countryBlock of this.getChildTables(countries)) {
                const country = this.getTopLevelField(countryBlock, 'name') || 'Unknown';
                const countryId = parseInt(this.getTopLevelField(countryBlock, 'id'), 10);

                for (const category of ['plane', 'helicopter']) {
                    const categoryBlock = this.getTopLevelField(countryBlock, category);
                    if (!categoryBlock) continue;

                    const groups = this.getTopLevelField(categoryBlock, 'group');
                    if (!groups) continue;

                    for (const groupBlock of this.getChildTables(groups)) {
                        this.addGroup(result, groupBlock, { side, country, countryId, category }, dict);
                    }
                }
            }
        }

        return result;
    }

    static addGroup(result, groupBlock, info, dict) {
        const rawName = this.getTopLevelField(groupBlock, 'name') || '';
        const groupName = dict[rawName] !== undefined ? dict[rawName] : rawName;

        const unitsBlock = this.getTopLevelField(groupBlock, 'units');
        if (!unitsBlock) return;

        const units = this.getChildTables(unitsBlock);
        if (units.length === 0) return;

        // Airframe and livery are taken from the first unit of the group
        const airframe = this.getTopLevelField(units[0], 'type');
        if (!airframe) return;
        const livery = this.getTopLevelField(units[0], 'livery_id') || 'default';

        if (!result[airframe]) result[airframe] = { category: info.category, liveries: {} };

        // Keep the first group found for each airframe/livery pair
        if (result[airframe].liveries[livery]) return;

        // Resolve localized names (group, units, waypoints) so the template is self-contained
        const template = groupBlock.replace(
            /(\["name"\]\s*=\s*")(DictKey_[A-Za-z0-9_]+)(")/g,
            (m, pre, key, post) => pre + (dict[key] !== undefined ? dict[key] : key) + post
        );

        result[airframe].liveries[livery] = {
            groupName,
            coalition: info.side,
            country: info.country,
            countryId: info.countryId,
            unitCount: units.length,
            lateActivation: this.getTopLevelField(groupBlock, 'lateActivation') === 'true',
            template
        };
    }

    static parseDictionary(dictText) {
        const dict = {};
        if (!dictText) return dict;
        const regex = /\["(DictKey_[A-Za-z0-9_]+)"\]\s*=\s*"((?:[^"\\]|\\[\s\S])*)"/g;
        let match;
        while ((match = regex.exec(dictText)) !== null) {
            dict[match[1]] = match[2];
        }
        return dict;
    }

    /**
     * Finds ["key"] = value among the direct children of a Lua table block
     * (a string that starts with '{'). Returns the table text for tables,
     * the unquoted content for strings, or the trimmed text for numbers/booleans.
     */
    static getTopLevelField(block, key) {
        const needle = `["${key}"]`;
        let depth = 0;
        let inString = false;
        let escape = false;

        for (let i = 0; i < block.length; i++) {
            const char = block[i];

            if (inString) {
                if (escape) escape = false;
                else if (char === '\\') escape = true;
                else if (char === '"') inString = false;
                continue;
            }

            if (depth === 1 && char === '[' && block.startsWith(needle, i)) {
                let j = i + needle.length;
                while (j < block.length && /\s/.test(block[j])) j++;
                if (block[j] !== '=') continue;
                j++;
                while (j < block.length && /\s/.test(block[j])) j++;

                if (block[j] === '{') {
                    const end = this.getClosingBraceIndex(block, j);
                    return end === -1 ? null : block.substring(j, end + 1);
                }
                if (block[j] === '"') {
                    let k = j + 1;
                    let esc = false;
                    for (; k < block.length; k++) {
                        if (esc) esc = false;
                        else if (block[k] === '\\') esc = true;
                        else if (block[k] === '"') break;
                    }
                    return block.substring(j + 1, k);
                }
                const scalar = block.substring(j).match(/^[^,\r\n}]+/);
                return scalar ? scalar[0].trim() : null;
            }

            if (char === '"') inString = true;
            else if (char === '{') depth++;
            else if (char === '}') depth--;
        }
        return null;
    }

    /** Returns the text of every table that is a direct child of the given table block. */
    static getChildTables(block) {
        const children = [];
        let depth = 0;
        let inString = false;
        let escape = false;

        for (let i = 0; i < block.length; i++) {
            const char = block[i];

            if (inString) {
                if (escape) escape = false;
                else if (char === '\\') escape = true;
                else if (char === '"') inString = false;
                continue;
            }

            if (char === '"') {
                inString = true;
            } else if (char === '{') {
                depth++;
                if (depth === 2) {
                    const end = this.getClosingBraceIndex(block, i);
                    if (end === -1) break;
                    children.push(block.substring(i, end + 1));
                    i = end;
                    depth = 1;
                }
            } else if (char === '}') {
                depth--;
            }
        }
        return children;
    }

    static getClosingBraceIndex(text, startIndex) {
        let braces = 1;
        let inString = false;
        let escape = false;

        for (let i = startIndex + 1; i < text.length; i++) {
            let char = text[i];

            if (inString) {
                if (escape) escape = false;
                else if (char === '\\') escape = true;
                else if (char === '"') inString = false;
            } else {
                if (char === '"') inString = true;
                else if (char === '{') braces++;
                else if (char === '}') braces--;
            }

            if (braces === 0) return i;
        }
        return -1;
    }
}

module.exports = CivExtractor;