# 🔧 GitHub Setup Guide

Complete these steps to enable automated builds via GitHub Actions.

---

## Prerequisites

1. **GitHub Account** (free at [github.com](https://github.com))
2. **Git installed** on your PC ([git-scm.com](https://git-scm.com))
3. **Your code** (already on `d:\GTAV\Script\GTA V FARM`)

---

## Step 1: Create GitHub Repository

### On github.com:

1. Click **+** (top right) → **New repository**
2. Fill in:
   - **Repository name:** `GTA-V-Farm`
   - **Description:** GTA V Farming Automation Bot
   - **Visibility:** Public (for auto-updates) or Private (security)
   - **License:** MIT (will be auto-detected)
3. Click **Create repository**

---

## Step 2: Connect Your Local Code

Open Command Prompt in `d:\GTAV\Script\GTA V FARM`:

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"

git remote add origin https://github.com/YOUR-USERNAME/GTA-V-Farm.git
git branch -M main
git add .
git commit -m "Initial commit"
git push -u origin main
```

✅ Your code is now on GitHub!

---

## Step 3: Verify Workflows

On GitHub:

1. Click **Actions** tab
2. You should see:
   - ✅ `test-build.yml` (tests on push)
   - ✅ `build-release.yml` (builds on tags)

**Status:** Workflows are ready!

---

## Step 4: Create First Release (Test)

Back in Command Prompt:

```bash
git tag v2.2.0
git push --tags
```

**Check GitHub:**
1. **Actions** tab → watch build progress
2. **Releases** tab → download your first `.exe` files!

---

## Step 5: Enable Auto-Updates (Optional)

Auto-update is **already configured** in your code. Users will get notifications!

### Test auto-update:

1. Create `v2.2.1` release (following Step 4)
2. Install `v2.2.0` first
3. App detects `v2.2.1` available → "Update now?" button
4. One-click upgrade!

---

## Repository Structure on GitHub

```
YOUR-USERNAME/GTA-V-Farm
├── .github/
│   └── workflows/
│       ├── test-build.yml       ← Tests on PR
│       └── build-release.yml    ← Builds on tag
├── electron-app/
├── modules/
├── README.md
├── CHANGELOG.md
└── ...
```

---

## How to Release from Now On

**Every time you want to release:**

```bash
cd electron-app
npm run release-prepare patch     # or minor/major

# Edit CHANGELOG.md (it opens automatically)

git commit -am "chore: bump to v2.X.X"
git tag v2.X.X
git push && git push --tags
```

→ **GitHub auto-builds in ~5 minutes**  
→ **Release page is created**  
→ **Users see auto-update notification**

---

## Making Changes (Workflow)

```bash
# 1. Create feature branch
git checkout -b feature/new-fishing-spot

# 2. Make changes & commit
git add .
git commit -m "feat: add new fishing spot"

# 3. Push
git push origin feature/new-fishing-spot

# 4. On GitHub: Create Pull Request
# 5. GitHub auto-tests the build ✓
# 6. If green ✓, merge to main
# 7. Delete branch

# DONE! Workflow complete.
```

---

## Troubleshooting

### Build Failed in GitHub Actions

Check **Actions** tab → click the red ❌ → see error details

Common issues:
- Missing icons → add `electron-app/assets/*.ico`
- Python error → update `requirements.txt`
- Node error → increment `package.json` version manually

### Can't Push to GitHub

```bash
git remote -v      # Check if origin is set
git push -u origin main  # Force push setup
```

### Release Page Shows No Files

Wait 2-3 minutes, then refresh. GitHub caches releases.

---

## Advanced: Code Signing (Optional)

For production, consider signing your executables:

1. Get a **Code Signing Certificate** ($200-300/year)
2. Add to `.github/workflows/build-release.yml`:
   ```yaml
   - name: Sign EXE
     uses: microsoft/github-actions-for-windows-signing@v0
     with:
       certificate-path: ${{ secrets.SIGNING_CERT }}
       certificate-password: ${{ secrets.CERT_PASSWORD }}
   ```
3. Add secrets in GitHub Settings

---

## Summary

✅ Your code is on GitHub  
✅ Workflows auto-build on tags  
✅ Users can download releases  
✅ Auto-update is configured  
✅ Ready for production!

---

**Next:** Make changes → commit → tag → GitHub auto-builds! 🚀
