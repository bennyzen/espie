<script setup lang="ts">
const {
  step,
  logs,
  progress,
  chipInfo,
  errorMessage,
  boards,
  selectedBoard,
  selectBoard,
  isWebSerialSupported,
  isLinux,
  wifiSsid,
  wifiPassword,
  serverUrl,
  customFirmware,
  connect,
  flash,
  reset,
  retry,
} = useFlashWizard()

// Auto-scroll console
const consoleRef = ref<HTMLElement>()
watch(logs, () => {
  nextTick(() => {
    if (consoleRef.value) {
      consoleRef.value.scrollTop = consoleRef.value.scrollHeight
    }
  })
}, { deep: true })

// Copy logs to clipboard
function copyLogs() {
  const text = logs.value
    .map((l) => `[${new Date(l.timestamp).toISOString()}] [${l.level}] ${l.message}`)
    .join('\n')
  navigator.clipboard.writeText(text)
}

// File upload handler
function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) {
    customFirmware.value = input.files[0]
  }
}

// Step labels for indicator
const steps = ['Connect', 'Board', 'WiFi', 'Flash', 'Done']
const stepIndex = computed(() => {
  switch (step.value) {
    case 'idle': return 0
    case 'connecting': return 0
    case 'board-select': return 1
    case 'connected': return 2
    case 'flashing': return 3
    case 'complete': return 4
    case 'error': return -1
    default: return 0
  }
})

// Log entry color
function logColor(level: string): string {
  switch (level) {
    case 'success': return 'text-green-400'
    case 'warn': return 'text-yellow-400'
    case 'error': return 'text-red-400'
    default: return 'text-neutral-400'
  }
}
</script>

