<script setup lang="ts">
const toast = useToast()
const saving = ref(false)
const systemPrompt = ref('')

const { data: personality } = await useFetch<{ system_prompt: string }>('/api/personality')

watchEffect(() => {
  if (personality.value) {
    systemPrompt.value = personality.value.system_prompt || ''
  }
})

async function save() {
  saving.value = true
  try {
    await $fetch('/api/personality', { method: 'PUT', body: { system_prompt: systemPrompt.value } })
    toast.add({ title: 'Personality saved', color: 'success' })
  } catch (err) {
    toast.add({ title: 'Failed to save', color: 'error', description: String(err) })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl p-6 space-y-4">
    <p class="text-sm text-neutral-400">
      Define how Espie speaks and behaves. This system prompt is sent with every conversation.
    </p>

    <UTextarea
      v-model="systemPrompt"
      autoresize
      :rows="10"
      placeholder="You are Espie, a warm and witty voice assistant..."
      class="w-full"
    />

    <UButton label="Save" :loading="saving" @click="save" />
  </div>
</template>
