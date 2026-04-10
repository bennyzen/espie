// In-memory device registry — tracks connected ESP32 devices with subscriber notification.
// Used by the dashboard to show device status in real time.

/** Transport interface for sending data to a connected device (text and binary). */
export interface DeviceTransport {
  sendText: (data: string) => void
  sendBinary: (data: Buffer | Uint8Array) => void
}

export interface ConnectedDevice {
  deviceId: string
  clientId: string
  sessionId: string
  connectedAt: number
  firmwareVersion?: string
  state: string
  /** Optional transport for sending data to the device (stored by WebSocket handler). */
  transport?: DeviceTransport
}

export class DeviceRegistry {
  private devices = new Map<string, ConnectedDevice>()
  private listeners = new Set<(devices: ConnectedDevice[]) => void>()

  /**
   * Register a connected device. Notifies all subscribers.
   */
  register(device: ConnectedDevice): void {
    this.devices.set(device.deviceId, device)
    console.log(`[device-registry] Registered ${device.deviceId} (${this.devices.size} total, ${this.listeners.size} listeners)`)
    this.notify()
  }

  /**
   * Unregister a device by its ID. Notifies all subscribers.
   */
  unregister(deviceId: string): void {
    this.devices.delete(deviceId)
    console.log(`[device-registry] Unregistered ${deviceId} (${this.devices.size} total)`)
    this.notify()
  }

  /**
   * Update fields on an existing device. Notifies all subscribers.
   */
  update(deviceId: string, updates: Partial<ConnectedDevice>): void {
    const device = this.devices.get(deviceId)
    if (device) {
      Object.assign(device, updates)
      this.notify()
    }
  }

  /**
   * Get a device by its ID. Returns undefined if not registered.
   */
  get(deviceId: string): ConnectedDevice | undefined {
    return this.devices.get(deviceId)
  }

  /**
   * Get all connected devices (includes transport — for internal use).
   */
  getAll(): ConnectedDevice[] {
    return Array.from(this.devices.values())
  }

  /**
   * Get all devices as serializable objects (strips transport functions for JSON).
   */
  getAllSerializable(): Omit<ConnectedDevice, 'transport'>[] {
    return Array.from(this.devices.values()).map(({ transport, ...rest }) => rest)
  }

  /**
   * Subscribe to device list changes. Returns an unsubscribe function.
   */
  subscribe(fn: (devices: ConnectedDevice[]) => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /**
   * Notify all subscribers with the current device list.
   */
  private notify(): void {
    const all = this.getAll()
    for (const fn of this.listeners) {
      fn(all)
    }
  }
}

/** Singleton device registry — cached on globalThis to survive Nitro code-splitting. */
export const deviceRegistry: DeviceRegistry =
  (globalThis as any).__espie_device_registry ||
  ((globalThis as any).__espie_device_registry = new DeviceRegistry())
