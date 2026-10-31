const logger = require('./log.js');

class SecondaryMissionManager {
    constructor(persistenceManager) {
        this.persistence = persistenceManager;
        this.activeMissions = [];
    }

    generateGreenPostureMission(side, availableBases) {
        const types = ['LOGISTICS', 'VIP_TRANSPORT', 'BORDER_RECON'];
        const selectedType = types[Math.floor(Math.random() * types.length)];
        
        const mission = {
            id: `SEC_${selectedType}_${Date.now()}`,
            type: selectedType,
            coalition: side.toUpperCase(),
            title: `${selectedType} en sector norte`,
            reward: selectedType === 'LOGISTICS' ? 'BALLISTIC_MISSILE' : 'THREAT_REDUCTION',
            assignedToHuman: false,
            assignedGroup: null
        };

        this.activeMissions.push(mission);
        return mission;
    }

    completeMission(missionId, side) {
        const index = this.activeMissions.findIndex(m => m.id === missionId);
        if (index !== -1) {
            const mission = this.activeMissions[index];
            if (mission.reward === 'BALLISTIC_MISSILE') {
                const currentBM = this.persistence.getBallisticMissileCount(side);
                this.persistence.setBallisticMissiles(
                    side === 'red' ? currentBM + 1 : this.persistence.getBallisticMissileCount('red'),
                    side === 'blue' ? currentBM + 1 : this.persistence.getBallisticMissileCount('blue')
                );
            }
            this.activeMissions.splice(index, 1);
            return mission;
        }
        return null;
    }
}