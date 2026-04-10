// GET /api/oauth/:provider/status?flowId=xxx — polls OAuth login flow status.
// Returns { status: 'pending' | 'complete' | 'error', error? }

import { pendingFlows } from './login.post'

export default defineEventHandler((event) => {
  const provider = getRouterParam(event, 'provider')
  const query = getQuery(event)
  const flowId = query.flowId as string

  if (!provider || !flowId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing provider or flowId parameter' })
  }

  const flow = pendingFlows.get(flowId)
  if (!flow) {
    throw createError({ statusCode: 404, statusMessage: 'Flow not found or expired' })
  }

  return {
    status: flow.status,
    authUrl: flow.authUrl || null,
    error: flow.error || null,
  }
})
