// Polyfill crypto.randomUUID for non-secure contexts (HTTP).
// Vue 3.5+ and NuxtUI use crypto.randomUUID() internally for component IDs.
// When accessed over plain HTTP (e.g. http://homeassistant.local:8000/),
// some browsers don't expose randomUUID outside secure contexts.

export default defineNuxtPlugin(() => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
    crypto.randomUUID = () =>
      '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
        (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16),
      ) as `${string}-${string}-${string}-${string}-${string}`
  }
})
