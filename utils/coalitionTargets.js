class Target {
	
	constructor(name, priority, type, lat, lon, assetsInvolved) {
		this.name = name;
		this.priority = priority;
		this.type = type;
		this.lat = lat;
		this.lon = lon;
		this.assetsInvolved = assetsInvolved ? assetsInvolved : [];
	}
	
}

class CoalitionTargets {
	
	constructor(coalition) {
		this.targets = null;
		this.coalition = coalition;
	}
	
	updateGoals(dataArray) {
        this.targets = dataArray.map(item => new Target(
            item.id,
            parseFloat(item.priority || 1),
            item.type,
            item.target_area.lat,
            item.target_area.long,
            item.assetsInvolved || null
        ));
    }
	
	addTarget(name, priority, type, lat, lon, assets) {
		if (!this.targets) this.targets = [];
		this.targets.push(new Target(
			name, priority, type, lat, lon, assets));
	}
	
	removeTarget(name) {
		if (!this.targets || this.targets.length == 0) return null;
		const index = this.targets.findIndex(target => target.name === name);
		if (index != -1) {
			return this.targets.splice(index, 1)[0];
		}
		return null;
	}
	
	updateTarget(name, priority, type, lat, lon, assets) {
		if (!this.targets) {
			this.targets = [];
			this.targets.push(new Target(
				name, priority, type, lat, lon, assets));
		} else {
			const index = this.targets.findIndex(target => target.name === name);
			if (index != -1) {
				this.targets[index].priority = priority;
				this.targets[index].type = type;
				this.targets[index].lat = lat;
				this.targets[index].lon = lon;
				this.targets[index].assets = assets;
			} else {
				this.targets.push(new Target(
					name, priority, type, lat, lon, assets));
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

		// Take the requested amount
		const topTargets = sortedTargets.slice(0, count);

		// Map to a clean JSON object for Gemini
		return {
			goals: topTargets.map(t => ({
				goal_id: t.name,
				type: t.type,
				priority: t.priority,
				lat: t.lat,
				lon: t.lon
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
				lon: t.lon
			}))
		};
	}
	
}

module.exports = CoalitionTargets;