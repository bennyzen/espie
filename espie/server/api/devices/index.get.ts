import { deviceRegistry } from '../../utils/device-registry'

export default defineEventHandler(() => {
  return {
    devices: deviceRegistry.getAllSerializable(),
  }
})
