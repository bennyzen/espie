/**
 * Plugin loader with file scanning, hot-reload, and npm package discovery.
 * Discovers .ts/.js files in plugins/ directory and npm packages with espie-plugin keyword,
 * converts them to pi-agent-core AgentTool[] format.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { watch, type FSWatcher } from 'chokidar'
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'

/**
 * Plugin loader that discovers tools from the filesystem and npm packages.
 * Supports hot-reload via chokidar file watching.
 */
export class PluginLoader {
  private fileTools: Map<string, AgentTool<any>> = new Map()
  private npmTools: AgentTool<any>[] = []
  private watcher: FSWatcher | null = null

  /**
   * Scan a directory for .ts and .js plugin files.
   */
  async scanDirectory(pluginsDir: string): Promise<void> {
    if (!fs.existsSync(pluginsDir)) {
      console.log(`[plugin-loader] Directory does not exist: ${pluginsDir}`)
      return
    }

    const files = fs.readdirSync(pluginsDir).filter(
      (f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts'),
    )

    for (const file of files) {
      const filePath = path.join(pluginsDir, file)
      await this.loadPlugin(filePath)
    }
  }

  /**
   * Load a single plugin file and convert to AgentTool.
   * Cache-busts by appending timestamp to import URL.
   */
  async loadPlugin(filePath: string): Promise<void> {
    try {
      const fileUrl = pathToFileURL(filePath).href + '?t=' + Date.now()
      const mod = await import(fileUrl)
      const plugin = mod.default

      // Validate plugin shape
      if (!plugin || typeof plugin.name !== 'string' || typeof plugin.execute !== 'function') {
        console.warn(
          `[plugin-loader] Skipping ${path.basename(filePath)}: missing name or execute`,
        )
        return
      }

      const tool: AgentTool<any> = {
        name: plugin.name,
        label: plugin.label || plugin.name,
        description: plugin.description || '',
        parameters: plugin.parameters || Type.Object({}),
        execute: plugin.execute,
      }

      this.fileTools.set(filePath, tool)
      console.log(`[plugin-loader] Loaded plugin: ${plugin.name} from ${path.basename(filePath)}`)
    } catch (err) {
      console.warn(
        `[plugin-loader] Failed to load ${path.basename(filePath)}:`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  /**
   * Start watching a plugins directory for changes.
   * Fires onToolsChanged with the full current tool list whenever plugins change.
   */
  async startWatching(
    pluginsDir: string,
    onToolsChanged: (tools: AgentTool<any>[]) => void,
  ): Promise<void> {
    // Initial scan
    await this.scanDirectory(pluginsDir)
    onToolsChanged(this.getTools())

    // Watch for changes
    this.watcher = watch(pluginsDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500 },
    })

    this.watcher.on('add', async (filePath: string) => {
      if (this.isPluginFile(filePath)) {
        await this.loadPlugin(filePath)
        onToolsChanged(this.getTools())
      }
    })

    this.watcher.on('change', async (filePath: string) => {
      if (this.isPluginFile(filePath)) {
        await this.loadPlugin(filePath)
        onToolsChanged(this.getTools())
      }
    })

    this.watcher.on('unlink', async (filePath: string) => {
      if (this.fileTools.has(filePath)) {
        this.fileTools.delete(filePath)
        onToolsChanged(this.getTools())
      }
    })
  }

  /**
   * Scan node_modules for packages with the "espie-plugin" keyword.
   * @param projectRoot - Project root (defaults to process.cwd())
   */
  async scanNpmPlugins(projectRoot?: string): Promise<void> {
    const root = projectRoot || process.cwd()
    const nodeModulesDir = path.join(root, 'node_modules')

    if (!fs.existsSync(nodeModulesDir)) {
      console.log('[plugin-loader] No node_modules directory found')
      return
    }

    const entries = fs.readdirSync(nodeModulesDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue

      // Handle scoped packages (@scope/pkg)
      if (entry.name.startsWith('@')) {
        const scopeDir = path.join(nodeModulesDir, entry.name)
        const scopedEntries = fs.readdirSync(scopeDir, { withFileTypes: true })
        for (const scopedEntry of scopedEntries) {
          if (scopedEntry.isDirectory()) {
            await this.tryLoadNpmPlugin(
              path.join(scopeDir, scopedEntry.name),
            )
          }
        }
      } else {
        await this.tryLoadNpmPlugin(path.join(nodeModulesDir, entry.name))
      }
    }
  }

  /**
   * Get all currently loaded tools (file + npm).
   */
  getTools(): AgentTool<any>[] {
    return [...this.fileTools.values(), ...this.npmTools]
  }

  /**
   * Stop file watching and clean up.
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }

  /**
   * Check if a file path is a plugin file (.ts or .js, not .d.ts).
   */
  private isPluginFile(filePath: string): boolean {
    return (
      (filePath.endsWith('.ts') || filePath.endsWith('.js')) &&
      !filePath.endsWith('.d.ts')
    )
  }

  /**
   * Try to load an npm package as a Espie plugin.
   * Reads package.json, checks for "espie-plugin" keyword, loads if found.
   */
  private async tryLoadNpmPlugin(pkgDir: string): Promise<void> {
    try {
      const pkgJsonPath = path.join(pkgDir, 'package.json')
      if (!fs.existsSync(pkgJsonPath)) return

      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
      const keywords: string[] = pkgJson.keywords || []

      if (!keywords.includes('espie-plugin')) return

      // Resolve the main entry
      const mainEntry = pkgJson.main || 'index.js'
      const entryPath = path.join(pkgDir, mainEntry)

      if (!fs.existsSync(entryPath)) {
        console.warn(
          `[plugin-loader] npm plugin ${pkgJson.name}: entry ${mainEntry} not found`,
        )
        return
      }

      const mod = await import(pathToFileURL(entryPath).href)
      // Handle CJS interop: module.exports = { default: { ... } } wraps in extra .default
      const plugin = mod.default?.name ? mod.default : mod.default?.default || mod.default

      if (!plugin || typeof plugin.name !== 'string' || typeof plugin.execute !== 'function') {
        console.warn(
          `[plugin-loader] npm plugin ${pkgJson.name}: invalid export shape`,
        )
        return
      }

      const tool: AgentTool<any> = {
        name: plugin.name,
        label: plugin.label || plugin.name,
        description: plugin.description || '',
        parameters: plugin.parameters || Type.Object({}),
        execute: plugin.execute,
      }

      this.npmTools.push(tool)
      console.log(`[plugin-loader] Loaded npm plugin: ${plugin.name} from ${pkgJson.name}`)
    } catch (err) {
      console.warn(
        `[plugin-loader] Failed to load npm plugin from ${path.basename(pkgDir)}:`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }
}
