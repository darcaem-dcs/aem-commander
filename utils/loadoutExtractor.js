const fs = require('fs');
const AdmZip = require('adm-zip');

class LoadoutExtractor {
    
    static extractFromMaster(mizPath, outputPath) {
        const zip = new AdmZip(mizPath);
        const missionEntry = zip.getEntry('mission');
        if (!missionEntry) throw new Error("Invalid .miz file (no mission file found).");
        
        const missionText = zip.readAsText(missionEntry, 'utf8');
        const loadouts = {};
        let nameMappings = []; 

        // 1A. Check mission file directly (Non-localized)
        const directRegex = /\["name"\]\s*=\s*"(AEM_LOADOUT_[^"]+)"/g;
        let match;
        while ((match = directRegex.exec(missionText)) !== null) {
            nameMappings.push({ key: match[1], name: match[1] });
        }

        // 1B. Check dictionary file (Localized)
        const dictEntry = zip.getEntry('l10n/DEFAULT/dictionary');
        if (dictEntry) {
            const dictText = zip.readAsText(dictEntry, 'utf8');
            const dictRegex = /\["(DictKey_[a-zA-Z0-9_]+)"\]\s*=\s*"(AEM_LOADOUT_[^"]+)"/g;
            while ((match = dictRegex.exec(dictText)) !== null) {
                nameMappings.push({ key: match[1], name: match[2] });
            }
        }

        // 2. Iterate through all found mappings and locate them in the mission text
        nameMappings.forEach(mapping => {
            // Extract the role as the very last token after the last "__"
            const nameParts = mapping.name.split('__');
            const role = nameParts.pop().trim(); // Pops the last element (e.g., "CAP")
            
            if (!role || role.includes("AEM_LOADOUT")) return; 

            const searchStr = `["name"] = "${mapping.key}"`;
            let nameIdx = missionText.indexOf(searchStr);
            
            while (nameIdx !== -1) {
                // Backtrack to find the '{' that opens this specific unit/group block
                let unitStart = -1;
                let braces = 0;
                for (let i = nameIdx; i >= 0; i--) {
                    if (missionText[i] === '}') braces++;
                    if (missionText[i] === '{') braces--;
                    if (braces === -1) {
                        unitStart = i;
                        break;
                    }
                }

                if (unitStart !== -1) {
                    const unitEnd = this.getClosingBraceIndex(missionText, unitStart);
                    if (unitEnd !== -1) {
                        const unitBlock = missionText.substring(unitStart, unitEnd + 1);

                        // Extract the exact DCS aircraft type directly from the block
                        const typeMatch = unitBlock.match(/\["type"\]\s*=\s*"([^"]+)"/);
                        if (typeMatch) {
                            const airframe = typeMatch[1]; // e.g., "FA-18C_hornet"

                            // Find the payload table inside this isolated block
                            const payloadIdx = unitBlock.search(/\["payload"\]\s*=\s*\{/);
                            if (payloadIdx !== -1) {
                                const payloadStart = unitBlock.indexOf('{', payloadIdx);
                                const payloadEnd = this.getClosingBraceIndex(unitBlock, payloadStart);
                                
                                if (payloadStart !== -1 && payloadEnd !== -1) {
                                    // Extract exactly: ["payload"] = { ... }
                                    const payloadStr = unitBlock.substring(payloadIdx, payloadEnd + 1); 

                                    if (!loadouts[airframe]) loadouts[airframe] = {};
                                    
                                    // Save it (favoring the longest string if we hit Group and Unit duplicates)
                                    if (!loadouts[airframe][role] || loadouts[airframe][role].length < payloadStr.length) {
                                        loadouts[airframe][role] = payloadStr;
                                    }
                                }
                            }
                        }
                    }
                }
                
                // Find next occurrence (in case of duplicate keys or unit/group collisions)
                nameIdx = missionText.indexOf(searchStr, nameIdx + searchStr.length);
            }
        });

        // 3. Write the dictionary to JSON
        fs.writeFileSync(outputPath, JSON.stringify(loadouts, null, 4));
        return Object.keys(loadouts).length;
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

module.exports = LoadoutExtractor;