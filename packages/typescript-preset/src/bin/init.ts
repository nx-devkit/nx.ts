#!/usr/bin/env node

/**
 * One-command bootstrap: npx @nx-devkit/typescript init
 *
 * This is a thin launcher. It ensures `nx` is available, then delegates
 * all logic to the Nx init generator at `@nx-devkit/typescript:init`.
 */

import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

function hasNx(): boolean {
  return existsSync(join(process.cwd(), 'node_modules', 'nx', 'package.json'))
}

function detectPackageManager(): 'bun' | 'npm' | 'pnpm' | 'yarn' {
  if (existsSync(join(process.cwd(), 'bun.lock'))) return 'bun'
  if (existsSync(join(process.cwd(), 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(process.cwd(), 'yarn.lock'))) return 'yarn'
  return 'npm'
}

function main(): void {
  const args = process.argv.slice(2)
  const pm = detectPackageManager()

  // If nx is not installed, install it first
  if (!hasNx()) {
    console.log('Nx not found. Installing nx + @nx/devkit...')
    const installBin =
      pm === 'bun' ? 'bun' : pm === 'pnpm' ? 'pnpm' : pm === 'yarn' ? 'yarn' : 'npm'
    const installArgs =
      pm === 'bun' || pm === 'pnpm' || pm === 'yarn'
        ? ['add', '-D', 'nx', '@nx/devkit']
        : ['install', '-D', 'nx', '@nx/devkit']
    try {
      execFileSync(installBin, installArgs, { stdio: 'inherit', cwd: process.cwd(), shell: false })
    } catch (error) {
      console.error('Failed to install nx + @nx/devkit. Please install them manually.')
      if (error instanceof Error && error.message) {
        console.error(`Error: ${error.message}`)
      }
      process.exit(1)
    }
  }

  // Build the generator command
  // Pass through any args after "init" to the generator
  const genArgs = args.filter((a) => a !== 'init')
  const nxBin = pm === 'bun' ? 'bunx' : pm === 'pnpm' ? 'pnpm' : pm === 'yarn' ? 'yarn' : 'npx'
  const nxArgs =
    pm === 'pnpm' || pm === 'yarn'
      ? ['exec', 'nx', 'g', '@nx-devkit/typescript:init', ...genArgs]
      : ['nx', 'g', '@nx-devkit/typescript:init', ...genArgs]

  console.log(`Running: ${nxBin} ${nxArgs.join(' ')}`)
  try {
    execFileSync(nxBin, nxArgs, { stdio: 'inherit', cwd: process.cwd(), shell: false })
  } catch (error) {
    console.error('Failed to run the init generator.')
    if (error instanceof Error && error.message) {
      console.error(`Error: ${error.message}`)
    }
    process.exit(1)
  }
}

main()
