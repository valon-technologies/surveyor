#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PLIST_NAME="com.surveyor.feedback-agent"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
LOG_DIR="$HOME/.claude/feedback-queue"
mkdir -p "$LOG_DIR"

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which npx)</string>
        <string>tsx</string>
        <string>${REPO_DIR}/scripts/feedback-agent/agent.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${REPO_DIR}</string>
    <key>StartInterval</key>
    <integer>1800</integer>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/agent.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/agent-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:$(dirname "$(which node)")</string>
    </dict>
</dict>
</plist>
EOF

# Unload if already loaded, then load
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo "Feedback agent scheduler installed and started."
echo "  Plist: $PLIST_PATH"
echo "  Logs:  $LOG_DIR/agent.log"
echo "  Runs every 30 minutes."
echo ""
echo "To stop:   launchctl unload $PLIST_PATH"
echo "To manual: cd $REPO_DIR && npx tsx scripts/feedback-agent/agent.ts"
