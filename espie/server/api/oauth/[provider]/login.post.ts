// POST /api/oauth/:provider/login — initiates an OAuth login flow.
// Returns { flowId, authUrl } for the browser to open.
// The pi-ai OAuth provider handles the callback server internally.
// Poll GET /api/oauth/:provider/status?flowId=xxx to check completion.

import { getOAuthProvider } from '@mariozechner/pi-ai/oauth'
import type { OAuthCredentials } from '@mariozechner/pi-ai/oauth'
import { saveConfig } from '../../../utils/config'

// In-memory store for pending OAuth flows
interface OAuthFlow {
  status: 'pending' | 'complete' | 'error'
  authUrl?: string
  credentials?: OAuthCredentials
  error?: string
}

// Shared across requests via module scope (Nitro keeps the module alive in dev)
const pendingFlows = new Map<string, OAuthFlow>()

// Export for the status endpoint to access
export { pendingFlows }

export default defineEventHandler(async (event) => {
  const provider = getRouterParam(event, 'provider')
  if (!provider) {
    throw createError({ statusCode: 400, statusMessage: 'Missing provider parameter' })
  }

  const oauthProvider = getOAuthProvider(provider)
  if (!oauthProvider) {
    throw createError({ statusCode: 404, statusMessage: `No OAuth provider found for: ${provider}` })
  }

  const flowId = crypto.randomUUID()
  const flow: OAuthFlow = { status: 'pending' }
  pendingFlows.set(flowId, flow)

  // Start the login flow in the background — it blocks until the user completes OAuth
  oauthProvider.login({
    onAuth: (info) => {
      flow.authUrl = info.url
      console.log(`[oauth] ${provider} login: visit ${info.url}`)
    },
    onPrompt: async (prompt) => {
      // For providers that need additional input (rare in browser flow)
      console.log(`[oauth] ${provider} prompt: ${prompt.message}`)
      return prompt.allowEmpty ? '' : ''
    },
    onProgress: (message) => {
      console.log(`[oauth] ${provider} progress: ${message}`)
    },
  }).then((credentials) => {
    flow.status = 'complete'
    flow.credentials = credentials

    // Persist OAuth credentials to config
    saveConfig({ oauth_credentials: { [provider]: credentials as any } })
    console.log(`[oauth] ${provider} login complete, credentials saved`)

    // Clean up after 5 minutes
    setTimeout(() => pendingFlows.delete(flowId), 5 * 60 * 1000)
  }).catch((err) => {
    flow.status = 'error'
    flow.error = err.message || String(err)
    console.error(`[oauth] ${provider} login failed:`, err)

    setTimeout(() => pendingFlows.delete(flowId), 5 * 60 * 1000)
  })

  // Wait briefly for onAuth to fire (usually immediate)
  await new Promise((resolve) => setTimeout(resolve, 2000))

  return {
    flowId,
    authUrl: flow.authUrl || null,
    status: flow.status,
  }
})
