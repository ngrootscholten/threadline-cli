# CI Diff Strategy Simplification Plan

## Design Decision

**Current approach:** Review entire branch against default branch (even without PR/MR)
**Proposed approach:** PR/MR signals merge intent; without it, review only the commit

### Rationale

1. **PRs/MRs signal merge intent** — If someone wants branch-level review, they should create a PR
2. **Removes ambiguity** — No guessing which branch to compare against
3. **Simplifies code** — No need to detect/fetch default branch
4. **Consistent behavior** — Same logic for pushes to any branch
5. **Smaller, focused diffs** — Commit-level review is more actionable

---


## Proposed Strategy (All Environments)

| Trigger | Review Scope | Diff Command |
|---------|--------------|--------------|
| PR/MR opened/updated | Source vs target branch | `origin/${target}...origin/${source}` |
| Push (any branch) | Last commit only | `HEAD~1...HEAD` |
| Local development | Staged/unstaged changes | (unchanged) |

---

## Per-Environment Analysis

### GitHub Actions

**Current implementation:**
```
Scenario 1: PR            → origin/${baseRef}...origin/${headRef}  ✅ KEEP
Scenario 2: Push to main  → HEAD~1...HEAD                          ✅ KEEP (already commit-level)
Scenario 3: Feature push  → origin/${defaultBranch}...origin/${refName}  ❌ REMOVE
```

**Code to remove:**
- `getDefaultBranchName()` function (~45 lines)
- Scenario 3 handling in `getDiff()` (~10 lines)
- Can simplify: Push to ANY branch → HEAD~1...HEAD

**After simplification:**
```typescript
// PR Context
if (eventName === 'pull_request') {
  return diff origin/${baseRef}...origin/${headRef}
}

// Any push (main or feature branch)
return diff HEAD~1...HEAD
```

---

### GitLab CI

**Current implementation:**
```
Scenario 1: MR            → fetch target, origin/${target}...origin/${source}  ✅ KEEP
Scenario 2: Feature push  → fetch default, origin/${default}...origin/${ref}   ❌ REMOVE
Scenario 3: Push to main  → HEAD~1...HEAD                                       ✅ KEEP
```

**Code to remove:**
- Scenario 2 handling (~10 lines)
- `CI_DEFAULT_BRANCH` usage
- Fetching default branch for feature branches

**After simplification:**
```typescript
// MR Context
if (mrIid) {
  fetch target branch
  return diff origin/${target}...origin/${source}
}

// Any push (main or feature branch)
return diff HEAD~1...HEAD
```

---

### Bitbucket Pipelines

**Current implementation:**
```
Scenario 1: PR            → origin/${destination}...HEAD           ✅ KEEP
Scenario 2: Feature push  → detectDefaultBranch(), origin/${default}...HEAD  ❌ REMOVE
Scenario 3: Push to main  → HEAD~1...HEAD                          ✅ KEEP
```

**Code to remove:**
- `detectDefaultBranch()` function (~30 lines)
- Scenario 2 handling (~15 lines)
- Default branch detection logic

**After simplification:**
```typescript
// PR Context
if (prId) {
  return diff origin/${destination}...HEAD
}

// Any push (main or feature branch)
return diff HEAD~1...HEAD
```

---

### Vercel

**Current implementation:**
```
Commit-only → git show ${commitSha}  ✅ KEEP (already simplified)
```

**No changes needed.** Vercel is already commit-only due to shallow clone limitations.

---

## Context Types (Completed)

**Final `ReviewContext` types:**
- `pr` — Branch comparison (GitHub PR)
- `mr` — Branch comparison (GitLab MR)
- `commit` — Single commit review (any push without PR/MR)
- `local` — Staged/unstaged changes

The `branch` context type has been removed — without a PR/MR, we only review commits.

---

## Completed: `src/git/diff.ts` Cleanup

| Function | Status |
|----------|--------|
| `getBranchDiff()` + `detectBaseBranch()` | ✅ DELETED (~185 lines) - removed `--branch` flag entirely |
| `getPRMRDiff()` | ✅ DELETED (~27 lines) |
| `getCommitDiff()` | ✅ KEPT - used by `--commit` flag |
| `getCommitMessage()` | ✅ KEPT - used by all CI environment files |
| `getCommitAuthor()` | ✅ KEPT - used by `local.ts` |

**Result:** `diff.ts` reduced from ~298 lines to ~112 lines

The `--branch` flag was removed from the CLI. Will be re-added later with explicit `--source` and `--target` parameters (no guessing).

---

## Summary of Code Removal

| Location | Lines Removed | What | Status |
|----------|---------------|------|--------|
| `diff.ts` | ~185 lines | `getBranchDiff()`, `detectBaseBranch()`, `getPRMRDiff()` | ✅ DONE |
| `index.ts` | ~5 lines | `--branch` CLI option and examples | ✅ DONE |
| `check.ts` | ~15 lines | `--branch` handling code | ✅ DONE |
| `github.ts` | ~55 lines | `getDefaultBranchName()`, feature branch scenario | ✅ DONE |
| `gitlab.ts` | ~15 lines | Feature branch scenario, default branch fetch | ✅ DONE |
| `bitbucket.ts` | ~45 lines | `detectDefaultBranch()`, feature branch scenario | ✅ DONE |
| `context.ts` | ~5 lines | Removed `BranchContext` type | ✅ DONE |
| **Total** | **~325 lines** | | ✅ ALL COMPLETE |

---

## Migration Notes

- Existing users who push to feature branches without PRs will now see commit-level diffs instead of branch-level diffs
- This is arguably better behavior — they get focused feedback on their latest commit
- Full branch review happens when they open a PR (which is the appropriate time)

---

## Future Enhancement: Local Branch Review

**The `--branch` flag has been removed.** When re-added, it will require explicit parameters:

```bash
# Proposed new syntax (future implementation)
threadlines check --source feature-xyz --target main
```

**No guessing, no fallbacks** - user must specify both branches explicitly.

This aligns with the PR/MR pattern: if you want branch-level review, you explicitly state your intent.

---

## Completion Status

All simplification tasks completed:

1. ✅ Removed `--branch` CLI flag and `getBranchDiff()` from `diff.ts`
2. ✅ Simplified `github.ts` — removed `getDefaultBranchName()`, feature branch scenario
3. ✅ Simplified `gitlab.ts` — removed feature branch scenario, default branch fetch
4. ✅ Simplified `bitbucket.ts` — removed `detectDefaultBranch()`, feature branch scenario
5. ✅ Removed `BranchContext` type from `context.ts`

## Remaining Tasks

- Test in each CI environment to verify behavior
- Update user-facing documentation if needed
