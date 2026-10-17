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

    getBoundary(sub, start) {
        let endComma = sub.indexOf(',', start);
        let endNL = sub.indexOf('\n', start);
        let endCR = sub.indexOf('\r', start);
        let bounds = [endComma, endNL, endCR].filter(x => x !== -1);
        return bounds.length > 0 ? Math.min(...bounds) : sub.length;
    }

    extractNumber(sub, key) {
        let idx = sub.indexOf(key);
        if (idx === -1) return null;
        let start = idx + key.length;
        let end = this.getBoundary(sub, start);
        return parseFloat(sub.substring(start, end).trim());
    }

    maskOffsets(sub) {
        let cur = 0;
        while ((cur = sub.indexOf('["offsets"]', cur)) !== -1) {
            let end = this.getClosingBraceIndex(sub, cur);
            if (end !== -1) {
                let chunk = sub.substring(cur, end);
                chunk = chunk.split('["x"]').join('["_safex_"]');
                chunk = chunk.split('["y"]').join('["_safey_"]');
                sub = sub.substring(0, cur) + chunk + sub.substring(end);
                cur += chunk.length;
            } else {
                cur += 11;
            }
        }
        return sub;
    }

    unmaskOffsets(sub) {
        sub = sub.split('["_safex_"]').join('["x"]');
        sub = sub.split('["_safey_"]').join('["y"]');
        return sub;
    }

    applyDelta(sub, deltaX, deltaY) {
        sub = this.maskOffsets(sub);
        const axes = [{ key: '["x"] = ', delta: deltaX }, { key: '["y"] = ', delta: deltaY }];
        
        for (const axis of axes) {
            let cur = 0;
            while ((cur = sub.indexOf(axis.key, cur)) !== -1) {
                let start = cur + axis.key.length;
                let end = this.getBoundary(sub, start);
                let newVal = parseFloat(sub.substring(start, end).trim()) + axis.delta;
                sub = sub.substring(0, start) + newVal + sub.substring(end);
                cur = start + String(newVal).length;
            }
        }
        return this.unmaskOffsets(sub);
    }

    setAbsolute(sub, newX, newY) {
        sub = this.maskOffsets(sub);
        const axes = [{ key: '["x"] = ', val: newX }, { key: '["y"] = ', val: newY }];
        
        for (const axis of axes) {
            let cur = 0;
            while ((cur = sub.indexOf(axis.key, cur)) !== -1) {
                let start = cur + axis.key.length;
                let end = this.getBoundary(sub, start);
                sub = sub.substring(0, start) + axis.val + sub.substring(end);
                cur = start + String(axis.val).length;
            }
        }
        return this.unmaskOffsets(sub);
    }

    setHeading(sub, newHeading) {
        let cur = 0;
        const key = '["heading"] = ';
        while ((cur = sub.indexOf(key, cur)) !== -1) {
            let start = cur + key.length;
            let end = this.getBoundary(sub, start);
            sub = sub.substring(0, start) + newHeading + sub.substring(end);
            cur = start + String(newHeading).length;
        }
        return sub;
    }

    hasLink(block, unitId) {
        const keys = ['["linkUnit"] = ', '["helipadId"] = ', '["airdromeId"] = '];
        for (const key of keys) {
            let cur = 0;
            while ((cur = block.indexOf(key, cur)) !== -1) {
                let start = cur + key.length;
                let end = this.getBoundary(block, start);
                if (block.substring(start, end).trim() === String(unitId)) return true;
                cur = end;
            }
        }
        return false;
    }

    updateTimeAndDate(missionText, absoluteTime) {
        if (absoluteTime === null || absoluteTime === undefined) return missionText;

        const daysPassed = Math.floor(absoluteTime / 86400);
        const newStartTime = Math.floor(absoluteTime % 86400);

        // 1. Update Date
        let dateStart = missionText.indexOf('["date"] =');
        if (dateStart !== -1) {
            let dateEnd = this.getClosingBraceIndex(missionText, dateStart);
            let dateBlock = missionText.substring(dateStart, dateEnd);

            let year = this.extractNumber(dateBlock, '["Year"] =');
            let month = this.extractNumber(dateBlock, '["Month"] =');
            let day = this.extractNumber(dateBlock, '["Day"] =');

            if (year !== null && month !== null && day !== null) {
                // JS Date uses 0-indexed months (0 = Jan, 11 = Dec)
                let missionDate = new Date(year, month - 1, day);
                missionDate.setDate(missionDate.getDate() + daysPassed);

                let newYear = missionDate.getFullYear();
                let newMonth = missionDate.getMonth() + 1;
                let newDay = missionDate.getDate();

                dateBlock = dateBlock.replace(/(["Year"]\s*=\s*)\d+/, `$1${newYear}`);
                dateBlock = dateBlock.replace(/(["Month"]\s*=\s*)\d+/, `$1${newMonth}`);
                dateBlock = dateBlock.replace(/(["Day"]\s*=\s*)\d+/, `$1${newDay}`);
                
                missionText = missionText.substring(0, dateStart) + dateBlock + missionText.substring(dateEnd);
                logger.info(`Shifted Mission Date to: ${newYear}-${newMonth}-${newDay}`);
            }
        }

        // 2. Update Mission Start Time (Root Level Only)
        let stIdx = missionText.indexOf('\n\t["start_time"] =');
        if (stIdx === -1) stIdx = missionText.indexOf('\n    ["start_time"] =');

        if (stIdx !== -1) {
            let valStart = missionText.indexOf('=', stIdx) + 1;
            let valEnd = this.getBoundary(missionText, valStart);
            missionText = missionText.substring(0, valStart) + ' ' + newStartTime + missionText.substring(valEnd);
            logger.info(`Shifted Mission Start Time to: ${newStartTime} seconds past midnight.`);
        }

        return missionText;
    }

    process(groupsToPersist, absoluteTime = null) {
        logger.info(`--- STARTING MIZ PATCHER PROCESS ---`);
        if (!fs.existsSync(this.mizFilePath)) return false;

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
        
        let explicitlyProcessedGroupIds = new Set();
        let movedUnits = {}; 

        // Update Mission Clock if time was provided
        if (absoluteTime !== null) {
            missionText = this.updateTimeAndDate(missionText, absoluteTime);
            isModified = true;
        }

        if (groupsToPersist && groupsToPersist.length > 0) {
            // 1. Process main targets
            for (const group of groupsToPersist) {
                if (!group.units || group.units.length === 0) continue;

                const leadUnit = group.units[0];
                const unitSearchStr = `["name"] = "${leadUnit.name}"`;
                let unitIndex = missionText.indexOf(unitSearchStr);

                if (unitIndex === -1) continue;

                let startIndex = -1, braceCount = 0;
                for (let i = unitIndex; i >= 0; i--) {
                    if (missionText[i] === '}') braceCount++;
                    if (missionText[i] === '{') braceCount--;
                    if (braceCount === -3) { startIndex = i; break; }
                }
                
                const endIndex = this.getClosingBraceIndex(missionText, startIndex);

                if (startIndex !== -1 && endIndex !== -1) {
                    let groupBlock = missionText.substring(startIndex, endIndex);

                    let gidIdx = groupBlock.indexOf('["groupId"] = ');
                    if (gidIdx !== -1) {
                        let start = gidIdx + 14;
                        let end = this.getBoundary(groupBlock, start);
                        explicitlyProcessedGroupIds.add(groupBlock.substring(start, end).trim());
                    }

                    const isGroundUnit = groupBlock.includes('["spans"]');
                    let spawnHeading = leadUnit.heading;
                    let targetX = null;
                    let targetY = null;

                    // Calculate Vector Heading for Naval/Air
                    if (!isGroundUnit) {
                        let pStart = groupBlock.indexOf('["points"] =');
                        let w1Start = groupBlock.indexOf('[1] =', pStart);
                        let w1End = this.getClosingBraceIndex(groupBlock, w1Start);
                        let w2Start = groupBlock.indexOf('[2] =', w1End);
                        let w2End = w2Start !== -1 ? this.getClosingBraceIndex(groupBlock, w2Start) : -1;
                        let w3Start = w2End !== -1 ? groupBlock.indexOf('[3] =', w2End) : -1; 
                        
                        let targetBlock = null;
                        if (w3Start !== -1) {
                            targetBlock = groupBlock.substring(w3Start, this.getClosingBraceIndex(groupBlock, w3Start));
                        } else if (w2Start !== -1) {
                            targetBlock = groupBlock.substring(w2Start, w2End);
                        }

                        if (targetBlock) {
                            targetX = this.extractNumber(targetBlock, '["x"] = ');
                            targetY = this.extractNumber(targetBlock, '["y"] = ');
                            if (targetX !== null && targetY !== null) {
                                spawnHeading = Math.atan2(targetY - leadUnit.y, targetX - leadUnit.x);
                                if (spawnHeading < 0) spawnHeading += 2 * Math.PI;
                            }
                        }
                    }

                    // 2. Update units and capture origin transforms
                    for (let unitIdx = 0; unitIdx < group.units.length; unitIdx++) {
                        const unit = group.units[unitIdx];
                        const uIndex = groupBlock.indexOf(`["name"] = "${unit.name}"`);
                        if (uIndex !== -1) {
                            let uStart = -1, uBraceCount = 0;
                            for (let i = uIndex; i >= 0; i--) {
                                if (groupBlock[i] === '}') uBraceCount++;
                                if (groupBlock[i] === '{') uBraceCount--;
                                if (uBraceCount === -1) { uStart = i; break; }
                            }
                            const uEnd = this.getClosingBraceIndex(groupBlock, uStart);
                            let unitBlock = groupBlock.substring(uStart, uEnd);

                            let maskedUnitBlock = this.maskOffsets(unitBlock);
                            let origX = this.extractNumber(maskedUnitBlock, '["x"] = ');
                            let origY = this.extractNumber(maskedUnitBlock, '["y"] = ');
                            let origHeading = this.extractNumber(maskedUnitBlock, '["heading"] = ') || 0;
                            let uidIdx = unitBlock.indexOf('["unitId"] = ');

                            if (origX !== null && origY !== null && uidIdx !== -1) {
                                let start = uidIdx + 13;
                                let end = this.getBoundary(unitBlock, start);
                                let unitId = unitBlock.substring(start, end).trim();
                                
                                movedUnits[unitId] = {
                                    origX: origX,
                                    origY: origY,
                                    origHeading: origHeading,
                                    newX: unit.x,
                                    newY: unit.y,
                                    spawnHeading: isGroundUnit ? unit.heading : spawnHeading 
                                };
                            }

                            unitBlock = this.setAbsolute(unitBlock, unit.x, unit.y);
                            unitBlock = this.setHeading(unitBlock, isGroundUnit ? unit.heading : spawnHeading);
                            groupBlock = groupBlock.substring(0, uStart) + unitBlock + groupBlock.substring(uEnd);
                        }
                    }

                    // 3. Update Group Root
                    let unitsStart = groupBlock.indexOf('["units"] ='); 
                    let unitsEnd = this.getClosingBraceIndex(groupBlock, unitsStart);
                    let rootBlock = groupBlock.substring(unitsEnd);
                    groupBlock = groupBlock.substring(0, unitsEnd) + this.setAbsolute(rootBlock, leadUnit.x, leadUnit.y);

                    // 4. Handle Route Logic Conditionally
                    let pStartLocal = groupBlock.indexOf('["points"] =');
                    let w1StartLocal = groupBlock.indexOf('[1] =', pStartLocal);
                    let w1EndLocal = this.getClosingBraceIndex(groupBlock, w1StartLocal);
                    let w1BlockLocal = groupBlock.substring(w1StartLocal, w1EndLocal);
                    
                    // Everyone gets WP1 stacked to the new lead unit location
                    groupBlock = groupBlock.substring(0, w1StartLocal) + this.setAbsolute(w1BlockLocal, leadUnit.x, leadUnit.y) + groupBlock.substring(w1EndLocal);

                    // Recalculate indexes after string mutation
                    pStartLocal = groupBlock.indexOf('["points"] =');
                    w1StartLocal = groupBlock.indexOf('[1] =', pStartLocal);
                    w1EndLocal = this.getClosingBraceIndex(groupBlock, w1StartLocal);
                    let w2StartLocal = groupBlock.indexOf('[2] =', w1EndLocal);

                    if (isGroundUnit) {
                        // Purge the old physical road geometry so DCS recalculates the path dynamically
                        let spansIdx = groupBlock.indexOf('["spans"] =');
                        if (spansIdx !== -1) {
                            let spansEnd = this.getClosingBraceIndex(groupBlock, spansIdx);
                            if (spansEnd !== -1) {
                                groupBlock = groupBlock.substring(0, spansIdx) + '["spans"] = \n\t\t\t\t\t\t\t\t{\n\t\t\t\t\t\t\t\t}' + groupBlock.substring(spansEnd);
                            }
                        }
                        
                        // Stack WP2 to the current location so it instantly executes advanced actions and moves to WP3
                        if (w2StartLocal !== -1) {
                            let w2EndLocal = this.getClosingBraceIndex(groupBlock, w2StartLocal);
                            let w2BlockLocal = groupBlock.substring(w2StartLocal, w2EndLocal);
                            groupBlock = groupBlock.substring(0, w2StartLocal) + this.setAbsolute(w2BlockLocal, leadUnit.x, leadUnit.y) + groupBlock.substring(w2EndLocal);
                        }
                    } else {
                        // Naval/Air: Move WP2 to the projected target vector
                        if (targetX !== null && targetY !== null && w2StartLocal !== -1) {
                            let w2EndLocal = this.getClosingBraceIndex(groupBlock, w2StartLocal);
                            let w2BlockLocal = groupBlock.substring(w2StartLocal, w2EndLocal);
                            groupBlock = groupBlock.substring(0, w2StartLocal) + this.setAbsolute(w2BlockLocal, targetX, targetY) + groupBlock.substring(w2EndLocal);
                        }
                    }

                    missionText = missionText.substring(0, startIndex) + groupBlock + missionText.substring(endIndex);
                    isModified = true;
                    logger.info(`Persisted root group: ${group.name} | Type: ${isGroundUnit ? 'Ground (Shifted Route)' : 'Naval/Air (Stacked Waypoints)'}`);
                }
            }

            // 5. Transform Linked Statics/Clients using 2D Rotation Matrix
            let curIdx = 0;
            let groupRoots = [];
            
            while ((curIdx = missionText.indexOf('["groupId"] = ', curIdx)) !== -1) {
                let start = -1, braces = 0;
                for (let i = curIdx; i >= 0; i--) {
                    if (missionText[i] === '}') braces++;
                    if (missionText[i] === '{') braces--;
                    if (braces === -1) { start = i; break; }
                }
                if (start !== -1) {
                    let end = this.getClosingBraceIndex(missionText, start);
                    if (end !== -1) groupRoots.push({ start, end });
                }
                curIdx += 14;
            }

            groupRoots.sort((a, b) => b.start - a.start);

            for (const root of groupRoots) {
                let block = missionText.substring(root.start, root.end);
                
                let rootGroupId = null;
                let rGidIdx = block.indexOf('["groupId"] = ');
                if (rGidIdx !== -1) {
                    let start = rGidIdx + 14;
                    let end = this.getBoundary(block, start);
                    rootGroupId = block.substring(start, end).trim();
                }

                if (rootGroupId && explicitlyProcessedGroupIds.has(rootGroupId)) continue; 

                let foundLink = false, linkedToId = null;
                for (const unitId of Object.keys(movedUnits)) {
                    if (this.hasLink(block, unitId)) {
                        linkedToId = unitId;
                        foundLink = true;
                        break;
                    }
                }

                if (foundLink) {
                    let carrier = movedUnits[linkedToId];
                    let unitsStart = block.indexOf('["units"] =');
                    
                    if (unitsStart !== -1) {
                        let unitBlockStr = block.substring(unitsStart);
                        
                        let maskedUnitBlockStr = this.maskOffsets(unitBlockStr);
                        let origX = this.extractNumber(maskedUnitBlockStr, '["x"] = ');
                        let origY = this.extractNumber(maskedUnitBlockStr, '["y"] = ');
                        let origHeading = this.extractNumber(maskedUnitBlockStr, '["heading"] = ');

                        if (origX !== null && origY !== null) {
                            let dx_world = origX - carrier.origX;
                            let dy_world = origY - carrier.origY;
                            
                            let offsetX = dx_world * Math.cos(carrier.origHeading) + dy_world * Math.sin(carrier.origHeading);
                            let offsetY = -dx_world * Math.sin(carrier.origHeading) + dy_world * Math.cos(carrier.origHeading);
                            
                            let expectedNewX = carrier.newX + offsetX * Math.cos(carrier.spawnHeading) - offsetY * Math.sin(carrier.spawnHeading);
                            let expectedNewY = carrier.newY + offsetX * Math.sin(carrier.spawnHeading) + offsetY * Math.cos(carrier.spawnHeading);

                            let finalDeltaX = expectedNewX - origX;
                            let finalDeltaY = expectedNewY - origY;

                            block = this.applyDelta(block, finalDeltaX, finalDeltaY);
                            
                            if (origHeading !== null) {
                                let offsetHeading = origHeading - carrier.origHeading;
                                let expectedNewHeading = carrier.spawnHeading + offsetHeading;
                                
                                expectedNewHeading = expectedNewHeading % (2 * Math.PI);
                                if (expectedNewHeading < 0) expectedNewHeading += 2 * Math.PI;

                                block = this.setHeading(block, expectedNewHeading);
                            }

                            missionText = missionText.substring(0, root.start) + block + missionText.substring(root.end);
                            isModified = true;
                            logger.info(`Rotated and shifted linked group attached to carrier unitId: ${linkedToId}`);
                        }
                    }
                }
            }
        }

        if (isModified) {
            missionEntry.setData(Buffer.from(missionText, 'utf8'));
            zip.writeZip(this.mizFilePath);
            logger.info("Mission file updated with precise unit coordinates.");
            return true;
        }

        return false;
    }
}

module.exports = MizPatcher;