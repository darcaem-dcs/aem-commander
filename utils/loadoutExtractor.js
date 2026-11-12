const fs = require('fs');
const AdmZip = require('adm-zip');

class LoadoutExtractor {
    
    static extractFromMaster(mizPath, outputPath) {
        const zip = new AdmZip(mizPath);
        const missionEntry = zip.getEntry('mission');
        if (!missionEntry) throw new Error("Invalid .miz file (no mission file found).");
        
        const missionText = zip.readAsText(missionEntry, 'utf8');
        const loadouts = {};

        // 1. Locate all units using the AEM_LOADOUT nomenclature
        const nameRegex = /\["name"\]\s*=\s*"AEM_LOADOUT_([A-Za-z0-9\-]+)_([A-Za-z0-9\-]+)"/g;
        let match;

        while ((match = nameRegex.exec(missionText)) !== null) {
            const airframe = match[1]; // e.g., FA18C
            const role = match[2];     // e.g., CAP

            // 2. Backtrack to find the '{' that opens this specific unit's block
            let unitStart = -1;
            let braces = 0;
            for (let i = match.index; i >= 0; i--) {
                if (missionText[i] === '}') braces++;
                if (missionText[i] === '{') braces--;
                if (braces === -1) {
                    unitStart = i;
                    break;
                }
            }

            if (unitStart !== -1) {
                // 3. Isolate the entire unit block string
                const unitEnd = this.getClosingBraceIndex(missionText, unitStart);
                const unitBlock = missionText.substring(unitStart, unitEnd + 1);

                // 4. Find the payload table inside this isolated unit block
                const payloadIdx = unitBlock.search(/\["payload"\]\s*=\s*\{/);
                if (payloadIdx !== -1) {
                    const payloadStart = unitBlock.indexOf('{', payloadIdx);
                    const payloadEnd = this.getClosingBraceIndex(unitBlock, payloadStart);
                    
                    // Extract exactly: ["payload"] = { ... }
                    const payloadStr = unitBlock.substring(payloadIdx, payloadEnd + 1); 

                    // 5. Store the raw Lua string in the dictionary
                    if (!loadouts[airframe]) loadouts[airframe] = {};
                    loadouts[airframe][role] = payloadStr;
                }
            }
        }

        // 6. Write the dictionary to JSON
        fs.writeFileSync(outputPath, JSON.stringify(loadouts, null, 4));
        return Object.keys(loadouts).length;
    }

    // Reusing the robust brace counter from your mizPatcher logic
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