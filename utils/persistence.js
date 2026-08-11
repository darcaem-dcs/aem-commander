const fs = require('fs');
const path = require('path');

class PersistenceManager {
    constructor() {
        this.currentFile = null;
        this.state = { 
            units: {}, 
            csar: {},
            mission_info: {},
            strategic_weapons: {
                ballistic_missiles: {
                    red: 0,
                    blue: 0
                }
            }
        };
    }

    loadState(filePath) {
        if (fs.existsSync(filePath)) {
            try {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                const parsedState = JSON.parse(fileContent);
                
                // Mezclamos el estado guardado con nuestra estructura base para evitar
                // que falten nodos (como strategic_weapons) si cargamos un archivo antiguo.
                this.state = { ...this.state, ...parsedState };
                
                // Asegurar que el nodo de armas estratégicas existe incluso en saves antiguos
                if (!this.state.strategic_weapons) {
                    this.state.strategic_weapons = { ballistic_missiles: { red: 0, blue: 0 } };
                }
                
                this.currentFile = filePath;
                return true;
            } catch (e) {
                logger.error("Error reading persistence file:", e);
                return false;
            }
        }
        return false;
    }

    saveState() {
        if (this.currentFile) {
            this.state.mission_info.updated_at = new Date().toISOString();
            fs.writeFileSync(this.currentFile, JSON.stringify(this.state, null, 2));
        }
    }

    createNewState(filePath, missionName) {
        this.currentFile = filePath;
        this.state.mission_info = {
            mission_name: missionName,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        this.saveState();
    }

    /** Ballistic missiles */

    setBallisticMissiles(redCount, blueCount) {
        if (!this.state.strategic_weapons) {
            this.state.strategic_weapons = { ballistic_missiles: { red: 0, blue: 0 } };
        }
        this.state.strategic_weapons.ballistic_missiles.red = redCount;
        this.state.strategic_weapons.ballistic_missiles.blue = blueCount;
        this.saveState();
    }

    getBallisticMissileCount(side) {
        return this.state.strategic_weapons?.ballistic_missiles?.[side] || 0;
    }

    consumeBallisticMissile(side, amount = 1) {
        if (this.state.strategic_weapons.ballistic_missiles[side] >= amount) {
            this.state.strategic_weapons.ballistic_missiles[side] -= amount;
            this.saveState();
            return true;
        }
        return false;
    }

    destroyBallisticMissiles(side, amount) {
        if (!this.state.strategic_weapons) return 0;
        
        let currentCount = this.state.strategic_weapons.ballistic_missiles[side] || 0;
        let lostCount = Math.min(currentCount, amount); // Resta como máximo lo que nos quede
        
        this.state.strategic_weapons.ballistic_missiles[side] -= lostCount;
        this.saveState();
        
        return lostCount; // Devolvemos la cantidad real que se ha perdido
    }

    /** Available and destroyed units */

    markUnitAsDestroyed(unitName) {
        if (!this.state.units) this.state.units = {};
        this.state.units[unitName] = { status: "destroyed" };
        this.saveState();
    }

    getDestroyedUnits() {
        return Object.keys(this.state.units).filter(
            name => this.state.units[name].status === "destroyed"
        );
    }
}

module.exports = PersistenceManager;