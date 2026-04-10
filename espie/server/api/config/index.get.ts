import { loadConfigMasked } from '../../utils/config'

export default defineEventHandler(() => {
  return loadConfigMasked()
})
