<script setup lang="ts">
interface Schedule {
  id: string
  name: string
  cron: string
  prompt: string
  enabled: boolean
  timezone: string | null
  last_run_at: number | null
  created_at: number
  updated_at: number
}

interface TaskForm {
  id?: string
  name: string
  frequency: 'daily' | 'weekdays' | 'weekends' | 'hourly'
  hour: number
  minute: number
  prompt: string
  enabled: boolean
}

const frequencies = [
  { label: 'Every day', value: 'daily' },
  { label: 'Weekdays (Mon-Fri)', value: 'weekdays' },
  { label: 'Weekends (Sat-Sun)', value: 'weekends' },
  { label: 'Every hour', value: 'hourly' },
]

const hours = Array.from({ length: 24 }, (_, i) => ({
  label: i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`,
  value: i,
}))

const minutes = [
  { label: ':00', value: 0 },
  { label: ':15', value: 15 },
  { label: ':30', value: 30 },
  { label: ':45', value: 45 },
]

function toCron(form: TaskForm): string {
  switch (form.frequency) {
    case 'daily': return `${form.minute} ${form.hour} * * *`
    case 'weekdays': return `${form.minute} ${form.hour} * * 1-5`
    case 'weekends': return `${form.minute} ${form.hour} * * 0,6`
    case 'hourly': return `${form.minute} * * * *`
    default: return `${form.minute} ${form.hour} * * *`
  }
}

function fromCron(cron: string): { frequency: TaskForm['frequency']; hour: number; minute: number } {
  const parts = cron.split(' ')
  if (parts.length !== 5) return { frequency: 'daily', hour: 7, minute: 0 }

  const minute = parseInt(parts[0]!) || 0
  const hour = parts[1] === '*' ? 0 : parseInt(parts[1]!) || 0
  const dow = parts[4]

  let frequency: TaskForm['frequency'] = 'daily'
  if (parts[1] === '*') frequency = 'hourly'
  else if (dow === '1-5') frequency = 'weekdays'
  else if (dow === '0,6' || dow === '6,0') frequency = 'weekends'

  return { frequency, hour, minute }
}

const toast = useToast()
const saving = ref(false)
const tasks = ref<TaskForm[]>([])

const { data: schedules, refresh } = await useFetch<Schedule[]>('/api/schedules')

watchEffect(() => {
  if (schedules.value) {
    tasks.value = schedules.value.map(s => {
      const parsed = fromCron(s.cron)
      return {
        id: s.id,
        name: s.name,
        frequency: parsed.frequency,
        hour: parsed.hour,
        minute: parsed.minute,
        prompt: s.prompt,
        enabled: s.enabled,
      }
    })
  }
})

function add() {
  tasks.value.push({ name: '', frequency: 'daily', hour: 7, minute: 0, prompt: '', enabled: true })
}

async function remove(index: number) {
  const task = tasks.value[index]
  if (task?.id) {
    try {
      await $fetch(`/api/schedules/${task.id}`, { method: 'DELETE' })
    } catch (err) {
      toast.add({ title: 'Failed to delete', color: 'error', description: String(err) })
      return
    }
  }
  tasks.value.splice(index, 1)
}

function describeSchedule(task: TaskForm): string {
  const time = hours.find(h => h.value === task.hour)?.label || `${task.hour}:00`
  const min = task.minute > 0 ? `:${String(task.minute).padStart(2, '0')}` : ''
  const timeStr = time.replace(/ (AM|PM)/, min + ' $1')
  switch (task.frequency) {
    case 'daily': return `Every day at ${timeStr}`
    case 'weekdays': return `Weekdays at ${timeStr}`
    case 'weekends': return `Weekends at ${timeStr}`
    case 'hourly': return `Every hour at :${String(task.minute).padStart(2, '0')}`
    default: return ''
  }
}

async function save() {
  saving.value = true
  try {
    // Create or update each task
    for (const task of tasks.value) {
      if (!task.name || !task.prompt) continue
      const body = { name: task.name, cron: toCron(task), prompt: task.prompt, enabled: task.enabled }

      if (task.id) {
        await $fetch(`/api/schedules/${task.id}`, { method: 'PUT', body })
      } else {
        await $fetch('/api/schedules', { method: 'POST', body })
      }
    }

    await refresh()
    toast.add({ title: 'Schedules saved. Changes take effect within a minute.', color: 'success' })
  } catch (err) {
    toast.add({ title: 'Failed to save', color: 'error', description: String(err) })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl p-6 space-y-4">
    <div class="flex items-center justify-between">
      <p class="text-sm text-neutral-400">
        Espie can proactively speak to you on a schedule. She has full access to Home Assistant and memory when doing so.
      </p>
      <UButton size="xs" icon="i-lucide-plus" label="Add Task" @click="add" />
    </div>

    <p v-if="tasks.length === 0" class="text-sm text-neutral-500 py-8 text-center">
      No scheduled tasks. Add one to have Espie check in with you automatically.
    </p>

    <div v-for="(task, i) in tasks" :key="task.id || i" class="p-4 rounded-lg border border-neutral-700 space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <USwitch v-model="task.enabled" size="sm" />
          <span class="text-xs text-neutral-500">{{ describeSchedule(task) }}</span>
        </div>
        <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="remove(i)" />
      </div>

      <UFormField label="Name">
        <UInput v-model="task.name" placeholder="Morning briefing" class="w-full" />
      </UFormField>

      <div class="grid grid-cols-3 gap-3">
        <UFormField label="Frequency">
          <USelect v-model="task.frequency" :items="frequencies" value-key="value" class="w-full" />
        </UFormField>
        <UFormField v-if="task.frequency !== 'hourly'" label="Hour">
          <USelect v-model="task.hour" :items="hours" value-key="value" class="w-full" />
        </UFormField>
        <UFormField label="Minute">
          <USelect v-model="task.minute" :items="minutes" value-key="value" class="w-full" />
        </UFormField>
      </div>

      <UFormField label="What should Espie say?">
        <UTextarea v-model="task.prompt" :rows="2" autoresize placeholder="Good morning! Give a brief friendly greeting and mention the time." class="w-full" />
      </UFormField>
    </div>

    <UButton v-if="tasks.length > 0" label="Save Tasks" :loading="saving" @click="save" />
  </div>
</template>
