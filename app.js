/**
 * Enhanced wind-js-server for iant62's AvGuru Weather Map
 * Added: Automated GRIB download, no-retention policy, configuration system
 * Date: June 16, 2025
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const cron = require('node-cron');

// Configuration from environment variables
const config = {
    port: process.env.PORT || 8080,
    dataPath: process.env.DATA_PATH || './public/data/weather',
    tempPath: process.env.TEMP_PATH || './temp',
    gribSource: process.env.GRIB_SOURCE || 'noaa',
    updateSchedule: process.env.UPDATE_SCHEDULE || '0 3,9,15,21 * * *', // Every 6 hours
    maxZoomLevel: parseInt(process.env.MAX_ZOOM_LEVEL) || 5,
    logLevel: process.env.LOG_LEVEL || 'info'
};

// Initialize Express app
const app = express();

// Logging utility
function log(level, message) {
    const timestamp = new Date().toISOString();
    if (level === 'error' || config.logLevel === 'debug' || 
        (config.logLevel === 'info' && level !== 'debug')) {
        console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
    }
}

// Ensure required directories exist
function initializeDirectories() {
    const dirs = [config.dataPath, config.tempPath, `${config.dataPath}/current`];
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            log('info', `Created directory: ${dir}`);
        }
    });
}

// Pressure levels configuration for aviation use
const PRESSURE_LEVELS = [
    { param: 'lev_10_m_above_ground=on', name: 'surface', alt: 'Surface' },
    { param: 'lev_850_mb=on', name: '850mb', alt: '~5,000ft' },
    { param: 'lev_700_mb=on', name: '700mb', alt: '~10,000ft' },
    { param: 'lev_500_mb=on', name: '500mb', alt: '~18,000ft' },
    { param: 'lev_300_mb=on', name: '300mb', alt: '~33,000ft' },
    { param: 'lev_150_mb=on', name: '150mb', alt: 'FL440' }
];

const FORECAST_HOURS = ['000', '006']; // Analysis + 6hr forecast

// Get latest GFS run time
function getLatestGFSRunTime() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    
    // GFS runs at 00, 06, 12, 18 UTC
    // Data is usually available 3-4 hours after run time
    let runHour;
    if (utcHour >= 21) runHour = 18;
    else if (utcHour >= 15) runHour = 12;
    else if (utcHour >= 9) runHour = 6;
    else if (utcHour >= 3) runHour = 0;
    else {
        // Use previous day's 18Z run
        now.setUTCDate(now.getUTCDate() - 1);
        runHour = 18;
    }
    
    now.setUTCHours(runHour, 0, 0, 0);
    return now;
}

// Generate optimized GRIB URL using NOMADS filter service
function generateOptimizedGRIBUrl(dateStr, hourStr, forecastHour, level) {
    // Use NOMADS subset service for much smaller downloads (~50-80MB vs 1GB)
    const baseUrl = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl';
    const params = [
        `file=gfs.t${hourStr}z.pgrb2.0p25.f${forecastHour}`,
        'var_UGRD=on',  // U wind component
        'var_VGRD=on',  // V wind component
        level.param,    // Specific pressure level
        `dir=%2Fgfs.${dateStr}%2F${hourStr}%2Fatmos`
    ];
    
    return `${baseUrl}?${params.join('&')}`;
}

// Download all required GRIB files (multiple levels and forecast hours)
async function downloadAllGRIBFiles() {
    const runTime = getLatestGFSRunTime();
    const dateStr = runTime.toISOString().slice(0, 10).replace(/-/g, '');
    const hourStr = runTime.getUTCHours().toString().padStart(2, '0');
    
    log('info', `Starting download for GFS run: ${dateStr} ${hourStr}Z`);
    log('info', `Downloading ${PRESSURE_LEVELS.length} levels × ${FORECAST_HOURS.length} forecast hours = ${PRESSURE_LEVELS.length * FORECAST_HOURS.length} files`);
    
    const downloadedFiles = [];
    
    try {
        // Download each combination of level and forecast hour
        for (const level of PRESSURE_LEVELS) {
            for (const forecastHour of FORECAST_HOURS) {
                const gribUrl = generateOptimizedGRIBUrl(dateStr, hourStr, forecastHour, level);
                const filename = `gfs_${level.name}_f${forecastHour}.grb2`;
                const localPath = path.join(config.tempPath, filename);
                
                log('info', `Downloading ${level.name} ${level.alt} f${forecastHour}...`);
                
                await downloadSingleGRIB(gribUrl, localPath);
                downloadedFiles.push({
                    file: localPath,
                    level: level.name,
                    forecast: forecastHour,
                    altitude: level.alt
                });
                
                // Small delay to avoid overwhelming NOAA servers
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        log('info', `Successfully downloaded ${downloadedFiles.length} GRIB files`);
        return downloadedFiles;
        
    } catch (error) {
        // Cleanup any partial downloads
        downloadedFiles.forEach(item => {
            if (fs.existsSync(item.file)) {
                fs.unlinkSync(item.file);
            }
        });
        throw error;
    }
}

// Download a single GRIB file
function downloadSingleGRIB(url, localPath) {
    return new Promise((resolve, reject) => {
        log('debug', `Downloading: ${url}`);
        
        const file = fs.createWriteStream(localPath);
        
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage} for ${url}`));
                return;
            }
            
            response.pipe(file);
            
            file.on('finish', () => {
                file.close();
                const stats = fs.statSync(localPath);
                log('debug', `Downloaded ${path.basename(localPath)} (${Math.round(stats.size / 1024 / 1024)}MB)`);
                resolve(localPath);
            });
            
            file.on('error', (err) => {
                fs.unlink(localPath, () => {}); // Delete partial file
                reject(err);
            });
            
        }).on('error', (err) => {
            reject(err);
        });
    });
}

// Process multiple GRIB files to tiles using grib2json
function processAllGRIBToTiles(gribFiles) {
    return new Promise(async (resolve, reject) => {
        const processingPath = path.join(config.dataPath, 'processing');
        const currentPath = path.join(config.dataPath, 'current');
        
        try {
            // Remove and recreate processing directory
            if (fs.existsSync(processingPath)) {
                fs.rmSync(processingPath, { recursive: true });
            }
            fs.mkdirSync(processingPath, { recursive: true });
            
            log('info', `Processing ${gribFiles.length} GRIB files to tiles...`);
            
            // Process each GRIB file
            for (const gribInfo of gribFiles) {
                await processSingleGRIBToJSON(gribInfo, processingPath);
            }
            
            // Generate tiles from all the JSON data
            await generateTilesFromAllData(processingPath);
            
            // Atomic replacement: move processing to current
            if (fs.existsSync(currentPath)) {
                fs.rmSync(currentPath, { recursive: true });
            }
            fs.renameSync(processingPath, currentPath);
            
            log('info', 'All tiles generated and deployed successfully');
            resolve();
            
        } catch (error) {
            // Cleanup processing directory on error
            if (fs.existsSync(processingPath)) {
                fs.rmSync(processingPath, { recursive: true });
            }
            reject(error);
        }
    });
}

// Process a single GRIB file to JSON
function processSingleGRIBToJSON(gribInfo, outputPath) {
    return new Promise((resolve, reject) => {
        const outputFile = path.join(outputPath, `wind-${gribInfo.level}-f${gribInfo.forecast}.json`);
        
        log('debug', `Processing ${gribInfo.level} f${gribInfo.forecast} to JSON...`);
        
        // Extract wind data (U and V components)
        const grib2jsonArgs = [
            '--data',
            '--output', outputFile,
            '--names',
            '--compact',
            '--filter.parameter.parameterNumber', '[2,3]', // U and V wind
            gribInfo.file
        ];
        
        const grib2json = spawn('./grib2json', grib2jsonArgs);
        
        let stderr = '';
        grib2json.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        grib2json.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`grib2json failed for ${gribInfo.level} f${gribInfo.forecast}: ${stderr}`));
                return;
            }
            
            log('debug', `Processed ${gribInfo.level} f${gribInfo.forecast} successfully`);
            resolve(outputFile);
        });
        
        grib2json.on('error', (err) => {
            reject(new Error(`grib2json process error: ${err.message}`));
        });
    });
}

// Generate tiles from all processed JSON data
function generateTilesFromAllData(dataPath) {
    return new Promise((resolve, reject) => {
        try {
            const tilesPath = path.join(dataPath, 'tiles');
            fs.mkdirSync(tilesPath, { recursive: true });
            
            // Create directory structure for each level and forecast
            for (const level of PRESSURE_LEVELS) {
                for (const forecastHour of FORECAST_HOURS) {
                    const levelForecastPath = path.join(tilesPath, level.name, `f${forecastHour}`);
                    fs.mkdirSync(levelForecastPath, { recursive: true });
                    
                    // Read the corresponding JSON file
                    const jsonFile = path.join(dataPath, `wind-${level.name}-f${forecastHour}.json`);
                    
                    if (fs.existsSync(jsonFile)) {
                        const windData = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
                        
                        // Generate tiles for each zoom level
                        for (let z = 0; z <= config.maxZoomLevel; z++) {
                            const zoomPath = path.join(levelForecastPath, z.toString());
                            fs.mkdirSync(zoomPath, { recursive: true });
                            
                            // For now, simple tile generation (one tile per zoom level)
                            // In production, this would generate proper spatial tiles
                            const tilePath = path.join(zoomPath, '0');
                            fs.mkdirSync(tilePath, { recursive: true });
                            
                            fs.writeFileSync(
                                path.join(tilePath, '0.json'),
                                JSON.stringify(windData, null, 0)
                            );
                        }
                        
                        log('debug', `Generated tiles for ${level.name} f${forecastHour} (zoom 0-${config.maxZoomLevel})`);
                    } else {
                        log('error', `Missing JSON file for ${level.name} f${forecastHour}`);
                    }
                }
            }
            
            log('info', `Generated tiles for ${PRESSURE_LEVELS.length} levels × ${FORECAST_HOURS.length} forecasts × ${config.maxZoomLevel + 1} zoom levels`);
            resolve();
            
        } catch (error) {
            reject(error);
        }
    });
}

// Cleanup temporary files (no-retention policy)
function cleanup() {
    try {
        const tempFiles = fs.readdirSync(config.tempPath);
        tempFiles.forEach(file => {
            const filePath = path.join(config.tempPath, file);
            if (fs.statSync(filePath).isFile()) {
                fs.unlinkSync(filePath);
            }
        });
        log('info', 'Temporary files cleaned up');
    } catch (error) {
        log('error', `Cleanup failed: ${error.message}`);
    }
}

// Full update process for multiple levels and forecasts
async function updateWeatherData() {
    const startTime = Date.now();
    log('info', 'Starting comprehensive weather data update...');
    
    try {
        // Download all required GRIB files
        const gribFiles = await downloadAllGRIBFiles();
        
        // Process all GRIB files to tiles
        await processAllGRIBToTiles(gribFiles);
        
        // Cleanup temporary files
        cleanup();
        
        const duration = Math.round((Date.now() - startTime) / 1000);
        const summary = {
            levels: PRESSURE_LEVELS.length,
            forecasts: FORECAST_HOURS.length,
            totalFiles: gribFiles.length,
            duration: duration
        };
        
        log('info', `Weather data update completed in ${duration} seconds`);
        log('info', `Processed ${summary.totalFiles} files (${summary.levels} levels × ${summary.forecasts} forecasts)`);
        
        return { success: true, ...summary };
        
    } catch (error) {
        log('error', `Weather data update failed: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// API Routes

// Serve wind tiles for specific level and forecast
app.get('/data/weather/:level/:forecast/:z/:x/:y', (req, res) => {
    const { level, forecast, z, x, y } = req.params;
    
    // Validate level
    const validLevels = PRESSURE_LEVELS.map(l => l.name);
    if (!validLevels.includes(level)) {
        return res.status(400).json({ 
            error: 'Invalid level', 
            validLevels: validLevels 
        });
    }
    
    // Validate forecast
    const validForecasts = FORECAST_HOURS.map(f => `f${f}`);
    if (!validForecasts.includes(forecast)) {
        return res.status(400).json({ 
            error: 'Invalid forecast', 
            validForecasts: validForecasts 
        });
    }
    
    const tilePath = path.join(config.dataPath, 'current', 'tiles', level, forecast, z, x, `${y}.json`);
    
    if (fs.existsSync(tilePath)) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        res.setHeader('Access-Control-Allow-Origin', '*'); // CORS for your AvGuru app
        res.sendFile(path.resolve(tilePath));
    } else {
        res.status(404).json({ error: 'Tile not found' });
    }
});

// Backward compatibility: default to surface/f000 for old URLs
app.get('/data/weather/:z/:x/:y', (req, res) => {
    const { z, x, y } = req.params;
    res.redirect(`/data/weather/surface/f000/${z}/${x}/${y}`);
});

// List available levels and forecasts
app.get('/data/levels', (req, res) => {
    res.json({
        pressureLevels: PRESSURE_LEVELS.map(level => ({
            name: level.name,
            altitude: level.alt,
            description: `Wind data at ${level.alt}`
        })),
        forecasts: FORECAST_HOURS.map(hour => ({
            code: `f${hour}`,
            description: hour === '000' ? 'Current analysis' : `${parseInt(hour)} hour forecast`
        })),
        zoomLevels: `0-${config.maxZoomLevel}`
    });
});

// Enhanced health check endpoint
app.get('/health', (req, res) => {
    const currentPath = path.join(config.dataPath, 'current');
    
    if (fs.existsSync(currentPath)) {
        const stats = fs.statSync(currentPath);
        const dataAge = Date.now() - stats.mtime.getTime();
        const nextUpdate = getLatestGFSRunTime();
        nextUpdate.setHours(nextUpdate.getHours() + 6);
        
        // Check if we have data for all expected levels and forecasts
        const tilesPath = path.join(currentPath, 'tiles');
        let availableLevels = [];
        let availableForecasts = [];
        
        if (fs.existsSync(tilesPath)) {
            availableLevels = fs.readdirSync(tilesPath);
            // Check forecasts for first level
            if (availableLevels.length > 0) {
                const firstLevelPath = path.join(tilesPath, availableLevels[0]);
                if (fs.existsSync(firstLevelPath)) {
                    availableForecasts = fs.readdirSync(firstLevelPath);
                }
            }
        }
        
        res.json({
            status: 'healthy',
            lastUpdate: stats.mtime,
            dataAgeHours: Math.round(dataAge / (1000 * 60 * 60)),
            nextUpdate: nextUpdate,
            data: {
                expectedLevels: PRESSURE_LEVELS.length,
                availableLevels: availableLevels.length,
                expectedForecasts: FORECAST_HOURS.length,
                availableForecasts: availableForecasts.length,
                levels: availableLevels,
                forecasts: availableForecasts
            },
            config: {
                maxZoomLevel: config.maxZoomLevel,
                updateSchedule: config.updateSchedule,
                pressureLevels: PRESSURE_LEVELS.map(l => `${l.name} (${l.alt})`)
            }
        });
    } else {
        res.status(503).json({
            status: 'no_data',
            message: 'No weather data available',
            expectedLevels: PRESSURE_LEVELS.length,
            expectedForecasts: FORECAST_HOURS.length
        });
    }
});

// Manual update trigger (for testing)
app.post('/update', async (req, res) => {
    const result = await updateWeatherData();
    res.json(result);
});

// Serve static files
app.use(express.static('public'));

// Initialize and start server
function startServer() {
    initializeDirectories();
    
    // Schedule automatic updates
    cron.schedule(config.updateSchedule, () => {
        log('info', 'Scheduled update triggered');
        updateWeatherData();
    });
    
    // Start Express server
    app.listen(config.port, () => {
        log('info', `Wind server started on port ${config.port}`);
        log('info', `Health check: http://localhost:${config.port}/health`);
        log('info', `Update schedule: ${config.updateSchedule}`);
        
        // Trigger initial update if no data exists
        const currentPath = path.join(config.dataPath, 'current');
        if (!fs.existsSync(currentPath)) {
            log('info', 'No existing data found, triggering initial update...');
            setTimeout(() => updateWeatherData(), 5000); // Wait 5 seconds for server to fully start
        }
    });
}

// Start the server
startServer();
