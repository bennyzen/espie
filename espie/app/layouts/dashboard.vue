<script setup lang="ts">
const route = useRoute()

const navItems = computed(() => [[
  { label: 'Chat', icon: 'i-lucide-message-circle', to: '/chat' },
  { label: 'Sessions', icon: 'i-lucide-history', to: '/sessions' },
  { label: 'Memory', icon: 'i-lucide-brain', to: '/memory' },
  { label: 'Music', icon: 'i-lucide-music', to: '/music' },
  { label: 'Devices', icon: 'i-lucide-cpu', to: '/devices' },
  { label: 'Tasks', icon: 'i-lucide-clock', to: '/tasks' },
  { label: 'Config', icon: 'i-lucide-settings', to: '/config' },
  { label: 'Logs', icon: 'i-lucide-scroll-text', to: '/logs' },
]])

const pageTitle = computed(() => {
  const segments = route.path.replace(/^\//, '').split('/').filter(Boolean)
  if (segments.length === 0) return 'Chat'
  return segments.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' / ')
})
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible>
      <template #header="{ collapsed }">
        <span v-if="!collapsed" class="text-lg font-bold px-2">Espie</span>
        <UIcon v-else name="i-lucide-bot" class="size-6" />
      </template>

      <UNavigationMenu :items="navItems" orientation="vertical" />

      <template #footer>
        <UColorModeButton />
      </template>
    </UDashboardSidebar>

    <UDashboardPanel :ui="{ body: 'p-0! gap-0! flex flex-col flex-1 overflow-hidden' }">
      <template #header>
        <UDashboardNavbar :title="pageTitle" />
      </template>

      <template #body>
        <slot />
      </template>
    </UDashboardPanel>
  </UDashboardGroup>
</template>
