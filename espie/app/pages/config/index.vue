<script setup lang="ts">
const cards = [
  {
    title: 'Providers',
    description: 'LLM, speech-to-text, and text-to-speech providers, models, and API keys.',
    icon: 'i-lucide-blocks',
    to: '/config/providers',
  },
  {
    title: 'Personality',
    description: 'Define how Espie speaks and behaves. Her voice, tone, and character.',
    icon: 'i-lucide-sparkles',
    to: '/config/personality',
  },
  {
    title: 'Home Assistant',
    description: 'Connect to Home Assistant for smart home control — lights, sensors, automations.',
    icon: 'i-lucide-house',
    to: '/config/home-assistant',
  },
{
    title: 'Settings',
    description: 'Location, timezone, and general preferences.',
    icon: 'i-lucide-settings',
    to: '/config/settings',
  },
]
</script>

<template>
  <div class="max-w-3xl p-6">
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <UCard
        v-for="card in cards"
        :key="card.to"
        variant="subtle"
        class="hover:ring-primary cursor-pointer transition"
        @click="navigateTo(card.to)"
      >
        <div class="flex flex-col items-center text-center gap-3 py-4">
          <UIcon :name="card.icon" class="size-10 text-primary" />
          <div>
            <p class="font-semibold">{{ card.title }}</p>
            <p class="text-sm text-neutral-400 mt-1">{{ card.description }}</p>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
