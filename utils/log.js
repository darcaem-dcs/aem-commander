const fs = require('fs');
const path = require('path');
const { app } = require('electron'); // Añadimos la importación de electron

class Log {
    constructor(filename = 'aem_commander.log') {
        // Obtenemos la ruta segura oficial para logs del sistema operativo
        const logDir = app.getPath('logs'); 
        
        // Nos aseguramos de que el directorio de logs exista
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        this.logFile = path.join(logDir, filename);
        
        // Opcional: Imprime la ruta en consola para que sepas dónde está cuando programes
        console.log(`Writing logs to: ${this.logFile}`);
    }

    info(...args) {
        this._write('INFO', ...args);
        console.log(...args); 
    }

    error(...args) {
        this._write('ERROR', ...args);
        console.error(...args); 
    }

    _write(level, ...args) {
        const timestamp = new Date().toISOString();
        const message = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg) : arg
        ).join(' ');
        
        const logLine = `[${timestamp}] [${level}] ${message}\n`;
        
        try {
            fs.appendFileSync(this.logFile, logLine, 'utf8');
        } catch (err) {
            console.error("Critical: Cannot write to log file", err);
        }
    }
}

module.exports = Log;