<template>
  <UCard class="mb-6">
    <template #header>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-usb" class="size-5" />
          <span class="font-semibold">Flash Firmware</span>
        </div>
        <!-- Step indicator -->
        <div v-if="step !== 'idle' && step !== 'error'" class="flex items-center gap-2">
          <template v-for="(label, i) in steps" :key="label">
            <div class="flex items-center gap-1.5">
              <div
                class="size-6 rounded-full flex items-center justify-center text-xs font-medium"
                :class="i < stepIndex ? 'bg-green-500 text-white'
                  : i === stepIndex ? 'bg-blue-500 text-white'
                  : 'bg-neutral-700 text-neutral-400'"
              >
                <UIcon v-if="i < stepIndex" name="i-lucide-check" class="size-3.5" />
                <span v-else>{{ i + 1 }}</span>
              </div>
              <span class="text-xs" :class="i <= stepIndex ? 'text-neutral-200' : 'text-neutral-500'">{{ label }}</span>
            </div>
            <div v-if="i < steps.length - 1" class="w-6 h-px bg-neutral-700" />
          </template>
        </div>
        <!-- Reset button -->
        <UButton
          v-if="step !== 'idle'"
          icon="i-lucide-x"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="reset"
        />
      </div>
    </template>

    <!-- Web Serial not supported -->
    <UAlert
      v-if="!isWebSerialSupported"
      color="warning"
      icon="i-lucide-shield-alert"
      title="Web Serial not available"
      description="Browser-based flashing requires HTTPS or localhost. Access this page via localhost, or set up an HTTPS reverse proxy (e.g. Caddy)."
      class="mb-4"
    />

    <!-- Step: Idle / Connect -->
    <div v-if="step === 'idle' || step === 'connecting'">
      <div class="flex items-center gap-4 mb-4">
        <UButton
          icon="i-lucide-usb"
          :loading="step === 'connecting'"
          :disabled="!isWebSerialSupported"
          size="lg"
          @click="connect"
        >
          Connect Device
        </UButton>
        <span class="text-neutral-500 text-sm">or</span>
        <label class="cursor-pointer">
          <input type="file" accept=".bin" class="hidden" @change="onFileSelected">
          <UButton
            as="span"
            icon="i-lucide-upload"
            color="neutral"
            variant="outline"
            size="sm"
          >
            Upload custom firmware...
          </UButton>
        </label>
      </div>

      <!-- Linux hint -->
      <UAlert
        v-if="isLinux"
        color="warning"
        variant="subtle"
        icon="i-lucide-terminal"
        class="mt-3"
      >
        <template #title>Linux users</template>
        <template #description>
          If the port isn't visible, run:
          <code class="bg-neutral-800 px-1.5 py-0.5 rounded text-xs">sudo chmod 666 /dev/ttyACM0</code>
          <br>
          For a permanent fix, add a udev rule:
          <code class="bg-neutral-800 px-1.5 py-0.5 rounded text-xs">SUBSYSTEM=="tty", ATTRS{idVendor}=="303a", MODE="0666"</code>
        </template>
      </UAlert>
    </div>

    <!-- Step: Board Select -->
    <div v-else-if="step === 'board-select'">
      <div class="flex items-center gap-2 mb-4">
        <UBadge color="success" variant="subtle">
          {{ chipInfo?.description || chipInfo?.chipName || 'Connected' }}
        </UBadge>
        <span class="text-xs text-neutral-500 font-mono">{{ chipInfo?.mac }}</span>
      </div>

      <div v-if="boards.length > 0">
        <p class="text-sm text-neutral-400 mb-3">Select your board:</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            v-for="board in boards"
            :key="board.id"
            class="text-left rounded-lg border p-4 transition-colors cursor-pointer"
            :class="selectedBoard?.id === board.id
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-neutral-700 hover:border-neutral-500 bg-neutral-900'"
            @click="selectBoard(board)"
          >
            <div class="font-medium text-sm">{{ board.name }}</div>
            <div class="text-xs text-neutral-400 mt-1">{{ board.description }}</div>
            <div class="text-xs text-neutral-500 mt-2">v{{ board.version }}</div>
          </button>
        </div>
      </div>

      <UAlert
        v-else
        color="warning"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        title="No supported boards"
        description="No firmware is available for this chip. Check that firmware binaries are present in the data/firmware/ directory."
      />
    </div>

    <!-- Step: Connected (WiFi config) -->
    <div v-else-if="step === 'connected'">
      <div class="flex items-center gap-2 mb-4">
        <UBadge color="success" variant="subtle">
          {{ chipInfo?.description || chipInfo?.chipName || 'Connected' }}
        </UBadge>
        <span class="text-xs text-neutral-500 font-mono">{{ chipInfo?.mac }}</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
        <UFormField label="WiFi Network (SSID)">
          <UInput v-model="wifiSsid" placeholder="Enter WiFi SSID" />
        </UFormField>
        <UFormField label="Password">
          <UInput v-model="wifiPassword" type="password" placeholder="Enter WiFi password" />
        </UFormField>
        <UFormField label="Server URL" class="sm:col-span-2">
          <UInput v-model="serverUrl" disabled />
        </UFormField>
      </div>

      <div class="flex items-center gap-3 mt-4">
        <UButton
          icon="i-lucide-zap"
          :disabled="!wifiSsid"
          size="lg"
          @click="flash"
        >
          Flash Firmware
        </UButton>
        <span v-if="selectedBoard" class="text-sm text-neutral-400">
          {{ selectedBoard.name }} v{{ selectedBoard.version }}
        </span>
        <span v-else-if="customFirmware" class="text-sm text-neutral-400">
          Custom: {{ customFirmware.name }} ({{ (customFirmware.size / 1024).toFixed(0) }} KB)
        </span>
        <UAlert
          v-else
          color="warning"
          variant="subtle"
          icon="i-lucide-alert-triangle"
          title="No firmware available"
          description="Run dev-ota.sh to prepare firmware files, or upload a custom binary."
          class="flex-1"
        />
      </div>
    </div>

    <!-- Step: Flashing -->
    <div v-else-if="step === 'flashing'">
      <div class="flex items-center gap-3 mb-3">
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-blue-400" />
        <span class="font-medium">Do not disconnect the device</span>
      </div>

      <div v-if="progress" class="mb-3">
        <div class="flex justify-between text-sm mb-1">
          <span class="text-neutral-400">
            Writing {{ progress.partName }}
            ({{ progress.partIndex + 1 }}/{{ progress.totalParts }})
          </span>
          <span class="text-blue-400">{{ progress.percent }}%</span>
        </div>
        <UProgress :value="progress.percent" size="sm" />
      </div>
    </div>

    <!-- Step: Complete -->
    <div v-else-if="step === 'complete'">
      <div class="flex items-center gap-3 mb-4">
        <div class="size-10 rounded-full bg-green-500/20 flex items-center justify-center">
          <UIcon name="i-lucide-check" class="size-5 text-green-400" />
        </div>
        <div>
          <div class="font-semibold">Device provisioned successfully!</div>
          <div class="text-sm text-neutral-400">Firmware flashed and WiFi configured. The device is rebooting.</div>
        </div>
      </div>

      <div class="bg-neutral-900 rounded-lg p-4 space-y-1.5 text-sm">
        <div v-if="selectedBoard" class="flex justify-between">
          <span class="text-green-400">Firmware</span>
          <span>{{ selectedBoard.name }} v{{ selectedBoard.version }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-green-400">WiFi</span>
          <span>{{ wifiSsid }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-green-400">Server</span>
          <span>{{ serverUrl }}</span>
        </div>
      </div>

      <p class="text-sm text-neutral-400 mt-3">
        <UIcon name="i-lucide-clock" class="size-4 inline" />
        Waiting for device to appear in the list below...
      </p>
    </div>

    <!-- Step: Error -->
    <div v-else-if="step === 'error'">
      <UAlert
        color="error"
        icon="i-lucide-alert-circle"
        :title="errorMessage"
        class="mb-3"
      />
      <UButton icon="i-lucide-refresh-cw" variant="outline" @click="retry">
        Try Again
      </UButton>
    </div>

    <!-- Console panel — visible whenever there are logs -->
    <div v-if="logs.length > 0" class="mt-4">
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs text-neutral-500 uppercase tracking-wider">Console</span>
        <UButton
          icon="i-lucide-clipboard-copy"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="copyLogs"
        >
          Copy
        </UButton>
      </div>
      <div
        ref="consoleRef"
        class="bg-neutral-950 rounded-lg p-3 font-mono text-xs leading-relaxed max-h-48 overflow-y-auto border border-neutral-800"
      >
        <div v-for="(entry, i) in logs" :key="i" :class="logColor(entry.level)">
          <span class="text-neutral-600 select-none">{{ new Date(entry.timestamp).toLocaleTimeString() }}</span>
          {{ entry.message }}
        </div>
      </div>
    </div>
  </UCard>
</template>
