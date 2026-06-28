class ActiveGroup {

	constructor(name, type, category, mission, lat, lon, airbase, nUnits, heading) {
		this.name = name;
		this.type = type;
		this.category = category;
		this.mission = mission;
		this.lat = lat;
		this.lon = lon;
		this.airbase = airbase;
		this.nUnits = nUnits;
		this.heading = heading;
	}
	
	toJson() {
		return {
			name: this.name,
			type: this.type,
			category: this.category,
			mission: this.mission,
			lat: this.lat,
			lon: this.lon,
			airbase: this.airbase,
			nUnits: this.nUnits,
			heading: this.heading
		};
	}

}

class AvailableUnit {
	
	constructor(name, type, category, missions, lat, lon, airbase) {
		this.name = name;
		this.type = type;
		this.category = category;
		this.missions = missions;
		this.lat = lat;
		this.lon = lon;
		this.airbase = airbase;
	}
	
	toJson() {
		return {
			name: this.name,
			type: this.type,
			category: this.category,
			missions: this.missions,
			lat: this.lat,
			lon: this.lon,
			airbase: this.airbase
		};
	}
	
}

class EnemyDetected {

	constructor(name, type, category, lat, lon, threat, heading, threat_score) {
		this.name = name;
		this.type = type;
		this.category = category;
		this.lat = lat;
		this.lon = lon;
		this.threat = threat;
		this.heading = heading;
		this.threat_score = threat_score || 0;
	}

}

class CoalitionArmedForces {
	
	constructor(coalition, instructions) {
		this.availableUnits = null;
		this.activeGroups = null;
		this.enemyGroups = null;
		this.coalition = coalition;
		this.model = null;
		this.session = null;
		this.instructions = instructions || "Operate using standard doctrine.";
		this.consumedStatics = new Set();
	}
	
	updateActiveGroups(dataArray) {
        this.activeGroups = dataArray.map(item => new ActiveGroup(
            item.id, item.type, item.category, item.mission, 
            item.location.lat, item.location.long, item.airbase, item.count, item.heading
        ));
    }

    updateAvailableUnits(dataArray) {
        this.availableUnits = [];
        dataArray.forEach(group => {
            group.static_ids.forEach(staticId => {
                if (!this.consumedStatics.has(staticId)) {
                    this.availableUnits.push(new AvailableUnit(
                        staticId, group.type, group.category, group.mission, 
                        group.location.lat, group.location.long, group.airbase
                    ));
                }
            });
        });
    }

    updateISR(dataArray) {
        this.enemyGroups = dataArray.map(item => new EnemyDetected(
            item.id, item.type, item.category, 
            item.location.lat, item.location.long, item.threat, item.heading,
            item.threat_score || 0
        ));
    }
	
	addAvailableUnit(name, type, category, mission, lat, lon, airbase) {
		if (!this.availableUnits) this.availableUnits = [];
		this.availableUnits.push(new AvailableUnit(
			name, type, category, mission, lat, lon, airbase));
	}
	
	removeAvailableUnit(name) {
		this.consumedStatics.add(name);
		if (!this.availableUnits || this.availableUnits.length == 0) return false;
		const index = this.availableUnits.findIndex(unit => unit.name === name);
		if (index != -1) {
			this.availableUnits.splice(index, 1);
			return true;
		}
		return false;
	}
	
	addActiveGroup(name, type, category, mission, lat, lon, airbase, units, heading = 0) {
		if (!this.activeGroups) this.activeGroups = [];
		this.activeGroups.push(new ActiveGroup(
			name, type, category, mission, lat, lon, airbase, units, heading));
	}
	
	removeActiveGroup(name) {
		if (!this.activeGroups || this.activeGroups.length == 0) return false;
		const index = this.activeGroups.findIndex(group => group.name === name);
		if (index != -1) {
			this.activeGroups.splice(index, 1);
			return true;
		}
		return false;
	}
	
