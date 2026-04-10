<script setup lang="ts">
interface ProviderModel {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
}

interface ProviderInfo {
  id: string
  authType: 'api_key' | 'oauth'
  envVar: string | null
  modelCount: number
  models: ProviderModel[]
}

interface AudioProviderInfo {
  id: string
  name: string
  envVar: string | null
  models?: { id: string; name: string }[]
  voices?: { id: string; name: string }[]
}

interface ProviderConfig {
  llm: { provider: string; model: string }
  asr: { provider: string; model?: string }
  tts: { provider: string; voice?: string }
  api_keys?: Record<string, string>
  oauth_credentials?: Record<string, { expires: number }>
}

const toast = useToast()

// Fetch available providers from pi-ai
const { data: providerData } = await useFetch<{ providers: ProviderInfo[] }>('/api/providers')
const allProviders = computed(() => providerData.value?.providers || [])

// Group providers for the LLM dropdown — show popular ones first
const popularProviderIds = ['anthropic', 'openai', 'google', 'groq', 'mistral', 'xai', 'openrouter']

const llmProviderItems = computed(() => {
  const popular = allProviders.value.filter((p) => popularProviderIds.includes(p.id))
  const rest = allProviders.value.filter((p) => !popularProviderIds.includes(p.id))
  return [...popular, ...rest].map((p) => ({
    label: `${p.id} (${p.modelCount} models)`,
    value: p.id,
  }))
})

// Fetch audio providers (ASR + TTS)
const { data: audioData } = await useFetch<{ asr: AudioProviderInfo[]; tts: AudioProviderInfo[] }>('/api/providers/audio')

const asrProviderItems = computed(() => (audioData.value?.asr || []).map((p) => ({ label: p.name, value: p.id })))
const ttsProviderItems = computed(() => (audioData.value?.tts || []).map((p) => ({ label: p.name, value: p.id })))

const currentAsrInfo = computed(() => audioData.value?.asr?.find((p) => p.id === asrProvider.value))
const asrModelItems = computed(() => (currentAsrInfo.value?.models || []).map((m) => ({ label: m.name, value: m.id })))

const currentTtsInfo = computed(() => audioData.value?.tts?.find((p) => p.id === ttsProvider.value))
const ttsVoiceItems = computed(() => (currentTtsInfo.value?.voices || []).map((v) => ({ label: v.name, value: v.id })))

// Reactive form state
const llmProvider = ref('anthropic')
const llmModel = ref('claude-sonnet-4-20250514')
const asrProvider = ref('groq')
const asrModel = ref('whisper-large-v3-turbo')
const ttsProvider = ref('edge')
const ttsVoice = ref('en-US-AndrewMultilingualNeural')
const apiKeys = ref<Record<string, string>>({})

const savingLlm = ref(false)
const savingAsr = ref(false)
const savingTts = ref(false)

// OAuth state
const oauthLoading = ref<Record<string, boolean>>({})

// Load current config
const { data: config, refresh: refreshConfig } = await useFetch<ProviderConfig>('/api/config')

// Populate form fields when data loads
watchEffect(() => {
  if (config.value) {
    llmProvider.value = config.value.llm?.provider || 'anthropic'
    llmModel.value = config.value.llm?.model || 'claude-sonnet-4-20250514'
    asrProvider.value = config.value.asr?.provider || 'groq'
    asrModel.value = config.value.asr?.model || 'whisper-large-v3-turbo'
    ttsProvider.value = config.value.tts?.provider || 'edge'
    ttsVoice.value = config.value.tts?.voice || 'en-US-AndrewMultilingualNeural'
    if (config.value.api_keys) {
      apiKeys.value = { ...config.value.api_keys }
    }
  }
})

// Models for the currently selected LLM provider
const currentProviderInfo = computed(() => allProviders.value.find((p) => p.id === llmProvider.value))
const modelItems = computed(() => {
  if (!currentProviderInfo.value) return []
  return currentProviderInfo.value.models.map((m) => ({
    label: `${m.id}${m.reasoning ? ' (reasoning)' : ''}`,
    value: m.id,
  }))
})

// Sensible default models per provider
const defaultModels: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  google: 'gemini-2.5-flash',
  groq: 'llama-3.3-70b-versatile',
  mistral: 'mistral-large-latest',
  xai: 'grok-3',
  openrouter: 'anthropic/claude-sonnet-4.5',
  'github-copilot': 'claude-sonnet-4.5',
}

