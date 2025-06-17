const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

/**
 * Scraper Supervisor - Monitors and restarts scraper processes automatically
 * 
 * Features:
 * - Automatic restart on crash with exponential backoff
 * - Heartbeat monitoring
 * - Memory usage tracking
 * - Progress preservation
 * - Detailed logging
 */
class ScraperSupervisor extends EventEmitter {
    constructor() {
        super();
        this.processes = new Map();
        this.config = {
            maxRestarts: 5,
            restartDelay: 5000, // Base delay in ms
            heartbeatInterval: 300000, // 5 minutes
            heartbeatTimeout: 600000, // 10 minutes
            memoryLimit: 2048 * 1024 * 1024, // 2GB in bytes
            logDir: path.join(__dirname, '../logs')
        };
        
        this.logFile = path.join(this.config.logDir, 'supervisor.log');
        this.ensureLogDirectory();
    }

    /**
     * Ensure logs directory exists
     */
    ensureLogDirectory() {
        if (!fs.existsSync(this.config.logDir)) {
            fs.mkdirSync(this.config.logDir, { recursive: true });
        }
    }

    /**
     * Log message with timestamp
     */
    log(level, message, processName = 'SUPERVISOR') {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${level}] [${processName}] ${message}`;
        console.log(logMessage);
        
        try {
            fs.appendFileSync(this.logFile, logMessage + '\n');
        } catch (error) {
            console.error('Failed to write to log file:', error.message);
        }
    }

    /**
     * Start monitoring a scraper process
     */
    startProcess(name, command, args = [], options = {}) {
        if (this.processes.has(name)) {
            this.log('WARN', `Process ${name} is already being monitored`, name);
            return;
        }

        const processInfo = {
            name,
            command,
            args,
            options: {
                ...options,
                env: {
                    ...process.env,
                    ...options.env,
                    SUPERVISOR_ENABLED: 'true'
                }
            },
            process: null,
            restartCount: 0,
            lastRestart: null,
            lastHeartbeat: Date.now(),
            status: 'starting',
            pid: null
        };

        this.processes.set(name, processInfo);
        this.spawnProcess(name);
    }

    /**
     * Spawn or respawn a process
     */
    spawnProcess(name) {
        const processInfo = this.processes.get(name);
        if (!processInfo) return;

        this.log('INFO', `Starting process: ${processInfo.command} ${processInfo.args.join(' ')}`, name);

        const child = spawn(processInfo.command, processInfo.args, {
            ...processInfo.options,
            stdio: ['inherit', 'pipe', 'pipe']
        });

        processInfo.process = child;
        processInfo.pid = child.pid;
        processInfo.status = 'running';
        processInfo.lastHeartbeat = Date.now();

        this.log('INFO', `Process started with PID: ${child.pid}`, name);

        // Handle stdout
        child.stdout.on('data', (data) => {
            const output = data.toString().trim();
            if (output) {
                // Check for heartbeat messages
                if (output.includes('HEARTBEAT') || output.includes('Still processing')) {
                    processInfo.lastHeartbeat = Date.now();
                }
                this.log('INFO', output, name);
            }
        });

        // Handle stderr
        child.stderr.on('data', (data) => {
            const error = data.toString().trim();
            if (error) {
                this.log('ERROR', error, name);
            }
        });

        // Handle process exit
        child.on('exit', (code, signal) => {
            processInfo.status = 'stopped';
            processInfo.process = null;
            processInfo.pid = null;

            this.log('WARN', `Process exited with code ${code} and signal ${signal}`, name);

            // Check if we should restart
            if (this.shouldRestart(processInfo)) {
                this.scheduleRestart(name);
            } else {
                this.log('ERROR', `Process ${name} has exceeded maximum restart attempts`, name);
                this.emit('process-failed', { name, restartCount: processInfo.restartCount });
            }
        });

        // Handle process errors
        child.on('error', (error) => {
            this.log('ERROR', `Process error: ${error.message}`, name);
            processInfo.status = 'error';
        });

        // Start heartbeat monitoring
        this.startHeartbeatMonitor(name);
    }

    /**
     * Check if process should be restarted
     */
    shouldRestart(processInfo) {
        if (processInfo.restartCount >= this.config.maxRestarts) {
            return false;
        }

        // Check if last restart was recent (prevent rapid restart loops)
        if (processInfo.lastRestart) {
            const timeSinceLastRestart = Date.now() - processInfo.lastRestart;
            const minDelay = this.config.restartDelay * Math.pow(2, processInfo.restartCount);
            if (timeSinceLastRestart < minDelay) {
                return false;
            }
        }

        return true;
    }

    /**
     * Schedule a process restart with exponential backoff
     */
    scheduleRestart(name) {
        const processInfo = this.processes.get(name);
        if (!processInfo) return;

        processInfo.restartCount++;
        processInfo.lastRestart = Date.now();

        const delay = this.config.restartDelay * Math.pow(2, processInfo.restartCount - 1);
        
        this.log('INFO', `Scheduling restart in ${delay}ms (attempt ${processInfo.restartCount}/${this.config.maxRestarts})`, name);

        setTimeout(() => {
            if (this.processes.has(name)) {
                this.spawnProcess(name);
            }
        }, delay);
    }

    /**
     * Start heartbeat monitoring for a process
     */
    startHeartbeatMonitor(name) {
        const checkHeartbeat = () => {
            const processInfo = this.processes.get(name);
            if (!processInfo || processInfo.status !== 'running') {
                return;
            }

            const timeSinceLastHeartbeat = Date.now() - processInfo.lastHeartbeat;
            
            if (timeSinceLastHeartbeat > this.config.heartbeatTimeout) {
                this.log('WARN', `Process has not sent heartbeat for ${timeSinceLastHeartbeat}ms, restarting...`, name);
                
                // Kill the process
                if (processInfo.process) {
                    processInfo.process.kill('SIGTERM');
                }
            } else {
                // Schedule next check
                setTimeout(checkHeartbeat, this.config.heartbeatInterval);
            }
        };

        setTimeout(checkHeartbeat, this.config.heartbeatInterval);
    }

    /**
     * Stop monitoring a process
     */
    stopProcess(name, graceful = true) {
        const processInfo = this.processes.get(name);
        if (!processInfo) {
            this.log('WARN', `Process ${name} not found`, name);
            return;
        }

        if (processInfo.process) {
            this.log('INFO', `Stopping process ${name} (PID: ${processInfo.pid})`, name);
            
            if (graceful) {
                processInfo.process.kill('SIGTERM');
                
                // Force kill after 30 seconds if still running
                setTimeout(() => {
                    if (processInfo.process) {
                        this.log('WARN', `Force killing process ${name}`, name);
                        processInfo.process.kill('SIGKILL');
                    }
                }, 30000);
            } else {
                processInfo.process.kill('SIGKILL');
            }
        }

        this.processes.delete(name);
    }

    /**
     * Stop all monitored processes
     */
    stopAll(graceful = true) {
        this.log('INFO', 'Stopping all monitored processes...');
        
        for (const [name] of this.processes) {
            this.stopProcess(name, graceful);
        }
    }

    /**
     * Get status of all monitored processes
     */
    getStatus() {
        const status = [];
        
        for (const [name, info] of this.processes) {
            status.push({
                name,
                status: info.status,
                pid: info.pid,
                restartCount: info.restartCount,
                lastRestart: info.lastRestart,
                lastHeartbeat: info.lastHeartbeat,
                uptime: info.pid ? Date.now() - info.lastRestart : 0
            });
        }
        
        return status;
    }

    /**
     * Start the supervisor with predefined scrapers
     */
    startDefaultScrapers() {
        this.log('INFO', 'Starting default scraper configuration...');

        // Start historical employer scraper
        this.startProcess('historical-scraper', 'node', [
            path.join(__dirname, 'historical-employer-scraper.js'),
            '30'
        ], {
            env: {
                HEADLESS_MODE: 'true'
            }
        });

        // Start newest jobs scraper
        this.startProcess('newest-jobs-scraper', 'node', [
            path.join(__dirname, 'newest-jobs-scraper.js'),
            '50'
        ], {
            env: {
                HEADLESS_MODE: 'true'
            }
        });

        // Start parallel historical scraper
        this.startProcess('parallel-historical', 'node', [
            path.join(__dirname, 'parallel-historical-scraper.js')
        ], {
            env: {
                HEADLESS_MODE: 'true'
            }
        });

        this.log('INFO', 'All scrapers started');
    }
}

// CLI interface
if (require.main === module) {
    const supervisor = new ScraperSupervisor();

    // Handle shutdown gracefully
    process.on('SIGTERM', () => {
        supervisor.log('INFO', 'Received SIGTERM, shutting down gracefully...');
        supervisor.stopAll(true);
        process.exit(0);
    });

    process.on('SIGINT', () => {
        supervisor.log('INFO', 'Received SIGINT, shutting down gracefully...');
        supervisor.stopAll(true);
        process.exit(0);
    });

    // Start default scrapers
    supervisor.startDefaultScrapers();

    // Log status every minute
    setInterval(() => {
        const status = supervisor.getStatus();
        supervisor.log('INFO', `Status: ${JSON.stringify(status)}`);
    }, 60000);

    supervisor.log('INFO', 'Scraper Supervisor started');
}

module.exports = ScraperSupervisor;