	/** @return still alive? */
	activeUnitDestroyed(groupName) {
		if (!this.activeGroups || this.activeGroups.length == 0) return false;
		const index = this.activeGroups.findIndex(group => group.name === groupName);
		if (index != -1) {
			if (this.activeGroups[index].nUnits > 1) {
				this.activeGroups[index].nUnits--;
				return true;
			} else {
				this.activeGroups.splice(index, 1);
				return false;
			}
		}
		return false;
	}
	
	addEnemy(name, type, category, lat, lon, threat) {
		if (!this.enemyGroups) this.enemyGroups = [];
		this.enemyGroups.push(new EnemyDetected(
			name, type, category, lat, lon, threat));
	}
	
	removeEnemy(name) {
		if (!this.enemyGroups || this.enemyGroups.length == 0) return false;
		const index = this.enemyGroups.findIndex(enemy => enemy.name === name);
		if (index != -1) {
			this.enemyGroups.splice(index, 1);
			return true;
		}
		return false;
	}
	
	updateEnemy(name, type, category, lat, lon, threat) {
		if (!this.enemyGroups) {
			this.enemyGroups = [];
			this.enemyGroups.push(new EnemyDetected(
				name, type, category, lat, lon, threat));
		} else {
			const index = this.enemyGroups.findIndex(enemy => enemy.name === name);
			if (index != -1) {
				this.enemyGroups[index].type = type;
				this.enemyGroups[index].category = category;
				this.enemyGroups[index].lat = lat;
				this.enemyGroups[index].lon = lon;
				this.enemyGroups[index].threat = threat;
			} else {
				this.enemyGroups.push(new EnemyDetected(
					name, type, category, lat, lon, threat));
			}
		}
	}
	
	getAvailableUnits() {
		return this.availableUnits.map(group => group.toJson());
	}
	
	getActiveGroups() {
		return this.activeGroups.map(group => group.toJson());
	}
	