// Reset model when provider changes
watch(llmProvider, (newProvider) => {
  const info = allProviders.value.find((p) => p.id === newProvider)
  if (info && info.models.length > 0) {
    const preferred = defaultModels[newProvider]
    const hasPreferred = preferred && info.models.some((m) => m.id === preferred)
    llmModel.value = hasPreferred ? preferred! : info.models[0].id
  }
})

// Determine what auth the LLM provider needs
const llmAuthType = computed(() => currentProviderInfo.value?.authType || 'api_key')
const llmEnvVar = computed(() => currentProviderInfo.value?.envVar)

// Check if this provider has stored OAuth credentials
const hasOAuthCredentials = computed(() => {
  return !!config.value?.oauth_credentials?.[llmProvider.value]
})

const oauthExpiry = computed(() => {
  const cred = config.value?.oauth_credentials?.[llmProvider.value]
  if (!cred) return null
  return new Date(cred.expires).toLocaleString()
})

// Tab definitions
const tabs = [
  { label: 'LLM', value: 'llm', icon: 'i-lucide-brain' },
  { label: 'ASR', value: 'asr', icon: 'i-lucide-mic' },
  { label: 'TTS', value: 'tts', icon: 'i-lucide-volume-2' },
]

// Save handlers
async function saveLlm() {
  savingLlm.value = true
  try {
    const body: Record<string, any> = {
      llm: { provider: llmProvider.value, model: llmModel.value },
    }
    const key = apiKeys.value[llmProvider.value]
    if (key && !key.includes('***')) {
      body.api_keys = { [llmProvider.value]: key }
    }
    await $fetch('/api/config', { method: 'PUT', body })
    toast.add({ title: 'LLM config saved', color: 'success' })
  } catch (err) {
    toast.add({ title: 'Failed to save', color: 'error', description: String(err) })
  } finally {
    savingLlm.value = false
  }
}

async function saveAsr() {
  savingAsr.value = true
  try {
    const body: Record<string, any> = {
      asr: { provider: asrProvider.value, model: asrModel.value },
    }
    const key = apiKeys.value[asrProvider.value]
    if (key && !key.includes('***')) {
      body.api_keys = { [asrProvider.value]: key }
    }
    await $fetch('/api/config', { method: 'PUT', body })
    toast.add({ title: 'ASR config saved', color: 'success' })
  } catch (err) {
    toast.add({ title: 'Failed to save', color: 'error', description: String(err) })
  } finally {
    savingAsr.value = false
  }
}

async function saveTts() {
  savingTts.value = true
  try {
    const body: Record<string, any> = {
      tts: { provider: ttsProvider.value, voice: ttsVoice.value },
    }
    if (ttsProvider.value === 'openai') {
      const key = apiKeys.value.openai
      if (key && !key.includes('***')) {
        body.api_keys = { openai: key }
      }
    }
    await $fetch('/api/config', { method: 'PUT', body })
    toast.add({ title: 'TTS config saved', color: 'success' })
  } catch (err) {
    toast.add({ title: 'Failed to save', color: 'error', description: String(err) })
  } finally {
    savingTts.value = false
  }
}

// OAuth login flow
async function startOAuthLogin(provider: string) {
  oauthLoading.value[provider] = true
  try {
    const result = await $fetch<{ flowId: string; authUrl: string | null; status: string }>(
      `/api/oauth/${provider}/login`,
      { method: 'POST' },
    )

    if (result.authUrl) {
      window.open(result.authUrl, '_blank', 'width=600,height=700')
      toast.add({ title: 'Complete login in the new window', color: 'info' })
      pollOAuthStatus(provider, result.flowId)
    } else {
      toast.add({ title: 'Failed to start OAuth', color: 'error', description: 'No auth URL returned' })
    }
  } catch (err) {
    toast.add({ title: 'OAuth login failed', color: 'error', description: String(err) })
  } finally {
    oauthLoading.value[provider] = false
  }
}

async function pollOAuthStatus(provider: string, flowId: string) {
  const maxAttempts = 120
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      const status = await $fetch<{ status: string; error: string | null }>(
        `/api/oauth/${provider}/status`,
        { query: { flowId } },
      )
      if (status.status === 'complete') {
        toast.add({ title: `${provider} connected!`, color: 'success' })
        await refreshConfig()
        return
      }
      if (status.status === 'error') {
        toast.add({ title: 'OAuth failed', color: 'error', description: status.error || 'Unknown error' })
        return
      }
    } catch {
      // Polling error — keep trying
    }
  }
  toast.add({ title: 'OAuth timed out', color: 'warning' })
}

