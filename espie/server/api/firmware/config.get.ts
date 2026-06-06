import os from 'node:os'
import { loadConfig } from '../../utils/config'

// Pick the most likely LAN address of this machine, skipping loopback and
// virtual interfaces (docker bridges, veth pairs, etc.) that a device on the
// WiFi network could never reach. Prefer common private LAN ranges.
function getLanIp(): string | null {
  const skip = /^(docker|br-|veth|virbr|lo|tun|tap|cni|flannel)/
  const candidates: string[] = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (skip.test(name)) continue
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) candidates.push(addr.address)
    }
  }
  return (
    candidates.find((ip) => ip.startsWith('192.168.')) ||
    candidates.find((ip) => ip.startsWith('10.')) ||
    candidates.find((ip) => ip.startsWith('172.')) ||
    candidates[0] ||
    null
  )
}

export default defineEventHandler((event) => {
  const config = loadConfig()

  const hostHeader = getRequestHeader(event, 'host') || 'localhost:8000'
  const proto = getRequestHeader(event, 'x-forwarded-proto') || 'http'

  // The browser flash wizard can only run in a secure context, which over plain
  // HTTP means localhost. That makes the Host header almost always loopback — but
  // a device flashed with "localhost" as its server URL would try to reach itself
  // and never connect. So when the host is loopback, propose the machine's LAN IP
  // instead, which is actually reachable from the device. The field stays editable
  // in the UI so it can be corrected if we guess the wrong interface.
  const [hostname, port = '8000'] = hostHeader.split(':')
  let host = hostHeader
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    const lanIp = getLanIp()
    if (lanIp) host = `${lanIp}:${port}`
  }

  const serverUrl = `${proto}://${host}`

  return {
    ssid: config.wifi?.ssid || '',
    password: config.wifi?.password || '',
    serverUrl,
  }
})