	// Helper method using the Haversine formula to find distance between coordinates
	_calculateDistance(lat1, lon1, lat2, lon2) {
		const R = 6371; // Earth's radius in kilometers
		const dLat = (lat2 - lat1) * Math.PI / 180;
		const dLon = (lon2 - lon1) * Math.PI / 180;
		const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
				  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
				  Math.sin(dLon/2) * Math.sin(dLon/2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
		return R * c;
	}

	// The actual function we will expose to Gemini
	findClosestCapableGroup(missionType, targetLat, targetLon) {
		if (!this.availableUnits || this.availableUnits.length === 0) {
			return { error: "No available reserve units currently in the theater." };
		}

		let closestUnit = null;
		let minDistance = Infinity;

		for (const unit of this.availableUnits) {
			// Check if this unit's missions array contains the requested mission type (case-insensitive)
			const hasMission = unit.missions && unit.missions.some(m => m.toLowerCase() === missionType.toLowerCase());

			if (hasMission) {
				const distance = this._calculateDistance(unit.lat, unit.lon, targetLat, targetLon);
				if (distance < minDistance) {
					minDistance = distance;
					closestUnit = unit;
				}
			}
		}

		// Return a clean, simple JSON object back to the AI
		if (closestUnit) {
			const availableIds = this.availableUnits
				.filter(u => u.type === closestUnit.type && u.airbase === closestUnit.airbase && u.missions.some(m => m.toLowerCase() === missionType.toLowerCase()))
				.map(u => u.name);
			return {
				found: true,
				unit_type: closestUnit.type,
				airbase: closestUnit.airbase,
				distance_km: Math.round(minDistance),
				available_unit_ids: availableIds
			};
		} else {
			return { 
				found: false, 
				message: `No unit found with capability: ${missionType}` 
			};
		}
	}
	
	// Provides a summary of available reserves categorized by mission capability
	getTheaterReservesSummary() {
		if (!this.availableUnits || this.availableUnits.length === 0) {
			return { message: "No reserve units available." };
		}

		const summary = {};
		
		for (const unit of this.availableUnits) {
			if (unit.missions && Array.isArray(unit.missions)) {
				for (const mission of unit.missions) {
					// Normalize the mission string to uppercase (e.g., "cap" -> "CAP")
					const m = mission.toUpperCase();
					if (!summary[m]) {
						summary[m] = 0;
					}
					// Each element in availableUnits represents one taskable unit/group
					summary[m]++;
				}
			}
		}

		return {
			total_reserve_units: this.availableUnits.length,
			capabilities_summary: summary
		};
	}
	
	// Returns all currently active (deployed) groups performing a specific mission
	getActiveGroupsByMission(missionType) {
		if (!this.activeGroups || this.activeGroups.length === 0) {
			return { message: "No active groups currently deployed." };
		}

		// Filter ignoring case
		const filtered = this.activeGroups.filter(g => 
			g.mission && g.mission.some(m => m.toLowerCase() === missionType.toLowerCase())
		);

		if (filtered.length === 0) {
			return { message: `No active groups currently performing mission: ${missionType}` };
		}

		// Map to a clean, lightweight JSON object
		return {
			groups: filtered.map(g => ({
				group_id: g.name,
				type: g.type,
				category: g.category,
				lat: g.lat,
				lon: g.lon,
				unit_count: g.nUnits
			}))
		};
	}

	// Finds the closest deployed group of a specific mission type to a location
	getClosestActiveGroup(missionType, targetLat, targetLon) {
		if (!this.activeGroups || this.activeGroups.length === 0) {
			return { error: "No active groups currently deployed." };
		}

		let closestGroup = null;
		let minDistance = Infinity;

		for (const group of this.activeGroups) {
			const hasMission = group.mission && group.mission.some(m => m.toLowerCase() === missionType.toLowerCase());

			if (hasMission) {
				const distance = this._calculateDistance(group.lat, group.lon, targetLat, targetLon);
				if (distance < minDistance) {
					minDistance = distance;
					closestGroup = group;
				}
			}
		}

		if (closestGroup) {
			return {
				found: true,
				group_id: closestGroup.name,
				type: closestGroup.type,
				category: closestGroup.category,
				distance_km: Math.round(minDistance),
				lat: closestGroup.lat,
				lon: closestGroup.lon
			};
		} else {
			return { 
				found: false, 
				message: `No active deployed group found with mission: ${missionType}` 
			};
		}
	}
	
	// ISR: Finds enemy threats within a specific radius of a target location
	getEnemyThreatsNearLocation(targetLat, targetLon, radiusKm) {
		if (!this.enemyGroups || this.enemyGroups.length === 0) {
			return { message: "No enemy forces currently detected by ISR in the theater." };
		}

		const radius = radiusKm || 100; // Default to 100km if the AI doesn't specify
		const threats = [];

		for (const enemy of this.enemyGroups) {
			const distance = this._calculateDistance(enemy.lat, enemy.lon, targetLat, targetLon);
			if (distance <= radius) {
				threats.push({
					enemy_id: enemy.name,
					type: enemy.type,
					category: enemy.category,
					threat_class: enemy.threat,
					distance_km: Math.round(distance),
					lat: enemy.lat,
					lon: enemy.lon
				});
			}
		}

		// Sort threats by closest first
		threats.sort((a, b) => a.distance_km - b.distance_km);

		return {
			target_lat: targetLat,
			target_lon: targetLon,
			search_radius_km: radius,
			threats_found: threats.length,
			threats: threats
		};
	}

	// ISR: Retrieves all known enemy units of a specific threat class (e.g., 'SAM', 'CAP')
	getKnownEnemyThreatsByType(threatClass) {
		if (!this.enemyGroups || this.enemyGroups.length === 0) {
			return { message: "No enemy forces currently detected by ISR." };
		}

		const filtered = this.enemyGroups.filter(e => 
			e.threat && e.threat.toLowerCase() === threatClass.toLowerCase()
		);

		if (filtered.length === 0) {
			return { message: `No enemy units of threat class '${threatClass}' currently detected.` };
		}

		return {
			threat_class: threatClass,
			threats_found: filtered.length,
			threats: filtered.map(e => ({
				enemy_id: e.name,
				type: e.type,
				category: e.category,
				lat: e.lat,
				lon: e.lon
			}))
		};
	}
	
}

module.exports = CoalitionArmedForces;