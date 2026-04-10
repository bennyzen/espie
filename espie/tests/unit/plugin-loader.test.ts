import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// Mock chokidar
const mockWatcher = {
  on: vi.fn().mockReturnThis(),
  close: vi.fn().mockResolvedValue(undefined),
}

vi.mock('chokidar', () => ({
  watch: vi.fn(() => mockWatcher),
}))

import { PluginLoader } from '../../server/utils/plugin-loader'

describe('PluginLoader', () => {
  let loader: PluginLoader
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset chokidar mock to fresh state
    mockWatcher.on.mockReturnThis()
    mockWatcher.close.mockResolvedValue(undefined)
    loader = new PluginLoader()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'espie-plugin-test-'))
  })

  afterEach(async () => {
    await loader.stop()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('scanDirectory', () => {
    it('finds .ts files and loads them as AgentTool[]', async () => {
      // Write a valid plugin file
      const pluginCode = `
        export default {
          name: 'test_tool',
          description: 'A test tool',
          execute: async (_toolCallId, _params) => ({
            content: [{ type: 'text', text: 'test result' }],
            details: {},
          }),
        }
      `
      fs.writeFileSync(path.join(tmpDir, 'test-tool.ts'), pluginCode)

      await loader.scanDirectory(tmpDir)
      const tools = loader.getTools()

      expect(tools.length).toBe(1)
      expect(tools[0].name).toBe('test_tool')
      expect(tools[0].description).toBe('A test tool')
    })

    it('skips files that do not export the correct shape', async () => {
      // Write an invalid plugin file (missing name)
      const invalidPlugin = `
        export default {
          description: 'Missing name field',
          execute: async () => ({ content: [], details: {} }),
        }
      `
      fs.writeFileSync(path.join(tmpDir, 'invalid.ts'), invalidPlugin)

      // Write a valid plugin file
      const validPlugin = `
        export default {
          name: 'valid_tool',
          description: 'Valid tool',
          execute: async () => ({
            content: [{ type: 'text', text: 'ok' }],
            details: {},
          }),
        }
      `
      fs.writeFileSync(path.join(tmpDir, 'valid.ts'), validPlugin)

      await loader.scanDirectory(tmpDir)
      const tools = loader.getTools()

      expect(tools.length).toBe(1)
      expect(tools[0].name).toBe('valid_tool')
    })
  })

  describe('loadPlugin', () => {
    it('converts EspiePlugin export to AgentTool', async () => {
      const pluginCode = `
        export default {
          name: 'my_tool',
          label: 'My Tool',
          description: 'Does something',
          execute: async (_toolCallId, params) => ({
            content: [{ type: 'text', text: 'done' }],
            details: { params },
          }),
        }
      `
      const filePath = path.join(tmpDir, 'my-tool.ts')
      fs.writeFileSync(filePath, pluginCode)

      await loader.loadPlugin(filePath)
      const tools = loader.getTools()

      expect(tools.length).toBe(1)
      expect(tools[0].name).toBe('my_tool')
      expect(tools[0].label).toBe('My Tool')
      expect(tools[0].description).toBe('Does something')
      expect(typeof tools[0].execute).toBe('function')
      expect(tools[0].parameters).toBeDefined()
    })

    it('uses name as label when label not provided', async () => {
      const pluginCode = `
        export default {
          name: 'auto_label',
          description: 'No label set',
          execute: async () => ({
            content: [{ type: 'text', text: 'ok' }],
            details: {},
          }),
        }
      `
      const filePath = path.join(tmpDir, 'auto-label.ts')
      fs.writeFileSync(filePath, pluginCode)

      await loader.loadPlugin(filePath)
      const tools = loader.getTools()

      expect(tools[0].label).toBe('auto_label')
    })
  })

  describe('hot-reload', () => {
    it('fires onToolsChanged callback when file added', async () => {
      const onToolsChanged = vi.fn()

      // Write initial plugin
      const pluginCode = `
        export default {
          name: 'initial_tool',
          description: 'Initial',
          execute: async () => ({
            content: [{ type: 'text', text: 'ok' }],
            details: {},
          }),
        }
      `
      fs.writeFileSync(path.join(tmpDir, 'initial.ts'), pluginCode)

      await loader.startWatching(tmpDir, onToolsChanged)

      // Should have fired once with initial tools
      expect(onToolsChanged).toHaveBeenCalledTimes(1)
      const initialTools = onToolsChanged.mock.calls[0][0]
      expect(initialTools.length).toBe(1)

      // Simulate chokidar 'add' event
      const addHandler = mockWatcher.on.mock.calls.find(
        (call: any[]) => call[0] === 'add',
      )?.[1]
      expect(addHandler).toBeDefined()

      // Write a new plugin file for the simulated event
      const newPluginCode = `
        export default {
          name: 'new_tool',
          description: 'New',
          execute: async () => ({
            content: [{ type: 'text', text: 'new' }],
            details: {},
          }),
        }
      `
      const newFilePath = path.join(tmpDir, 'new-tool.ts')
      fs.writeFileSync(newFilePath, newPluginCode)

      // Trigger the add handler
      await addHandler(newFilePath)

      // Should have fired again with updated tools
      expect(onToolsChanged).toHaveBeenCalledTimes(2)
      const updatedTools = onToolsChanged.mock.calls[1][0]
      expect(updatedTools.length).toBe(2)
    })

    it('fires onToolsChanged callback when file removed', async () => {
      const onToolsChanged = vi.fn()

      const pluginCode = `
        export default {
          name: 'removable_tool',
          description: 'Will be removed',
          execute: async () => ({
            content: [{ type: 'text', text: 'ok' }],
            details: {},
          }),
        }
      `
      const filePath = path.join(tmpDir, 'removable.ts')
      fs.writeFileSync(filePath, pluginCode)

      await loader.startWatching(tmpDir, onToolsChanged)

      expect(onToolsChanged).toHaveBeenCalledTimes(1)
      expect(onToolsChanged.mock.calls[0][0].length).toBe(1)

      // Simulate chokidar 'unlink' event
      const unlinkHandler = mockWatcher.on.mock.calls.find(
        (call: any[]) => call[0] === 'unlink',
      )?.[1]
      expect(unlinkHandler).toBeDefined()

      // Trigger unlink
      await unlinkHandler(filePath)

      expect(onToolsChanged).toHaveBeenCalledTimes(2)
      expect(onToolsChanged.mock.calls[1][0].length).toBe(0)
    })
  })

  describe('scanNpmPlugins', () => {
    it('finds packages with espie-plugin keyword', async () => {
      // Create a fake node_modules structure
      const nodeModulesDir = path.join(tmpDir, 'node_modules')
      const pkgDir = path.join(nodeModulesDir, 'espie-plugin-test')
      fs.mkdirSync(pkgDir, { recursive: true })

      // Write package.json with espie-plugin keyword
      fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({
          name: 'espie-plugin-test',
          keywords: ['espie-plugin'],
          main: 'index.js',
        }),
      )

      // Write the plugin entry
      fs.writeFileSync(
        path.join(pkgDir, 'index.js'),
        `
        module.exports = {
          default: {
            name: 'npm_test_tool',
            description: 'From npm package',
            execute: async () => ({
              content: [{ type: 'text', text: 'npm result' }],
              details: {},
            }),
          },
        }
      `,
      )

      await loader.scanNpmPlugins(tmpDir)
      const tools = loader.getTools()

      expect(tools.length).toBe(1)
      expect(tools[0].name).toBe('npm_test_tool')
    })

    it('skips packages without espie-plugin keyword', async () => {
      const nodeModulesDir = path.join(tmpDir, 'node_modules')
      const pkgDir = path.join(nodeModulesDir, 'some-other-package')
      fs.mkdirSync(pkgDir, { recursive: true })

      fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({
          name: 'some-other-package',
          keywords: ['unrelated'],
          main: 'index.js',
        }),
      )

      fs.writeFileSync(
        path.join(pkgDir, 'index.js'),
        `module.exports = { default: { name: 'not_a_plugin' } }`,
      )

      await loader.scanNpmPlugins(tmpDir)
      const tools = loader.getTools()

      expect(tools.length).toBe(0)
    })
  })

  describe('getTools', () => {
    it('returns combined file and npm plugins', async () => {
      // Add a file plugin
      const pluginCode = `
        export default {
          name: 'file_tool',
          description: 'File tool',
          execute: async () => ({
            content: [{ type: 'text', text: 'file' }],
            details: {},
          }),
        }
      `
      fs.writeFileSync(path.join(tmpDir, 'file-tool.ts'), pluginCode)
      await loader.scanDirectory(tmpDir)

      // Add npm plugins
      const nodeModulesDir = path.join(tmpDir, 'node_modules')
      const pkgDir = path.join(nodeModulesDir, 'espie-plugin-npm')
      fs.mkdirSync(pkgDir, { recursive: true })

      fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({
          name: 'espie-plugin-npm',
          keywords: ['espie-plugin'],
          main: 'index.js',
        }),
      )

      fs.writeFileSync(
        path.join(pkgDir, 'index.js'),
        `
        module.exports = {
          default: {
            name: 'npm_tool',
            description: 'NPM tool',
            execute: async () => ({
              content: [{ type: 'text', text: 'npm' }],
              details: {},
            }),
          },
        }
      `,
      )

      await loader.scanNpmPlugins(tmpDir)
      const tools = loader.getTools()

      expect(tools.length).toBe(2)
      const names = tools.map((t) => t.name)
      expect(names).toContain('file_tool')
      expect(names).toContain('npm_tool')
    })
  })

  describe('stop', () => {
    it('closes the watcher', async () => {
      const onToolsChanged = vi.fn()
      fs.writeFileSync(
        path.join(tmpDir, 'dummy.ts'),
        `export default { name: 'x', description: 'x', execute: async () => ({ content: [], details: {} }) }`,
      )
      await loader.startWatching(tmpDir, onToolsChanged)
      await loader.stop()

      expect(mockWatcher.close).toHaveBeenCalledTimes(1)
    })
  })
})
