<script setup lang="ts">
const toast = useToast()
const saving = ref(false)

const timezone = ref('')
const location = ref('')
const wifiSsid = ref('')
const wifiPassword = ref('')

const timezones = Intl.supportedValuesOf('timeZone')

const { data: config } = await useFetch<{ timezone?: string; location?: string; wifi?: { ssid?: string; password?: string } }>('/api/config')

watchEffect(() => {
  if (config.value) {
    timezone.value = config.value.timezone || ''
    location.value = config.value.location || ''
    wifiSsid.value = config.value.wifi?.ssid || ''
    wifiPassword.value = config.value.wifi?.password || ''
  }
})

async function save() {
  saving.value = true
  try {
    await $fetch('/api/config', {
      method: 'PUT',
      body: {
        timezone: timezone.value || undefined,
        location: location.value || undefined,
        wifi: wifiSsid.value ? {
          ssid: wifiSsid.value,
          password: wifiPassword.value || undefined,
        } : undefined,
      },
    })
    toast.add({ title: 'Settings saved', color: 'success' })
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
      Where Espie is. Used for weather, time-aware prompts, and scheduled tasks.
    </p>

    <div class="space-y-3 max-w-sm">
      <UFormField label="Location">
        <UInput v-model="location" placeholder="Melbourne, AU" class="w-full" />
      </UFormField>
      <UFormField label="Timezone">
        <USelectMenu
          v-model="timezone"
          :items="timezones"
          placeholder="Select timezone..."
          searchable
          class="w-full"
        />
      </UFormField>
      <p class="text-xs text-neutral-500">
        Leave timezone empty to use server local time.
      </p>
    </div>

    <div class="border-t border-neutral-200 dark:border-neutral-800 pt-6">
      <p class="text-sm text-neutral-400 mb-3">
        WiFi credentials baked into firmware builds. Used by <code>dev-ota.sh</code> so the device auto-connects after a flash erase.
      </p>
      <div class="space-y-3 max-w-sm">
        <UFormField label="WiFi SSID">
          <UInput v-model="wifiSsid" placeholder="your-network" class="w-full" />
        </UFormField>
        <UFormField label="WiFi Password">
          <UInput v-model="wifiPassword" placeholder="password" class="w-full" />
        </UFormField>
      </div>
    </div>

    <UButton label="Save" :loading="saving" @click="save" />
  </div>
</template>
