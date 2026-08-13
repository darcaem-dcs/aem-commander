const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Obtains the local IPv4 address of the machine.
     */
    getLocalIp: () => ipcRenderer.invoke('get-local-ip'),
	
	/**
     * Opens a file dialog to select the Vertex AI JSON key file.
     */
    selectJsonFile: () => ipcRenderer.invoke('select-json-file'),

    /**
     * Triggers the folder selection dialog and starts the monitoring 
     * process immediately using the provided Auth details.
     */
    selectAndStart: (authMethod, authCredential, modelName, commanderSide, instructionsRed, instructionsBlue, intervalTime, aggRed, aggBlue, enableEscalation, bmRed, bmBlue, unitProfiles) => 
    ipcRenderer.invoke('select-and-start', authMethod, authCredential, modelName, commanderSide, instructionsRed, instructionsBlue, intervalTime, aggRed, aggBlue, enableEscalation, bmRed, bmBlue, unitProfiles),

    /**
     * Stops the active monitoring interval in the main process.
     */
    stopMonitor: () => ipcRenderer.invoke('stop-monitor'),

    /**
     * Listens for log updates sent from the main process to be 
     * displayed in the UI log console.
     */
    onLogMessage: (callback) => ipcRenderer.on('log-message', (event, message, type) => callback(message, type)),
	
	/**
     * Listens for battlefield state updates to draw on the Leaflet map
     */
    onUpdateMap: (callback) => ipcRenderer.on('update-map', (event, state) => callback(state)),
	
	/**
     * Obtains the application version from package.json
     */
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
	
	/**
     * Listens for backend notifications when the persistence file is written to disk.
     */
    onPersistenceUpdated: (callback) => ipcRenderer.on('persistence-updated', (event, timestamp) => callback(timestamp)),
	
	/**
     * Persistence file handlers
     */
    selectPersistenceFile: () => ipcRenderer.invoke('select-persistence-file'),
    createNewPersistenceFile: (missionName) => ipcRenderer.invoke('create-new-persistence-file', missionName)
});