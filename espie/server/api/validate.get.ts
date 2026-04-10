import { validateNativeModules } from '../utils/validate-arm64'

export default defineEventHandler(async () => {
  const results = await validateNativeModules()
  const allPassed = results.every((r) => r.loaded)
  const critical = results.filter((r) => !r.loaded && r.module !== 'opusscript' && r.module !== '@discordjs/opus')

  return {
    status: allPassed ? 'all_passed' : critical.length > 0 ? 'critical_failure' : 'partial',
    platform: {
      arch: process.arch,
      platform: process.platform,
      nodeVersion: process.version,
    },
    results,
    summary: {
      total: results.length,
      loaded: results.filter((r) => r.loaded).length,
      failed: results.filter((r) => !r.loaded).length,
    },
  }
})
