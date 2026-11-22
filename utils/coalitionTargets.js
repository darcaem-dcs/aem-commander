const logger = require('./log.js');

class Target {
	constructor(name, priority, type, lat, lon, assetsInvolved, peacetime = false, props = {}) {
		this.name = name;
		this.priority = priority;
		this.type = type;
		this.lat = lat;
		this.lon = lon;
		this.assetsInvolved = assetsInvolved ? assetsInvolved : [];
		this.peacetime = peacetime;
		this.props = props || {};     // extra zone properties (bm_count, ...) and plan props
		this.requires = [];           // set by MissionPlan.refreshLocks
		this.blockedBy = [];
		this.locked = false;
	}
}

class CoalitionTargets {
	constructor(coalition) {
		this.targets = null;
		this.coalition = coalition;
	}
	
	updateGoals(dataArray) {
		const runtime = (this.targets || []).filter(t => t.type === 'csar' || t.type === 'enemy-csar');
		this.targets = dataArray.map(item => {
			const { id, target_area, ...props } = item;
			return new Target(
				id,
				parseFloat(item.priority || 1),
				item.type,
				target_area.lat,
				target_area.long,
				item.assetsInvolved || null,
				// DCS Lua might send it as a string "true" or a boolean true
				item.peacetime === 'true' || item.peacetime === true,
				props
			);
		});
		this.targets.push(...runtime);
	}
	
	addTarget(name, priority, type, lat, lon, assets, peacetime = false, props = {}) {
		if (!this.targets) this.targets = [];
		this.targets.push(new Target(name, priority, type, lat, lon, assets, peacetime, props));
	}
	
	removeTarget(name) {
		if (!this.targets || this.targets.length == 0) return null;
		const index = this.targets.findIndex(target => target.name === name);
		if (index != -1) {
			return this.targets.splice(index, 1)[0];
		}
		return null;
	}
	
	updateTarget(name, priority, type, lat, lon, assets, peacetime = false) {
		if (!this.targets) {
			this.targets = [];
			this.targets.push(new Target(name, priority, type, lat, lon, assets, peacetime));
		} else {
			const index = this.targets.findIndex(target => target.name === name);
			if (index != -1) {
				this.targets[index].priority = priority;
				this.targets[index].type = type;
				this.targets[index].lat = lat;
				this.targets[index].lon = lon;
				this.targets[index].assets = assets;
				this.targets[index].peacetime = peacetime;
			} else {
				this.targets.push(new Target(name, priority, type, lat, lon, assets, peacetime));
			}
		}
	}
	
	// Returns the top N highest priority goals
	getTopPriorityGoals(count) {
		if (!this.targets || this.targets.length === 0) {
			return { message: "No active goals at this time." };
		}

		// Sort by priority descending (highest first)
		const sortedTargets = [...this.targets].sort((a, b) => b.priority - a.priority);
		const topTargets = sortedTargets.slice(0, count);

		// Map to a clean JSON object for Gemini, NOW INCLUDING PEACETIME
		return {
			goals: topTargets.map(t => ({
				goal_id: t.name,
				type: t.type,
				priority: t.priority,
				lat: t.lat,
				lon: t.lon,
				peacetime_allowed: t.peacetime
			}))
		};
	}

	// Returns all goals of a specific type (e.g., "strike")
	getGoalsByType(missionType) {
		if (!this.targets || this.targets.length === 0) {
			return { message: "No active goals at this time." };
		}

		// Filter ignoring case
		const filtered = this.targets.filter(t => t.type.toLowerCase() === missionType.toLowerCase());

		if (filtered.length === 0) {
			return { message: `No active goals of type: ${missionType}` };
		}

		return {
			goals: filtered.map(t => ({
				goal_id: t.name,
				type: t.type,
				priority: t.priority,
				lat: t.lat,
				lon: t.lon,
				peacetime_allowed: t.peacetime
			}))
		};
	}
}

module.exports = CoalitionTargets;