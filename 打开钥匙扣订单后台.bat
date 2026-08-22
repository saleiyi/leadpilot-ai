@echo off
cd /d "%~dp0"
if not exist ".admin-token" (
  echo Admin token file not found: %CD%\.admin-token
  pause
  exit /b 1
)
powershell -NoProfile -Command "Get-Content -Raw -LiteralPath '.admin-token' | Set-Clipboard"
start "" "https://leadpilot-ai-6db.pages.dev/analytics"
echo The private admin token was copied to your clipboard.
echo Paste it into the analytics or orders dashboard password box. Do not share the token.
pause
