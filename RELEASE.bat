@echo off
REM Release Quick Start Guide for Windows
REM Copy-paste these commands to release a new version

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║        MacroEngine Release Quick Start                    ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo 📋 Complete Workflow:
echo.
echo 1️⃣  PREPARE RELEASE
echo    cd electron-app
echo    npm run release-prepare patch    [or minor/major]
echo.
echo 2️⃣  EDIT CHANGELOG
echo    Open CHANGELOG.md
echo    Add your changes under the new version
echo.
echo 3️⃣  COMMIT ^& TAG
echo    git add .
echo    git commit -m "chore: bump to v2.X.X"
echo    git tag v2.X.X
echo.
echo 4️⃣  PUSH (GitHub Actions auto-builds!)
echo    git push origin main
echo    git push --tags
echo.
echo 5️⃣  WATCH BUILD
echo    GitHub ^→ Actions tab ^→ see progress
echo.
echo 6️⃣  DOWNLOAD RELEASE
echo    GitHub ^→ Releases ^→ v2.X.X
echo    ├── MacroEngine-Setup.exe
echo    └── MacroEngine-Portable.exe
echo.
echo ✨ Users get auto-update notification!
echo.
echo ════════════════════════════════════════════════════════════
echo.
echo 🚀 Start now:
echo    cd electron-app
echo    npm run release-prepare patch
echo.
pause
