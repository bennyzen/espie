<script setup lang="ts">
interface HATestResult {
  ok: boolean
  name?: string
  version?: string
  entityCount?: number
  error?: string
}

const toast = useToast()
const saving = ref(false)
const testing = ref(false)
const testResult = ref<HATestResult | null>(null)

const baseUrl = ref('')
const token = ref('')
const fromEnv = ref(false)

const { data: config } = await useFetch<{ home_assistant?: { base_url?: string; token?: string } }>('/api/config')
const { data: envConfig } = await useFetch<{ base_url: string; token: string }>('/api/home-assistant/env')

watchEffect(() => {
  const yamlUrl = config.value?.home_assistant?.base_url
  const envUrl = envConfig.value?.base_url
  const envToken = envConfig.value?.token

  if (yamlUrl) {
    baseUrl.value = yamlUrl
    fromEnv.value = false
  } else if (envUrl || envToken) {
    if (envUrl) baseUrl.value = envUrl
    if (envToken) token.value = envToken
    fromEnv.value = true
  }
})

// Track whether the user has typed a new token (vs the saved masked one)
const tokenDirty = ref(false)
watch(token, () => { tokenDirty.value = true })

async function test() {
  testResult.value = null
  testing.value = true
  try {
    testResult.value = await $fetch<HATestResult>('/api/home-assistant/test', {
      method: 'POST',
      body: { base_url: baseUrl.value, token: token.value },
    })
  } catch (err) {
    testResult.value = { ok: false, error: String(err) }
  } finally {
    testing.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const body: Record<string, any> = {
      home_assistant: {
        base_url: baseUrl.value || undefined,
      },
    }
    // Only include token if user typed a new one
    if (tokenDirty.value && token.value) {
      body.home_assistant.token = token.value
    }
    await $fetch('/api/config', { method: 'PUT', body })
    toast.add({ title: 'Home Assistant config saved', color: 'success' })
  } catch (err) {
    toast.add({ title: 'Failed to save', color: 'error', description: String(err) })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl p-6 space-y-6">
    <p class="text-sm text-neutral-400">
      Connect to your Home Assistant instance for smart home control. Espie can check sensors, toggle lights, trigger automations, and more.
    </p>

    <div v-if="fromEnv" class="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 text-blue-400 text-sm max-w-lg">
      <UIcon name="i-lucide-info" class="size-4 mt-0.5 shrink-0" />
      <span>Values below are from your <code class="font-mono text-xs">.env</code> file (HA_BASE_URL{{ envConfig?.token ? ', HA_TOKEN' : '' }}). Save here to override them via config.</span>
    </div>

    <div class="space-y-3 max-w-lg">
      <UFormField label="Base URL">
        <UInput v-model="baseUrl" placeholder="http://homeassistant.local:8123" class="w-full" />
      </UFormField>

      <UFormField label="Long-Lived Access Token">
        <UInput v-model="token" placeholder="eyJhbGciOiJIUzI1NiIs..." class="w-full font-mono text-xs" />
        <template #hint>
          <span class="text-xs text-neutral-500">
            Create one in HA: Profile &rarr; Security &rarr; Long-Lived Access Tokens
          </span>
        </template>
      </UFormField>
    </div>

    <div class="flex items-center gap-3">
      <UButton
        label="Test Connection"
        icon="i-lucide-plug"
        variant="outline"
        :loading="testing"
        :disabled="!baseUrl || !token"
        @click="test"
      />
      <UButton label="Save" :loading="saving" @click="save" />
    </div>

    <!-- Test result -->
    <div v-if="testResult" class="max-w-lg">
      <div
        v-if="testResult.ok"
        class="p-4 rounded-lg border border-green-700 bg-green-950/30 space-y-1"
      >
        <div class="flex items-center gap-2 text-green-400 font-medium">
          <UIcon name="i-lucide-check-circle" class="size-5" />
          Connected
        </div>
        <p class="text-sm text-neutral-300">
          {{ testResult.name }} &mdash; Home Assistant {{ testResult.version }}
        </p>
        <p class="text-sm text-neutral-400">
          {{ testResult.entityCount }} entities available
        </p>
      </div>
      <div v-else class="p-4 rounded-lg border border-red-700 bg-red-950/30">
        <div class="flex items-center gap-2 text-red-400 font-medium">
          <UIcon name="i-lucide-x-circle" class="size-5" />
          Connection failed
        </div>
        <p class="text-sm text-neutral-300 mt-1">{{ testResult.error }}</p>
      </div>
    </div>
  </div>
</template>
