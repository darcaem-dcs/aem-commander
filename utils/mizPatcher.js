const { app } = require('electron');
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

    injectScripts(luaFiles, mediaFiles = [], civTemplates = [], settings = {}) {
        logger.info(`--- STARTING LUA SCRIPT & MEDIA INJECTION ---`);
        
        if (!fs.existsSync(this.mizFilePath)) return false;

        // Work on a copy next to the original; the original is never modified
        const outputPath = path.join(path.dirname(this.mizFilePath), 'aem_next.miz');

        if (path.resolve(outputPath).toLowerCase() === path.resolve(this.mizFilePath).toLowerCase()) {
            logger.error('Injection aborted: the selected file is already "aem_next.miz". Select the original mission instead.');
            return false;
        }

        fs.copyFileSync(this.mizFilePath, outputPath);   // overwrites a previous aem_next.miz
        logger.info(`Created working copy: ${outputPath}`);

        const zip = new AdmZip(outputPath);

        // 1. Add Lua and Media files to the archive
        luaFiles.forEach(file => zip.addFile(`l10n/DEFAULT/${file.name}`, Buffer.from(file.content, 'utf8')));
        mediaFiles.forEach(file => zip.addFile(`l10n/DEFAULT/${file.name}`, file.buffer));

        // 2. Read existing DCS configuration files
        const missionEntry = zip.getEntry('mission');
        if (!missionEntry) { fs.unlinkSync(outputPath); return false; }

        let missionText = zip.readAsText(missionEntry, 'utf8');
        let dictText = zip.getEntry('l10n/DEFAULT/dictionary') ? zip.readAsText('l10n/DEFAULT/dictionary', 'utf8') : "dictionary = {\n}\n";
        let mapResText = zip.getEntry('l10n/DEFAULT/mapResource') ? zip.readAsText('l10n/DEFAULT/mapResource', 'utf8') : "mapResource = {\n}\n";

        // 3. Find and thoroughly wipe ALL existing AEM injections to prevent duplicates
        let aemIds = new Set();
        
        // 3a. Find IDs from actions safely by strictly bounding to Lua string limits
        const actionRegex = /\[(\d+)\]\s*=\s*("(?:[^"\\]|\\.)*")/g;
        let match;
        while ((match = actionRegex.exec(missionText)) !== null) {
            // Only flag the ID if the string actually contains our code identifier
            if (match[2].includes("AEM_RES_aem_commander_code_lua")) {
                aemIds.add(match[1]);
            }
        }

        // 3b. Safely find and remove the entire trigrules UI block(s) using brace counting
        let nameIdx;
        while ((nameIdx = missionText.indexOf('"AEM Commander Auto-Inject"')) !== -1) {
            let startBlock = -1;
            let braces = 0;
            
            for (let i = nameIdx; i >= 0; i--) {
                if (missionText[i] === '}') braces++;
                if (missionText[i] === '{') braces--;
                if (braces === -1) { 
                    let bracketStart = missionText.lastIndexOf('[', i);
                    if (bracketStart !== -1) {
                        let lineStart = missionText.lastIndexOf('\n', bracketStart);
                        startBlock = lineStart !== -1 ? lineStart + 1 : bracketStart;
                        
                        let idMatch = missionText.substring(startBlock, i).match(/\[(\d+)\]/);
                        if (idMatch) aemIds.add(idMatch[1]);
                    }
                    break; 
                }
            }
            
            if (startBlock !== -1) {
                let braceStart = missionText.indexOf('{', startBlock);
                let endBlock = this.getClosingBraceIndex(missionText, braceStart);
                
                if (endBlock !== -1) {
                    if (missionText[endBlock] === ',') endBlock++;
                    if (missionText[endBlock] === '\r') endBlock++;
                    if (missionText[endBlock] === '\n') endBlock++;
                    missionText = missionText.substring(0, startBlock) + missionText.substring(endBlock);
                } else {
                    break;
                }
            } else {
                break; 
            }
        }

        // 3c. Clean up actions, flag, conditions, and funcStartup for EVERY found ID
        aemIds.forEach(id => {
            // Safe regex: deletes the string ONLY if it is contained within quotes and includes AEM_RES_
            const safeStringRegex = new RegExp(`[ \\t]*\\[${id}\\]\\s*=\\s*"(?:[^"\\\\]|\\\\.)*?AEM_RES_(?:[^"\\\\]|\\\\.)*?",?\\s*\\n`, 'g');
            missionText = missionText.replace(safeStringRegex, "");
            
            missionText = missionText.replace(new RegExp(`[ \\t]*\\[${id}\\]\\s*=\\s*true,?\\s*\\n`, 'g'), "");
            missionText = missionText.replace(new RegExp(`[ \\t]*\\[${id}\\]\\s*=\\s*"return\\(true\\)",?\\s*\\n`, 'g'), "");
            missionText = missionText.replace(new RegExp(`[ \\t]*\\[${id}\\]\\s*=\\s*"if mission\\.trig\\.conditions\\[${id}\\]\\(\\) then mission\\.trig\\.actions\\[${id}\\]\\(\\) end",?\\s*\\n`, 'g'), "");
        });

        // 3d. Failsafe cleanup for the [99999] bug from previous attempts
        missionText = missionText.replace(/[ \t]*\[99999\]\s*=\s*true,?\s*\n/g, "");
        missionText = missionText.replace(/[ \t]*\[99999\]\s*=\s*"return\(true\)",?\s*\n/g, "");
        missionText = missionText.replace(/[ \t]*\[99999\]\s*=\s*"if mission\.trig\.conditions\[99999\]\(\) then mission\.trig\.actions\[99999\]\(\) end",?\s*\n/g, "");
        
        // 4. Calculate the true sequential end of the user's trigger list
        let maxIdx = 0;
        const flagMatch = missionText.match(/\["flag"\]\s*=\s*\{([\s\S]*?)\}/);
        if (flagMatch) {
            const regex = /\[(\d+)\]/g;
            let match;
            while ((match = regex.exec(flagMatch[1])) !== null) {
                maxIdx = Math.max(maxIdx, parseInt(match[1], 10));
            }
        }
        const nIdx = maxIdx + 1; // Our appended position at the end of the array!

        // 5. Clean formatting and prepare Dictionary/MapResource updates
        const dictLastBrace = dictText.lastIndexOf('}');
        if (dictLastBrace !== -1) dictText = dictText.substring(0, dictLastBrace);

        const mapLastBrace = mapResText.lastIndexOf('}');
        if (mapLastBrace !== -1) mapResText = mapResText.substring(0, mapLastBrace);

        let scriptExecs = "";
        let uiActions = "";
        
        luaFiles.forEach((file, index) => {
            const resKey = `AEM_RES_${file.name.replace(/[^a-zA-Z0-9]/g, '_')}`; 
            
            dictText += `    ["${resKey}"] = "${file.name}",\n`;
            mapResText += `    ["${resKey}"] = "${file.name}",\n`;
            
            scriptExecs += `a_do_script_file(getValueResourceByKey(\\"${resKey}\\"));`;
            
            uiActions += `
                        [${index + 1}] = {
                            ["file"] = "${resKey}",
                            ["predicate"] = "a_do_script_file",
                        },`;
        });

        dictText += "} -- end of dictionary\n";
        mapResText += "} -- end of mapResource\n";

        // 6. Inject our triggers explicitly at the end of the lists (nIdx)
        const insertIntoBlock = (text, blockName, insertString) => {
            const regex = new RegExp(`(\\["${blockName}"\\]\\s*=\\s*\\{\\s*)`);
            if (text.match(regex)) return text.replace(regex, `$1${insertString}\n`);
            return text;
        };

        missionText = insertIntoBlock(missionText, "actions", `\t\t\t[${nIdx}] = "${scriptExecs}",`);
        missionText = insertIntoBlock(missionText, "conditions", `\t\t\t[${nIdx}] = "return(true)",`);
        missionText = insertIntoBlock(missionText, "flag", `\t\t\t[${nIdx}] = true,`);
        
        if (missionText.includes('["funcStartup"]')) {
            missionText = insertIntoBlock(missionText, "funcStartup", `\t\t\t[${nIdx}] = "if mission.trig.conditions[${nIdx}]() then mission.trig.actions[${nIdx}]() end",`);
        } else {
            missionText = missionText.replace(/\["trig"\]\s*=\s*\{/, `["trig"] = {\n\t\t["funcStartup"] = {\n\t\t\t[${nIdx}] = "if mission.trig.conditions[${nIdx}]() then mission.trig.actions[${nIdx}]() end",\n\t\t},`);
        }

        const uiTrigger = `\t\t\t[${nIdx}] = {
                ["rules"] = {},
                ["eventlist"] = "",
                ["comment"] = "AEM Commander Auto-Inject",
                ["name"] = "AEM Commander Auto-Inject",
                ["actions"] = {${uiActions}
                },
                ["predicate"] = "triggerStart",
                ["color"] = { [1] = 255, [2] = 255, [3] = 255, [4] = 255 },
            },`;
        
        if (missionText.includes('["trigrules"]')) {
            missionText = insertIntoBlock(missionText, "trigrules", uiTrigger);
        } else {
            missionText = missionText.replace(/^mission\s*=\s*\{/m, `mission = {\n\t["trigrules"] = {\n${uiTrigger}\n\t},`);
        }

        // 7. Inject Civilian Templates directly into the mission file
        if (civTemplates && civTemplates.length > 0) {
            let maxGroupId = 0;
            let maxUnitId = 0;
            let match;
            
            // Find highest existing IDs globally to avoid DCS collisions
            const groupRegex = /\["groupId"\]\s*=\s*(\d+)/g;
            while ((match = groupRegex.exec(missionText)) !== null) maxGroupId = Math.max(maxGroupId, parseInt(match[1], 10));
            
            const unitRegex = /\["unitId"\]\s*=\s*(\d+)/g;
            while ((match = unitRegex.exec(missionText)) !== null) maxUnitId = Math.max(maxUnitId, parseInt(match[1], 10));

            let templatesToInject = [];
            let civTemplateCounter = 1; // Global counter to generate CIV_GEN_001, CIV_GEN_002, etc.
            
            civTemplates.forEach(civ => {
                maxGroupId++;
                let template = civ.template; 
                
                // Override Group ID
                template = template.replace(/\["groupId"\]\s*=\s*\d+/g, `["groupId"] = ${maxGroupId}`);
                
                // Override ALL Unit IDs sequentially
                template = template.replace(/\["unitId"\]\s*=\s*\d+/g, () => {
                    maxUnitId++;
                    return `["unitId"] = ${maxUnitId}`;
                });
                
                // Bypass the DCS localization dictionary entirely and sync with aem-commander-values.lua
                const baseName = `CIV_GEN_${String(civTemplateCounter).padStart(3, '0')}`;
                template = this.renameTemplate(template, baseName, '_Unit_');
                
                civTemplateCounter++;
                templatesToInject.push(template);
            });

            // Safely locate the main coalition block using strict regex to avoid comments
            let coalitionMatch = missionText.match(/\["coalition"\]\s*=\s*\{/);
            
            if (coalitionMatch) {
                let coalitionStart = coalitionMatch.index + coalitionMatch[0].indexOf('{');
                let coalitionEnd = this.getClosingBraceIndex(missionText, coalitionStart);
                let coalitionBlock = missionText.substring(coalitionStart, coalitionEnd + 1);
                
                let neutralsMatch = coalitionBlock.match(/\["neutrals"\]\s*=\s*\{/);
                
                if (neutralsMatch) {
                    let neutralsStart = neutralsMatch.index + neutralsMatch[0].indexOf('{');
                    let neutralsEnd = this.getClosingBraceIndex(coalitionBlock, neutralsStart);
                    let neutralsBlock = coalitionBlock.substring(neutralsStart, neutralsEnd + 1);
                    
                    let countryMatch = neutralsBlock.match(/\["country"\]\s*=\s*\{/);
                    if (countryMatch) {
                        let countryBlockStart = countryMatch.index + countryMatch[0].indexOf('{');
                        
                        let firstCountryMatch = neutralsBlock.substring(countryBlockStart).match(/\[1\]\s*=\s*\{/);
                        if (!firstCountryMatch) {
                            firstCountryMatch = neutralsBlock.substring(countryBlockStart).match(/\[\d+\]\s*=\s*\{/);
                        }
                        
                        if (firstCountryMatch) {
                            let firstCountryStart = countryBlockStart + firstCountryMatch.index + firstCountryMatch[0].indexOf('{');
                            let firstCountryEnd = this.getClosingBraceIndex(neutralsBlock, firstCountryStart);
                            let firstCountryBlock = neutralsBlock.substring(firstCountryStart, firstCountryEnd + 1);
                            
                            let planeMatch = firstCountryBlock.match(/\["plane"\]\s*=\s*\{/);
                            
                            if (planeMatch) {
                                let planeStart = planeMatch.index + planeMatch[0].indexOf('{');
                                let groupMatch = firstCountryBlock.substring(planeStart).match(/\["group"\]\s*=\s*\{/);
                                
                                if (groupMatch) {
                                    let groupStart = planeStart + groupMatch.index + groupMatch[0].indexOf('{');
                                    let groupEnd = this.getClosingBraceIndex(firstCountryBlock, groupStart);
                                    let groupBlockStr = firstCountryBlock.substring(groupStart, groupEnd + 1);
                                    
                                    let existingGroups = groupBlockStr.match(/\["groupId"\]/g);
                                    let nextIndex = existingGroups ? existingGroups.length + 1 : 1;
                                    
                                    let appendedGroups = "";
                                    templatesToInject.forEach(tpl => { appendedGroups += `\n\t\t\t\t\t\t\t\t[${nextIndex++}] = ${tpl},`; });
                                    
                                    // Comma-safety check before appending to the group block
                                    let beforeGroupEnd = firstCountryBlock.substring(0, groupEnd);
                                    let trimmed = beforeGroupEnd.trimEnd();
                                    if (!trimmed.endsWith(',') && !trimmed.endsWith('{')) beforeGroupEnd = trimmed + ",\n\t\t\t\t\t\t\t\t";
                                    
                                    firstCountryBlock = beforeGroupEnd + appendedGroups + "\n\t\t\t\t\t\t\t" + firstCountryBlock.substring(groupEnd);
                                } else {
                                    let appendedGroups = "";
                                    let nextIndex = 1;
                                    templatesToInject.forEach(tpl => { appendedGroups += `\n\t\t\t\t\t\t\t\t[${nextIndex++}] = ${tpl},`; });
                                    
                                    let planeEnd = this.getClosingBraceIndex(firstCountryBlock, planeStart);
                                    let newGroupBlock = `\n\t\t\t\t\t\t\t["group"] = {${appendedGroups}\n\t\t\t\t\t\t\t},\n\t\t\t\t\t\t`;
                                    
                                    // Comma-safety check
                                    let beforePlaneEnd = firstCountryBlock.substring(0, planeEnd);
                                    let trimPlane = beforePlaneEnd.trimEnd();
                                    if (!trimPlane.endsWith(',') && !trimPlane.endsWith('{')) beforePlaneEnd = trimPlane + ",";
                                    
                                    firstCountryBlock = beforePlaneEnd + newGroupBlock + firstCountryBlock.substring(planeEnd);
                                }
                            } else {
                                let appendedGroups = "";
                                let nextIndex = 1;
                                templatesToInject.forEach(tpl => { appendedGroups += `\n\t\t\t\t\t\t\t\t[${nextIndex++}] = ${tpl},`; });
                                
                                let newPlaneBlock = `\n\t\t\t\t\t\t["plane"] = {\n\t\t\t\t\t\t\t["group"] = {${appendedGroups}\n\t\t\t\t\t\t\t},\n\t\t\t\t\t\t},\n\t\t\t\t\t`;
                                
                                // Comma-safety check
                                let countryEnd = firstCountryBlock.lastIndexOf('}');
                                let beforeCountryEnd = firstCountryBlock.substring(0, countryEnd);
                                let trimCountry = beforeCountryEnd.trimEnd();
                                if (!trimCountry.endsWith(',') && !trimCountry.endsWith('{')) beforeCountryEnd = trimCountry + ",";
                                
                                firstCountryBlock = beforeCountryEnd + newPlaneBlock + "}";
                            }
                            
                            neutralsBlock = neutralsBlock.substring(0, firstCountryStart) + firstCountryBlock + neutralsBlock.substring(firstCountryEnd + 1);
                        } else {
                            // Country block is totally empty
                            let appendedGroups = "";
                            let nextIndex = 1;
                            templatesToInject.forEach(tpl => { appendedGroups += `\n\t\t\t\t\t\t\t\t[${nextIndex++}] = ${tpl},`; });
                            
                            let newCountryBlock = `\n\t\t\t\t\t[1] = {\n\t\t\t\t\t\t["id"] = 82,\n\t\t\t\t\t\t["name"] = "UN",\n\t\t\t\t\t\t["plane"] = {\n\t\t\t\t\t\t\t["group"] = {${appendedGroups}\n\t\t\t\t\t\t\t},\n\t\t\t\t\t\t},\n\t\t\t\t\t},\n\t\t\t\t`;
                            neutralsBlock = neutralsBlock.substring(0, countryBlockStart + 1) + newCountryBlock + neutralsBlock.substring(countryBlockStart + 1);
                        }
                    } else {
                        // Entire "country" block missing
                        let appendedGroups = "";
                        let nextIndex = 1;
                        templatesToInject.forEach(tpl => { appendedGroups += `\n\t\t\t\t\t\t\t\t[${nextIndex++}] = ${tpl},`; });
                        
                        let newCountryBlock = `\n\t\t\t["country"] = {\n\t\t\t\t[1] = {\n\t\t\t\t\t["id"] = 82,\n\t\t\t\t\t["name"] = "UN",\n\t\t\t\t\t["plane"] = {\n\t\t\t\t\t\t["group"] = {${appendedGroups}\n\t\t\t\t\t\t},\n\t\t\t\t\t},\n\t\t\t\t},\n\t\t\t},\n\t\t`;
                        
                        // Comma-safety check
                        let neutralsEndIdx = neutralsBlock.lastIndexOf('}');
                        let beforeNeutralsEnd = neutralsBlock.substring(0, neutralsEndIdx);
                        let trimNeutrals = beforeNeutralsEnd.trimEnd();
                        if (!trimNeutrals.endsWith(',') && !trimNeutrals.endsWith('{')) beforeNeutralsEnd = trimNeutrals + ",";
                        
                        neutralsBlock = beforeNeutralsEnd + newCountryBlock + "}";
                    }
                    
                    coalitionBlock = coalitionBlock.substring(0, neutralsStart) + neutralsBlock + coalitionBlock.substring(neutralsEnd + 1);
                } else {
                    let appendedGroups = "";
                    let nextIndex = 1;
                    templatesToInject.forEach(tpl => { appendedGroups += `\n\t\t\t\t\t\t\t\t[${nextIndex++}] = ${tpl},`; });
                    
                    let newNeutralsBlock = `\n\t\t["neutrals"] = {\n\t\t\t["name"] = "neutrals",\n\t\t\t["country"] = {\n\t\t\t\t[1] = {\n\t\t\t\t\t["id"] = 82,\n\t\t\t\t\t["name"] = "UN",\n\t\t\t\t\t["plane"] = {\n\t\t\t\t\t\t["group"] = {${appendedGroups}\n\t\t\t\t\t\t},\n\t\t\t\t\t},\n\t\t\t\t},\n\t\t\t},\n\t\t},`;
                    coalitionBlock = coalitionBlock.substring(0, 1) + newNeutralsBlock + coalitionBlock.substring(1);
                }
                
                missionText = missionText.substring(0, coalitionStart) + coalitionBlock + missionText.substring(coalitionEnd + 1);
            }
        }

        // =====================================================================
        // 8. Inject CSAR Templates
        // =====================================================================
        if (settings && settings.moduleCsar) {
            missionText = this.injectCsarTemplates(missionText);
        }

        // =====================================================================
        // 9. Delete old files and write updated files back into the ZIP
        // =====================================================================
        if (zip.getEntry('mission')) zip.deleteFile('mission');
        if (zip.getEntry('l10n/DEFAULT/dictionary')) zip.deleteFile('l10n/DEFAULT/dictionary');
        if (zip.getEntry('l10n/DEFAULT/mapResource')) zip.deleteFile('l10n/DEFAULT/mapResource');

        zip.addFile('mission', Buffer.from(missionText, 'utf8'));
        zip.addFile('l10n/DEFAULT/dictionary', Buffer.from(dictText, 'utf8')); 
        zip.addFile('l10n/DEFAULT/mapResource', Buffer.from(mapResText, 'utf8')); 
        
        zip.writeZip(outputPath);
        logger.info(`Successfully appended trigger at position [${nIdx}] and patched dictionaries.`);
        return outputPath;
    }

        // ---------------------------------------------------------------------
    // Lua table helpers (string-aware, return INCLUSIVE indexes of braces)
    // ---------------------------------------------------------------------

    // text[i] is the opening quote; returns the index right after the closing quote
    skipString(text, i) {
        let j = i + 1;
        while (j < text.length) {
            if (text[j] === '\\') j += 2;
            else if (text[j] === '"') return j + 1;
            else j++;
        }
        return text.length;
    }

    // text[open] === '{'; returns the index of the matching '}' (or -1)
    closingBrace(text, open) {
        let depth = 0;
        for (let i = open; i < text.length; i++) {
            const ch = text[i];
            if (ch === '"') { i = this.skipString(text, i) - 1; continue; }
            if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) return i; }
        }
        return -1;
    }

    // Finds ["key"] = { ... } among the DIRECT children of the table [parentOpen, parentClose]
    findChildTable(text, parentOpen, parentClose, key) {
        const needle = `["${key}"]`;
        let i = parentOpen + 1;
        while (i < parentClose) {
            const ch = text[i];
            if (ch === '"') { i = this.skipString(text, i); continue; }
            if (ch === '{') { const c = this.closingBrace(text, i); if (c === -1) return null; i = c + 1; continue; }
            if (ch === '[' && text.startsWith(needle, i)) {
                const m = /^\s*=\s*\{/.exec(text.substring(i + needle.length, i + needle.length + 40));
                if (m) {
                    const open = i + needle.length + m[0].length - 1;
                    const close = this.closingBrace(text, open);
                    return close === -1 ? null : { open, close };
                }
            }
            i++;
        }
        return null;
    }

    // Direct child tables of a table, with their numeric index ([n] = {...}) when present
    childTables(text, parentOpen, parentClose) {
        const res = [];
        let i = parentOpen + 1, last = i;
        while (i < parentClose) {
            const ch = text[i];
            if (ch === '"') { i = this.skipString(text, i); continue; }
            if (ch === '{') {
                const close = this.closingBrace(text, i);
                if (close === -1) break;
                const m = text.substring(last, i).match(/\[(\d+)\]\s*=\s*$/);
                res.push({ open: i, close, index: m ? parseInt(m[1], 10) : null });
                i = close + 1; last = i;
                continue;
            }
            i++;
        }
        return res;
    }

    // Inserts entry text at the end of the table whose '}' is at `close`, fixing the trailing comma
    appendEntries(text, close, entries) {
        let k = close - 1;
        while (k >= 0 && /\s/.test(text[k])) k--;
        const needsComma = text[k] !== ',' && text[k] !== '{';
        return text.substring(0, k + 1) + (needsComma ? ',' : '') + entries + text.substring(k + 1);
    }

    // Sets the ["name"] field that is a direct child of the table `tbl` (a string starting with '{')
    setTopLevelName(tbl, newName) {
        const needle = '["name"]';
        const safe = String(newName).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        let depth = 0;
        for (let i = 0; i < tbl.length; i++) {
            const ch = tbl[i];
            if (ch === '"') { i = this.skipString(tbl, i) - 1; continue; }
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            else if (ch === '[' && depth === 1 && tbl.startsWith(needle, i)) {
                const m = /^\["name"\]\s*=\s*"(?:[^"\\]|\\.)*"/.exec(tbl.substring(i));
                if (m) return tbl.substring(0, i) + `["name"] = "${safe}"` + tbl.substring(i + m[0].length);
            }
        }
        return tbl;
    }

    // Renames a raw group template: group name, every unit ("<group><infix><n>") and blanks waypoint names
    renameTemplate(rawTemplate, groupName, unitInfix) {
        let tpl = rawTemplate.trim();

        // Waypoint names are DictKeys of the master mission: blank them (back to front)
        const route = this.findChildTable(tpl, 0, tpl.length - 1, 'route');
        const points = route && this.findChildTable(tpl, route.open, route.close, 'points');
        if (points) {
            const wps = this.childTables(tpl, points.open, points.close);
            for (let n = wps.length - 1; n >= 0; n--) {
                const w = wps[n];
                const fixed = this.setTopLevelName(tpl.substring(w.open, w.close + 1), '');
                tpl = tpl.substring(0, w.open) + fixed + tpl.substring(w.close + 1);
            }
        }

        // Unit names (back to front)
        const unitsTbl = this.findChildTable(tpl, 0, tpl.length - 1, 'units');
        if (unitsTbl) {
            const units = this.childTables(tpl, unitsTbl.open, unitsTbl.close);
            for (let n = units.length - 1; n >= 0; n--) {
                const u = units[n];
                const fixed = this.setTopLevelName(tpl.substring(u.open, u.close + 1), `${groupName}${unitInfix}${n + 1}`);
                tpl = tpl.substring(0, u.open) + fixed + tpl.substring(u.close + 1);
            }
        }

        // Group name: direct child of the group table
        return this.setTopLevelName(tpl, groupName);
    }

    // ---------------------------------------------------------------------
    // CSAR templates
    // ---------------------------------------------------------------------

    getCsarJsonPath() {
        // mizPatcher.js lives in /utils, the csar folder is in the project root
        const dir = app.isPackaged ? path.join(process.resourcesPath, 'csar') : path.join(__dirname, '..', 'csar');
        return path.join(dir, 'csar.json');
    }

    // Makes a raw group table from the master .miz usable in the target mission
    prepareCsarGroup(rawTemplate, expectedName, ids) {
        let tpl = rawTemplate.trim();
        if (tpl[0] !== '{' || tpl[tpl.length - 1] !== '}') return null;

        // New unique IDs
        ids.group++;
        tpl = tpl.replace(/\["groupId"\]\s*=\s*\d+/g, `["groupId"] = ${ids.group}`);
        tpl = tpl.replace(/\["unitId"\]\s*=\s*\d+/g, () => `["unitId"] = ${++ids.unit}`);
        tpl = this.renameTemplate(tpl, expectedName, ' Unit ');

        // Late activation (replace existing flag, otherwise add it)
        if (/\["lateActivation"\]\s*=\s*(true|false)/.test(tpl)) {
            tpl = tpl.replace(/\["lateActivation"\]\s*=\s*(true|false)/, '["lateActivation"] = true');
        } else {
            tpl = '{\n["lateActivation"] = true,' + tpl.substring(1);
        }
        return tpl;
    }

    // Appends group tables to coalition[side].country[1][category].group
    injectGroupsIntoCoalition(text, sideName, category, groups, fallbackCountry) {
        if (!groups || groups.length === 0) return text;

        const rootOpen = text.indexOf('{');
        const rootClose = this.closingBrace(text, rootOpen);
        const coalition = this.findChildTable(text, rootOpen, rootClose, 'coalition');
        const side = coalition && this.findChildTable(text, coalition.open, coalition.close, sideName);
        if (!side) {
            logger.warn(`CSAR: coalition table "${sideName}" not found in mission file.`);
            return text;
        }

        const entries = (start) => groups.map((g, i) => `\n[${start + i}] = ${g},`).join('');
        const countryEntry = `\n[1] = {\n["id"] = ${fallbackCountry.id},\n["name"] = "${fallbackCountry.name}",\n` +
                             `["${category}"] = {\n["group"] = {${entries(1)}\n},\n},\n},`;

        const country = this.findChildTable(text, side.open, side.close, 'country');
        if (!country) return this.appendEntries(text, side.close, `\n["country"] = {${countryEntry}\n},`);

        const countries = this.childTables(text, country.open, country.close);
        if (countries.length === 0) return this.appendEntries(text, country.close, countryEntry);

        const first = countries[0];
        const cat = this.findChildTable(text, first.open, first.close, category);
        if (!cat) return this.appendEntries(text, first.close, `\n["${category}"] = {\n["group"] = {${entries(1)}\n},\n},`);

        const grp = this.findChildTable(text, cat.open, cat.close, 'group');
        if (!grp) return this.appendEntries(text, cat.close, `\n["group"] = {${entries(1)}\n},`);

        const existing = this.childTables(text, grp.open, grp.close);
        const next = existing.reduce((m, c) => Math.max(m, c.index || 0), 0) + 1;
        return this.appendEntries(text, grp.close, entries(next));
    }

    injectCsarTemplates(missionText) {
        const csarFile = this.getCsarJsonPath();
        if (!fs.existsSync(csarFile)) {
            logger.warn(`CSAR: catalog not found at ${csarFile}. Use Menu > Extract CSAR Templates first.`);
            return missionText;
        }

        let csarData;
        try {
            csarData = JSON.parse(fs.readFileSync(csarFile, 'utf8'));
        } catch (err) {
            logger.error(`CSAR: could not parse ${csarFile}: ${err.message}`);
            return missionText;
        }

        // Highest IDs currently in the mission (includes anything injected before this step)
        const ids = { group: 0, unit: 0 };
        let m;
        const gRe = /\["groupId"\]\s*=\s*(\d+)/g;
        while ((m = gRe.exec(missionText)) !== null) ids.group = Math.max(ids.group, parseInt(m[1], 10));
        const uRe = /\["unitId"\]\s*=\s*(\d+)/g;
        while ((m = uRe.exec(missionText)) !== null) ids.unit = Math.max(ids.unit, parseInt(m[1], 10));

        const defs = [
            { side: 'blue', name: 'BLUE DOWNED PILOT' },
            { side: 'blue', name: 'BLUE LIFE RAFT' },
            { side: 'red',  name: 'RED DOWNED PILOT' },
            { side: 'red',  name: 'RED LIFE RAFT' }
        ];
        const plan = { blue: { vehicle: [], ship: [] }, red: { vehicle: [], ship: [] } };

        for (const def of defs) {
            const entry = csarData[def.name];
            if (!entry) { logger.warn(`CSAR: "${def.name}" missing in csar.json, skipped.`); continue; }

            // Don't duplicate if the mission already has a group with that exact name
            if (missionText.includes(`["name"] = "${def.name}"`)) {
                logger.info(`CSAR: "${def.name}" already exists in the mission, skipped.`);
                continue;
            }

            const raw = (typeof entry === 'string') ? entry : entry.template;

            // Default to vehicle: both the pilot and the raft (cmp_liferaft_flare) are ground-category units.
            // Only trust an explicit category written by the extractor.
            const category = (typeof entry === 'object' && entry.category) || 'vehicle';

            const group = this.prepareCsarGroup(raw || '', def.name, ids);
            if (!group) { logger.warn(`CSAR: template "${def.name}" is not a valid Lua table, skipped.`); continue; }
            plan[def.side][category].push(group);
        }

        const fallback = { blue: { id: 2, name: 'USA' }, red: { id: 0, name: 'Russia' } };
        for (const side of ['blue', 'red']) {
            for (const category of ['vehicle', 'ship']) {
                const n = plan[side][category].length;
                if (n === 0) continue;
                missionText = this.injectGroupsIntoCoalition(missionText, side, category, plan[side][category], fallback[side]);
                logger.info(`CSAR: injected ${n} ${side} ${category} group(s).`);
            }
        }
        return missionText;
    }
}

module.exports = MizPatcher;