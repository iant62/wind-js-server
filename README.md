# Enhanced Wind-JS-Server for AvGuru Weather Map

An enhanced version of [wind-js-server](https://github.com/cambecc/wind-js-server) specifically configured for iant62's AvGuru Weather Map project.

## Features

- ✅ **Automated GRIB Download**: Downloads GFS data every 6 hours
- ✅ **No-Retention Policy**: Only keeps current forecast data
- ✅ **Global Coverage**: Serves wind data for worldwide users
- ✅ **Health Monitoring**: Built-in health check endpoints
- ✅ **Production Ready**: Systemd service, logging, error handling
- ✅ **Modern Dependencies**: Updated packages for security and compatibility

## Quick Start

### 1. VPS Setup (Automated)

```bash
# On your VPS (as root):
wget https://raw.githubusercontent.com/iant62/wind-js-server/main/setup.sh
chmod +x setup.sh
sudo ./setup.sh
```

### 2. Manual Installation

```bash
# Clone your fork
git clone https://github.com/iant62/wind-js-server.git
cd wind-js-server

# Install dependencies
npm install

# Start the server
npm start
```

## Configuration

Configure via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `DATA_PATH` | `./public/data/weather` | Data storage directory |
| `TEMP_PATH` | `./temp` | Temporary files directory |
| `UPDATE_SCHEDULE` | `0 3,9,15,21 * * *` | Cron schedule for updates |
| `MAX_ZOOM_LEVEL` | `5` | Maximum tile zoom level |
| `LOG_LEVEL` | `info` | Logging level (debug, info, error) |

### Example Configuration

```bash
# Set environment variables
export PORT=8080
export LOG_LEVEL=debug
export MAX_ZOOM_LEVEL=4

# Start server
npm start
```

## API Endpoints

### Wind Tiles
```
GET /data/weather/{z}/{x}/{y}
```
Returns wind data tiles in Leaflet Velocity format.

**Example:**
```bash
curl http://localhost:8080/data/weather/2/1/1
```

### Health Check
```
GET /health
```
Returns server health and data status.

**Response:**
```json
{
  "status": "healthy",
  "lastUpdate": "2024-12-19T15:00:00.000Z",
  "dataAgeHours": 2,
  "nextUpdate": "2024-12-19T21:00:00.000Z",
  "config": {
    "maxZoomLevel": 5,
    "updateSchedule": "0 3,9,15,21 * * *"
  }
}
```

### Manual Update (Testing)
```
POST /update
```
Triggers immediate data update.

**Example:**
```bash
curl -X POST http://localhost:8080/update
```

## Integration with AvGuru Weather Map

### Update your mapwx-wind-velocity.js

Replace the existing fetch URL:

```javascript
// Old (OpenDAP):
const response = await fetch(`get_gfs_wind.php?${params}`);

// New (Your VPS):
const tileUrl = `http://your-vps-ip:8080/data/weather/${z}/${x}/${y}`;
const response = await fetch(tileUrl);
```

### Benefits

- **Faster Response**: Pre-processed tiles vs real-time NOAA queries
- **Global Coverage**: One dataset serves all worldwide users
- **Reliability**: Local data vs external API dependency
- **Consistent Updates**: Fresh data every 6 hours automatically

## Data Pipeline

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ NOAA GFS GRIB   │───▶│ Enhanced        │───▶│ Wind Tiles      │
│ (Every 6 hours) │    │ wind-js-server  │    │ (JSON format)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ AvGuru Weather  │
                       │ Map (Clients)   │
                       └─────────────────┘
```

## Storage Management

### No-Retention Policy
- Only current forecast is kept (~6GB)
- Old data automatically replaced
- Temporary files cleaned after processing
- Predictable storage usage

### Directory Structure
```
wind-js-server/
├── public/data/weather/
│   └── current/           # Current forecast only
│       └── tiles/         # Generated wind tiles
├── temp/                  # Temporary GRIB files (auto-cleaned)
└── logs/                  # Application logs
```

## Monitoring

### System Service
```bash
# Check service status
systemctl status wind-js-server

# View real-time logs
journalctl -u wind-js-server -f

# Restart service
systemctl restart wind-js-server
```

### Health Monitoring
```bash
# Quick health check
curl http://localhost:8080/health

# Monitor update success
tail -f /var/log/wind-js-server.log | grep "update completed"
```

## Troubleshooting

### Common Issues

**Service won't start:**
```bash
# Check logs
journalctl -u wind-js-server -n 50

# Check file permissions
ls -la /opt/wind-js-server/
```

**No data available:**
```bash
# Trigger manual update
curl -X POST http://localhost:8080/update

# Check GRIB download
ls -la /opt/wind-js-server/temp/
```

**High storage usage:**
```bash
# Check data directory size
du -sh /opt/wind-js-server/public/data/

# Force cleanup
systemctl restart wind-js-server
```

### Log Locations
- **Service logs**: `/var/log/wind-js-server.log`
- **Error logs**: `/var/log/wind-js-server-error.log`
- **System logs**: `journalctl -u wind-js-server`

## Development

### Local Development
```bash
# Install dev dependencies
npm install

# Start with auto-reload
npm run dev

# Test manual update
curl -X POST http://localhost:3000/update
```

### Testing Integration
```bash
# Test health endpoint
curl http://localhost:8080/health

# Test tile serving
curl http://localhost:8080/data/weather/0/0/0

# Monitor update process
tail -f logs/wind-server.log
```

## Security Considerations

- Service runs as non-root user (`windserver`)
- Firewall configured for port 8080 only
- No authentication (internal VPS use)
- Regular log rotation configured
- Auto-restart on failures

## Performance

**VPS Requirements:**
- 2 vCPU (sufficient for GRIB processing)
- 2GB RAM (handles Node.js + data processing)
- 10GB+ storage (current: ~6GB, room for growth)

**Expected Performance:**
- GRIB download: 2-5 minutes
- GRIB processing: 5-15 minutes  
- Tile serving: <100ms response time
- Update frequency: Every 6 hours

## License

MIT License - Enhanced version for AvGuru Weather Map project.

## Support

For issues specific to this enhanced version:
1. Check the [troubleshooting section](#troubleshooting)
2. Review logs for error messages
3. Create an issue on GitHub with log details
