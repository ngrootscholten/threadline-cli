# Setup Instructions (DELETE THIS FILE BEFORE PUSHING)

This file contains instructions for initializing the public Threadlines CLI repo.
Delete this file before pushing to GitHub.

## Step 1: Copy Source Files

Run these commands from PowerShell in this directory:

```powershell
# Copy source files from your private repo
Copy-Item -Path "C:\Users\niels\code\devthreadline\packages\cli\src" -Destination "." -Recurse
Copy-Item -Path "C:\Users\niels\code\devthreadline\packages\cli\bin" -Destination "." -Recurse
Copy-Item -Path "C:\Users\niels\code\devthreadline\packages\cli\tsconfig.json" -Destination "."
Copy-Item -Path "C:\Users\niels\code\devthreadline\packages\cli\eslint.config.js" -Destination "."
Copy-Item -Path "C:\Users\niels\code\devthreadline\packages\cli\README.md" -Destination "."
```

## Step 2: Create GitHub Repo

1. Go to https://github.com/new
2. Create repo: `threadlines/cli` (or your org/name)
3. Set to **Public**
4. Do NOT initialize with README, .gitignore, or license (we have those)

## Step 3: Initialize Git and Push

```powershell
# Initialize fresh git repo (no history)
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: Threadlines CLI v0.1.41"

# Add remote (replace with your actual repo URL)
git remote add origin https://github.com/threadlines/cli.git

# Push to main
git branch -M main
git push -u origin main
```

## Step 4: Configure npm Publishing

1. Go to https://www.npmjs.com/settings/YOUR_USERNAME/tokens
2. Create a new "Automation" token
3. In GitHub repo settings → Secrets → Actions
4. Add secret: `NPM_TOKEN` with the token value

## Step 5: Update package.json in Private Repo

After setting up the public repo, update your private repo's package.json
to point to the new repository URL.

## Step 6: Test Publishing

1. Create a release on GitHub (e.g., v0.1.42)
2. The GitHub Action will automatically publish to npm with provenance

## Step 7: Clean Up

Delete this SETUP.md file - it shouldn't be in the public repo!

