const fs = require('fs');
const AdmZip = require('adm-zip');

class CsarExtractor {
    
    static extractFromMaster(mizPath, outputPath) {
        const zip = new AdmZip(mizPath);
        const missionEntry = zip.getEntry('mission');
        if (!missionEntry) throw new Error("Invalid .miz file (no mission file found).");
        
        const missionText = zip.readAsText(missionEntry, 'utf8');
        const csarTemplates = {};
        
        const targetGroups = [
            "BLUE LIFE RAFT",
            "BLUE DOWNED PILOT",
            "RED LIFE RAFT",
            "RED DOWNED PILOT"
        ];
        
        let nameMappings = []; 

        // 1A. Check mission file directly (Non-localized)
        targetGroups.forEach(groupName => {
            // Escape spaces for regex safety, though standard matching works
            const directRegex = new RegExp(`\\["name"\\]\\s*=\\s*"(${groupName})"`, 'g');
            let match;
            while ((match = directRegex.exec(missionText)) !== null) {
                nameMappings.push({ key: match[1], name: match[1] });
            }
        });

        // 1B. Check dictionary file (Localized)
        const dictEntry = zip.getEntry('l10n/DEFAULT/dictionary');
        if (dictEntry) {
            const dictText = zip.readAsText(dictEntry, 'utf8');
            targetGroups.forEach(groupName => {
                const dictRegex = new RegExp(`\\["(DictKey_[a-zA-Z0-9_]+)"\\]\\s*=\\s*"(${groupName})"`, 'g');
                let match;
                while ((match = dictRegex.exec(dictText)) !== null) {
                    nameMappings.push({ key: match[1], name: match[2] });
                }
            });
        }

        // 2. Iterate through all found mappings and locate them in the mission text
        nameMappings.forEach(mapping => {
            const searchStr = `["name"] = "${mapping.key}"`;
            let nameIdx = missionText.indexOf(searchStr);
            
            while (nameIdx !== -1) {
                // Backtrack to find the '{' that opens this specific unit/group block
                let groupStart = -1;
                let braces = 0;
                for (let i = nameIdx; i >= 0; i--) {
                    if (missionText[i] === '}') braces++;
                    if (missionText[i] === '{') braces--;
                    if (braces === -1) {
                        groupStart = i;
                        break;
                    }
                }

                if (groupStart !== -1) {
                    const groupEnd = this.getClosingBraceIndex(missionText, groupStart);
                    if (groupEnd !== -1) {
                        const groupString = missionText.substring(groupStart, groupEnd + 1);

                        
                        // Ensure we extracted the GROUP block, not a UNIT block.
                        if (groupString.includes('["units"]') && groupString.includes('["groupId"]')) {
                            // Which category table (vehicle / ship) contains this group?
                            let category = 'vehicle', best = -1;
                            for (const cat of ['vehicle', 'ship']) {
                                const idx = missionText.lastIndexOf(`["${cat}"]`, groupStart);
                                if (idx === -1 || idx <= best) continue;
                                const open = missionText.indexOf('{', idx);
                                const close = this.getClosingBraceIndex(missionText, open);
                                if (close > groupStart) { category = cat; best = idx; }
                            }
                            csarTemplates[mapping.name] = { category, template: groupString };
                        }
                    }
                }
                
                // Find next occurrence (in case of duplicate keys or unit/group collisions)
                nameIdx = missionText.indexOf(searchStr, nameIdx + searchStr.length);
            }
        });

        // 3. Write the dictionary to JSON
        fs.writeFileSync(outputPath, JSON.stringify(csarTemplates, null, 4));
        return Object.keys(csarTemplates).length;
    }

    // Robust brace counter to isolate the Lua block
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

module.exports = CsarExtractor;