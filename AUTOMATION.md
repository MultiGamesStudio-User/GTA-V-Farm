# 🤖 Automated Build System (GitHub Actions)

MacroEngine now automatically builds & releases installers when you push code!

---

## How It Works

### Release Build (Automatic)

When you create a **git tag**, GitHub Actions automatically:
1. ✅ Checks out your code
2. ✅ Installs Node.js & Python
3. ✅ Compiles NSIS installer
4. ✅ Compiles Portable EXE
5. ✅ Creates GitHub Release
6. ✅ Attaches both EXEs
7. ✅ Users get auto-update notification

### Test Build (On Every PR)

When you open a PR or push to `main`:
1. ✅ Tests the build (Portable version)
2. ✅ Shows errors if build fails
3. ✅ Blocks merging if build broken

---

## Workflow

### 1. Make Changes Locally

```bash
git checkout -b feature/my-feature
# ... edit files ...
git add .
git commit -m "feat: add new feature"
git push origin feature/my-feature
```

→ **GitHub Tests Build** ✓

### 2. Create PR & Merge

```bash
# On GitHub:
# 1. Create Pull Request
# 2. Wait for tests (green checkmark ✓)
# 3. Merge to main
```

→ **GitHub Tests Build Again** ✓

### 3. Create Release

```bash
# Only when ready to release:
git tag v2.3.0
git push --tags
```

→ **GitHub Automatically Builds & Releases!** 🚀

```
📦 v2.3.0
├── MacroEngine-Setup.exe (50MB)
├── MacroEngine-Portable.exe (48MB)
└── Release notes from CHANGELOG.md
```

---

## Step-by-Step Setup

### 1. Push Your Code to GitHub

```bash
git remote add origin https://github.com/YOUR-USERNAME/GTA-V-Farm.git
git branch -M main
git push -u origin main
```

### 2. Workflows Auto-Enable

GitHub Actions runs automatically:
- `.github/workflows/test-build.yml` – On every push/PR
- `.github/workflows/build-release.yml` – On new tags

Check status: **GitHub → Actions tab**

### 3. Create First Release

```bash
git tag v2.2.0
git push origin main
git push --tags
```

→ Visit **Releases** tab → Downloadable installers! ✨

---

## Release Workflow Example

```bash
# 1. Prepare release
npm run release-prepare patch

# 2. Edit CHANGELOG.md with your changes

# 3. Commit & tag
git commit -am "chore: bump to v2.2.1"
git tag v2.2.1
git push && git push --tags

# 4. GitHub builds automatically
# (check Actions tab)

# 5. Download from Releases
# → GitHub creates Release page with both EXEs
```

---

## What Gets Built

Each release creates:

| File | Size | Use Case |
|------|------|----------|
| **MacroEngine-Setup.exe** | ~50MB | Full installer (recommended) |
| **MacroEngine-Portable.exe** | ~48MB | USB drive / no install |

Both are **identical** in features, just different packaging.

---

## Troubleshooting

### Build Failed in GitHub Actions

1. Check **Actions tab** → see error
2. Common issues:
   - Icons missing → add `electron-app/assets/*.ico`
   - Python deps → update `requirements.txt`
   - Node issues → clear cache & retry

### Auto-Update Not Working

1. Verify GitHub token: **Settings → Developer Settings → Personal Access Tokens**
2. Check release has `.exe` files attached
3. Wait 30 minutes (release caching)

### Manual Build (Skip GitHub)

```bash
cd electron-app
npm run build-nsis        # Create installer locally
```

---

## GitHub Actions Status Badge

Add to your README.md:

```markdown
![Build Status](https://github.com/YOUR-USERNAME/GTA-V-Farm/workflows/Build%20%26%20Release%20MacroEngine/badge.svg)
```

---

## Security Notes

- GitHub token (`GITHUB_TOKEN`) is **secure** & auto-managed
- Workflows run on **GitHub's servers** (not your PC)
- No code signing configured yet (optional)

---

## Next: Auto-Update

Users with installed MacroEngine will:
1. Launch app
2. App checks GitHub Releases
3. Shows "New version available!"
4. One-click upgrade

Perfect for continuous delivery! 🚀

---

**Congrats!** Your build system is now **fully automated**! 🎉
