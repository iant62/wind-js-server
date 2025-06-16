#!/bin/bash
# VPS Setup Script for Enhanced wind-js-server
# For iant62's AvGuru Weather Map project
# Date: December 19, 2024

echo "=== Enhanced wind-js-server VPS Setup ==="
echo "Setting up wind server for global weather data serving..."

# Exit on any error
set -e

# Configuration
INSTALL_DIR="/opt/wind-js-server"
SERVICE_USER="windserver"
SERVICE_NAME="wind-js-server"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (use sudo)"
    exit 1
fi

echo "Step 1: Installing system dependencies..."

# Update system
apt-get update

# Install Node.js (using NodeSource repository for latest LTS)
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt-get install -y nodejs

# Install other required packages
apt-get install -y git curl wget build-essential

# Verify installations
echo "Node.js version: $(node --version)"
echo "NPM version: $(npm --version)"

echo "Step 2: Creating service user..."

# Create service user if it doesn't exist
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --home-dir "$INSTALL_DIR" --shell /bin/bash "$SERVICE_USER"
    echo "Created user: $SERVICE_USER"
fi

echo "Step 3: Setting up application directory..."

# Create installation directory
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Clone the repository (user should have already forked it)
if [ ! -d ".git" ]; then
    echo "Cloning wind-js-server repository..."
    git clone https://github.com/iant62/wind-js-server.git .
else
    echo "Repository already exists, pulling latest changes..."
    git pull origin main
fi

echo "Step 4: Installing Node.js dependencies..."

# Install npm dependencies
npm install --production

echo "Step 5: Setting up directories and permissions..."

# Create required directories
mkdir -p temp
mkdir -p public/data/weather/current
mkdir -p logs

# Set proper ownership
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# Make grib2json executable
chmod +x grib2json

echo "Step 6: Creating systemd service..."

# Create systemd service file
cat > /etc/systemd/system/$SERVICE_NAME.service << EOF
[Unit]
Description=Enhanced Wind JS Server for AvGuru Weather Map
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node app.js
Restart=always
RestartSec=10

# Environment variables
Environment=NODE_ENV=production
Environment=PORT=8080
Environment=DATA_PATH=./public/data/weather
Environment=TEMP_PATH=./temp
Environment=LOG_LEVEL=info
Environment=MAX_ZOOM_LEVEL=5

# Logging
StandardOutput=append:/var/log/wind-js-server.log
StandardError=append:/var/log/wind-js-server-error.log

[Install]
WantedBy=multi-user.target
EOF

echo "Step 7: Configuring firewall..."

# Open port 8080 (adjust if using different port)
if command -v ufw &> /dev/null; then
    ufw allow 8080/tcp
    echo "Opened port 8080 in firewall"
fi

echo "Step 8: Starting and enabling service..."

# Reload systemd and start service
systemctl daemon-reload
systemctl enable $SERVICE_NAME
systemctl start $SERVICE_NAME

# Wait a moment for service to start
sleep 3

# Check service status
if systemctl is-active --quiet $SERVICE_NAME; then
    echo "✅ Service started successfully!"
else
    echo "❌ Service failed to start. Check logs:"
    echo "   systemctl status $SERVICE_NAME"
    echo "   journalctl -u $SERVICE_NAME -f"
fi

echo "Step 9: Setting up log rotation..."

# Create logrotate configuration
cat > /etc/logrotate.d/wind-js-server << EOF
/var/log/wind-js-server*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 644 $SERVICE_USER $SERVICE_USER
    postrotate
        systemctl reload $SERVICE_NAME
    endscript
}
EOF

echo "=== Setup Complete! ==="
echo ""
echo "Service Status:"
systemctl status $SERVICE_NAME --no-pager
echo ""
echo "Useful Commands:"
echo "  Start service:    systemctl start $SERVICE_NAME"
echo "  Stop service:     systemctl stop $SERVICE_NAME"
echo "  Restart service:  systemctl restart $SERVICE_NAME"
echo "  View logs:        journalctl -u $SERVICE_NAME -f"
echo "  Health check:     curl http://localhost:8080/health"
echo ""
echo "The service will automatically:"
echo "  • Download GFS data every 6 hours (3, 9, 15, 21 UTC)"
echo "  • Process GRIB files to wind tiles"
echo "  • Clean up temporary files (no data retention)"
echo "  • Restart automatically if it crashes"
echo ""
echo "Next steps:"
echo "1. Test the health endpoint: curl http://localhost:8080/health"
echo "2. Trigger manual update: curl -X POST http://localhost:8080/update"
echo "3. Update your AvGuru app to use: http://your-vps-ip:8080/data/weather/"
echo ""
echo "Installation directory: $INSTALL_DIR"
echo "Service user: $SERVICE_USER"
