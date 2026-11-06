// Builds the app for the tenant-host harness. See playwright.tenant-hosts.config.ts.
import { spawnSync } from 'node:child_process'
import { HARNESS_BUILD_ENV, assertNoEnvFiles, scrubInheritedSettings, writeHarnessMarker } from './harness-env.mjs'

assertNoEnvFiles()
scrubInheritedSettings()

const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', env: { ...process.env, ...HARNESS_BUILD_ENV } })
if (build.status !== 0) process.exit(build.status ?? 1)

writeHarnessMarker()
