const logger = require('./log.js');

class CoalitionTerritory {
	
    constructor(coalition) {
        this.border = null;
        this.coalition = coalition;
    }
	
	updateBorder(dataArray) {
		this.border = dataArray;
	}

    // The tool we expose to Gemini
    isTargetInFriendlyTerritory(targetLat, targetLon) {
        if (!this.border || this.border.length === 0) {
            return { error: "Border data not loaded or unavailable." };
        }

        // Ray-casting algorithm
        let x = targetLon, y = targetLat;
        let inside = false;

        for (let i = 0, j = this.border.length - 1; i < this.border.length; j = i++) {
            // Note: Your JSON uses 'long', not 'lon'
            let xi = this.border[i].long, yi = this.border[i].lat;
            let xj = this.border[j].long, yj = this.border[j].lat;

            let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }

        return {
            target_lat: targetLat,
            target_lon: targetLon,
            is_friendly_territory: inside
        };
    }
}

module.exports = CoalitionTerritory;