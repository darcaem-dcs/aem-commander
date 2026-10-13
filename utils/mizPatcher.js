const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const logger = require('./log.js');

class MizPatcher {

    constructor(absoluteFilePath) {
        this.mizFilePath = absoluteFilePath;
    }

    getClosingBraceIndex(str, startIndex) {
        let braceCount = 0, startFound = false;
        for (let i = startIndex; i < str.length; i++) {
            if (str[i] === '{') { braceCount++; startFound = true; }
            if (str[i] === '}') braceCount--;
            if (startFound && braceCount === 0) return i + 1; 
        }
        return -1;
    }

    setAbsolute(sub, newX, newY) {
        let curIdx = 0;
        while ((curIdx = sub.indexOf('["x"] = ', curIdx)) !== -1) {
            let start = curIdx + 8, end = sub.indexOf(',', start);
            if (end === -1) end = sub.indexOf('\n', start);
            sub = sub.substring(0, start) + newX + sub.substring(end);
            curIdx = start + String(newX).length;
        }
        curIdx = 0;
        while ((curIdx = sub.indexOf('["y"] = ', curIdx)) !== -1) {
            let start = curIdx + 8, end = sub.indexOf(',', start);
            if (end === -1) end = sub.indexOf('\n', start);
            sub = sub.substring(0, start) + newY + sub.substring(end);
            curIdx = start + String(newY).length;
        }
        return sub;
    }

    setHeading(sub, newHeading) {
        let curIdx = 0;
        while ((curIdx = sub.indexOf('["heading"] = ', curIdx)) !== -1) {
            let start = curIdx + 14, end = sub.indexOf(',', start);
            if (end === -1) end = sub.indexOf('\n', start);
            sub = sub.substring(0, start) + newHeading + sub.substring(end);
            curIdx = start + String(newHeading).length;
        }
        return sub;
    }

    process(groupsToPersist) {
        if (!fs.existsSync(this.mizFilePath)) {
            logger.error(`Could not find ${this.mizFilePath} to apply persistence.`);
            return false;
        }

        // 1. Create Backup with dynamic name
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const originalName = path.basename(this.mizFilePath, '.miz');
        const backupPath = path.join(path.dirname(this.mizFilePath), `${originalName}_backup_${timestamp}.miz`);
        
        fs.copyFileSync(this.mizFilePath, backupPath);
        logger.info(`Mission backup created: ${backupPath}`);

        const zip = new AdmZip(this.mizFilePath);
        const missionEntry = zip.getEntry('mission');
        if (!missionEntry) return false;

        let missionText = zip.readAsText(missionEntry, 'utf8');
        let isModified = false;

        // 2. Process each captured group
        for (const group of groupsToPersist) {
            const searchStr = `["name"] = "${group.name}"`;
            let currentIndex = missionText.indexOf(searchStr);

            while (currentIndex !== -1) {
                let startIndex = -1, braceCount = 0;
                for (let i = currentIndex; i >= 0; i--) {
                    if (missionText[i] === '}') braceCount++;
                    if (missionText[i] === '{') braceCount--;
                    if (braceCount === -1) { startIndex = i; break; }
                }
                
                const endIndex = this.getClosingBraceIndex(missionText, startIndex);

                if (startIndex !== -1 && endIndex !== -1) {
                    let groupBlock = missionText.substring(startIndex, endIndex);

                    // Verify it's the physical group block
                    if (groupBlock.includes('["units"]') && groupBlock.includes('["route"]')) {
                        
                        // 3. Update individual units accurately
                        for (const unit of group.units) {
                            const unitSearch = `["name"] = "${unit.name}"`;
                            const unitIndex = groupBlock.indexOf(unitSearch);
                            if (unitIndex !== -1) {
                                let uStart = -1, uBraceCount = 0;
                                for (let i = unitIndex; i >= 0; i--) {
                                    if (groupBlock[i] === '}') uBraceCount++;
                                    if (groupBlock[i] === '{') uBraceCount--;
                                    if (uBraceCount === -1) { uStart = i; break; }
                                }
                                const uEnd = this.getClosingBraceIndex(groupBlock, uStart);
                                
                                let unitBlock = groupBlock.substring(uStart, uEnd);
                                unitBlock = this.setAbsolute(unitBlock, unit.x, unit.y);
                                unitBlock = this.setHeading(unitBlock, unit.heading);
                                groupBlock = groupBlock.substring(0, uStart) + unitBlock + groupBlock.substring(uEnd);
                            }
                        }

                        // 4. Update Group Root & Stacking logic using Lead Unit
                        const leadUnit = group.units[0];
                        if (leadUnit) {
                            let unitsStart = groupBlock.indexOf('["units"] ='); 
                            let unitsEnd = this.getClosingBraceIndex(groupBlock, unitsStart);
                            let rootBlock = groupBlock.substring(unitsEnd);
                            groupBlock = groupBlock.substring(0, unitsEnd) + this.setAbsolute(rootBlock, leadUnit.x, leadUnit.y);

                            let pStart = groupBlock.indexOf('["points"] =');
                            let w1Start = groupBlock.indexOf('[1] =', pStart);
                            let w1End = this.getClosingBraceIndex(groupBlock, w1Start);
                            let w1Block = groupBlock.substring(w1Start, w1End);
                            groupBlock = groupBlock.substring(0, w1Start) + this.setAbsolute(w1Block, leadUnit.x, leadUnit.y) + groupBlock.substring(w1End);

                            // Stack WP1 to target vector
                            pStart = groupBlock.indexOf('["points"] =');
                            w1Start = groupBlock.indexOf('[1] =', pStart);
                            w1End = this.getClosingBraceIndex(groupBlock, w1Start);
                            let w2Start = groupBlock.indexOf('[2] =', w1End);
                            let w3Start = groupBlock.indexOf('[3] =', w1End); 
                            
                            if (w2Start !== -1 && w3Start !== -1) {
                                const targetXStart = groupBlock.indexOf('["x"] = ', w3Start) + 8;
                                const targetX = parseFloat(groupBlock.substring(targetXStart, groupBlock.indexOf(',', targetXStart)));

                                const targetYStart = groupBlock.indexOf('["y"] = ', w3Start) + 8;
                                const targetY = parseFloat(groupBlock.substring(targetYStart, groupBlock.indexOf(',', targetYStart)));

                                let w2End = this.getClosingBraceIndex(groupBlock, w2Start);
                                let w2Block = groupBlock.substring(w2Start, w2End);
                                groupBlock = groupBlock.substring(0, w2Start) + this.setAbsolute(w2Block, targetX, targetY) + groupBlock.substring(w2End);
                            }
                        }

                        missionText = missionText.substring(0, startIndex) + groupBlock + missionText.substring(endIndex);
                        isModified = true;
                        break;
                    }
                }
                currentIndex = missionText.indexOf(searchStr, currentIndex + 1);
            }
        }

        if (isModified) {
            missionEntry.setData(Buffer.from(missionText, 'utf8'));
            zip.writeZip(this.mizFilePath);
            logger.info("sandbox.miz updated with precise unit coordinates.");
            return true;
        }

        return false;
    }
}

module.exports = MizPatcher;