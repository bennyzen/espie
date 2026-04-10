import { describe, it, expect, vi } from 'vitest'
import { DeviceRegistry } from '../../server/utils/device-registry'
import type { ConnectedDevice } from '../../server/utils/device-registry'

describe('DeviceRegistry', () => {
  function makeDevice(overrides: Partial<ConnectedDevice> = {}): ConnectedDevice {
    return {
      deviceId: 'dev-001',
      clientId: 'cli-001',
      sessionId: 'sess-001',
      connectedAt: Date.now(),
      state: 'connected',
      ...overrides,
    }
  }

  it('getAll() returns empty array initially', () => {
    const registry = new DeviceRegistry()
    expect(registry.getAll()).toEqual([])
  })

  it('register() adds device, getAll() returns it', () => {
    const registry = new DeviceRegistry()
    const device = makeDevice()

    registry.register(device)

    const all = registry.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].deviceId).toBe('dev-001')
  })

  it('unregister() removes device', () => {
    const registry = new DeviceRegistry()
    const device = makeDevice()

    registry.register(device)
    registry.unregister('dev-001')

    expect(registry.getAll()).toHaveLength(0)
  })

  it('subscribe() notified on register', () => {
    const registry = new DeviceRegistry()
    const listener = vi.fn()

    registry.subscribe(listener)
    registry.register(makeDevice())

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith([expect.objectContaining({ deviceId: 'dev-001' })])
  })

  it('subscribe() notified on unregister', () => {
    const registry = new DeviceRegistry()
    const listener = vi.fn()

    registry.register(makeDevice())
    registry.subscribe(listener)
    registry.unregister('dev-001')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith([])
  })

  it('unsubscribe stops notifications', () => {
    const registry = new DeviceRegistry()
    const listener = vi.fn()

    const unsub = registry.subscribe(listener)
    unsub()
    registry.register(makeDevice())

    expect(listener).not.toHaveBeenCalled()
  })

  it('update() modifies existing device state', () => {
    const registry = new DeviceRegistry()
    registry.register(makeDevice())

    registry.update('dev-001', { state: 'listening' })

    const device = registry.get('dev-001')
    expect(device?.state).toBe('listening')
  })

  it('update() notifies subscribers', () => {
    const registry = new DeviceRegistry()
    const listener = vi.fn()
    registry.register(makeDevice())
    registry.subscribe(listener)

    registry.update('dev-001', { state: 'processing' })

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('get() returns undefined for unknown device', () => {
    const registry = new DeviceRegistry()
    expect(registry.get('nonexistent')).toBeUndefined()
  })
})