async function disconnectOAuth(provider: string) {
  try {
    await $fetch(`/api/oauth/${provider}/disconnect`, { method: 'POST' })
    toast.add({ title: `${provider} disconnected`, color: 'success' })
    await refreshConfig()
  } catch (err) {
    toast.add({ title: 'Disconnect failed', color: 'error', description: String(err) })
  }
}
</script>

<template>
  <div class="max-w-3xl p-6 space-y-4">
    <UTabs :items="tabs" default-value="llm" class="w-full">
      <template #content="{ item }">
        <div class="pt-4 space-y-4">
          <!-- LLM Tab -->
          <template v-if="item.value === 'llm'">
            <UFormField label="Provider">
              <USelect
                v-model="llmProvider"
                :items="llmProviderItems"
                value-key="value"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Model">
              <USelect
                v-model="llmModel"
                :items="modelItems"
                value-key="value"
                class="w-full"
              />
            </UFormField>

            <!-- Auth section — depends on provider type -->
            <div v-if="llmAuthType === 'oauth'" class="space-y-3">
              <div v-if="hasOAuthCredentials" class="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <UIcon name="i-lucide-check-circle" class="size-5 text-green-500" />
                <div class="flex-1">
                  <p class="text-sm font-medium text-green-400">Connected via OAuth</p>
                  <p v-if="oauthExpiry" class="text-xs text-neutral-500">Token expires: {{ oauthExpiry }}</p>
                </div>
                <UButton size="xs" color="error" variant="ghost" label="Disconnect" @click="disconnectOAuth(llmProvider)" />
              </div>
              <div v-else class="space-y-2">
                <p class="text-sm text-neutral-400">
                  This provider requires OAuth login. You can also provide an API key below.
                </p>
                <UButton
                  :loading="oauthLoading[llmProvider]"
                  icon="i-lucide-external-link"
                  :label="`Login with ${llmProvider}`"
                  @click="startOAuthLogin(llmProvider)"
                />
              </div>

              <UFormField :label="`${llmProvider} API Key (optional override)`">
                <UInput
                  v-model="apiKeys[llmProvider]"
                  type="password"
                  :placeholder="llmEnvVar ? `Or set ${llmEnvVar} env var` : 'Enter API key'"
                  class="w-full"
                />
              </UFormField>
            </div>

            <div v-else>
              <UFormField :label="`${llmProvider} API Key`">
                <UInput
                  v-model="apiKeys[llmProvider]"
                  type="password"
                  :placeholder="llmEnvVar ? `Or set ${llmEnvVar} env var` : 'Enter API key'"
                  class="w-full"
                />
              </UFormField>
            </div>

            <UButton label="Save LLM" :loading="savingLlm" @click="saveLlm" />
          </template>

          <!-- ASR Tab -->
          <template v-if="item.value === 'asr'">
            <UFormField label="Provider">
              <USelect v-model="asrProvider" :items="asrProviderItems" value-key="value" class="w-full" />
            </UFormField>

            <UFormField v-if="asrModelItems.length > 0" label="Model">
              <USelect v-model="asrModel" :items="asrModelItems" value-key="value" class="w-full" />
            </UFormField>

            <UFormField :label="`${currentAsrInfo?.name || asrProvider} API Key`">
              <UInput
                v-model="apiKeys[asrProvider]"
                type="password"
                :placeholder="currentAsrInfo?.envVar ? `Or set ${currentAsrInfo.envVar} env var` : 'Enter API key'"
                class="w-full"
              />
            </UFormField>

            <UButton label="Save ASR" :loading="savingAsr" @click="saveAsr" />
          </template>

          <!-- TTS Tab -->
          <template v-if="item.value === 'tts'">
            <UFormField label="Provider">
              <USelect v-model="ttsProvider" :items="ttsProviderItems" value-key="value" class="w-full" />
            </UFormField>

            <UFormField v-if="ttsVoiceItems.length > 0" label="Voice">
              <USelect v-model="ttsVoice" :items="ttsVoiceItems" value-key="value" class="w-full" />
            </UFormField>

            <template v-if="ttsProvider === 'openai'">
              <UFormField label="OpenAI API Key">
                <UInput
                  v-model="apiKeys.openai"
                  type="password"
                  placeholder="Or set OPENAI_API_KEY env var"
                  class="w-full"
                />
              </UFormField>
            </template>

            <p v-if="ttsProvider === 'edge'" class="text-sm text-neutral-500">
              Edge TTS is free and requires no API key.
            </p>

            <UButton label="Save TTS" :loading="savingTts" @click="saveTts" />
          </template>
        </div>
      </template>
    </UTabs>
  </div>
</template>
