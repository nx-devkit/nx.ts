---
date: 2026-11-09
tags: [nx, ci, automation]
source: conversation
---

## Problem
There is no automated check that the repo's Nx version is the latest (mature) release. When Nx falls behind, someone has to notice manually and run `nx migrate`. The migration then lands on `main` directly, mixing with feature work.

## Proposed action
Add a CI/main check (e.g. a scheduled workflow or a `check:nx-latest` script) that compares the pinned Nx version against the latest mature release (respecting `minimumReleaseAge`). When behind, open a PR targeting a dedicated `nx-promote` branch (or `chore/nx-migrate-<version>`) that runs `nx migrate latest`, applies migrations, verifies, and is ready to merge — instead of landing the migration on `main` or a feature branch. Wire the result into the existing `/act` / review loop so the promotion PR is reviewed like any other.
