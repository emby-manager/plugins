import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import Ajv2020Import, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import { build as esbuild } from 'esbuild'
import semver from 'semver'
import yauzl from 'yauzl'
import yazl from 'yazl'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const fixedDate = new Date('1980-01-01T00:00:00.000Z')
const maxArchiveBytes = 25 * 1024 * 1024
const maxExpandedBytes = 50 * 1024 * 1024
const maxFiles = 256
const forbiddenExtensions = new Set([
  '.node', '.so', '.dll', '.dylib', '.exe', '.com', '.bat', '.cmd', '.ps1',
  '.sh', '.zip', '.emp', '.tar', '.tgz', '.gz', '.bz2', '.xz', '.rar', '.7z',
])
type Ajv2020Constructor = new (options?: object) => { compile(schema: object): ValidateFunction }
const Ajv2020 = ((Ajv2020Import as unknown as { default?: unknown }).default || Ajv2020Import) as unknown as Ajv2020Constructor
const pluginSchema = JSON.parse(fs.readFileSync(path.join(root, 'schemas/plugin.schema.json'), 'utf8'))
const validatePluginSchema = new Ajv2020({ allErrors: true, strict: true }).compile(pluginSchema)

const safeConfigSchemaKeywords = new Set([
  'type', 'title', 'description', 'default', 'properties', 'required', 'additionalProperties',
  'items', 'enum', 'const', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems',
  'minProperties', 'maxProperties',
])

function assertSafeConfigSchema(value: unknown, depth = 0, state = { nodes: 0 }): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 8 || ++state.nodes > 256) {
    throw new Error('configSchema is too deep or too large')
  }
  const schema = value as Record<string, unknown>
  for (const key of Object.keys(schema)) {
    if (!safeConfigSchemaKeywords.has(key)) throw new Error(`configSchema keyword is not supported: ${key}`)
  }
  if (schema.properties !== undefined) {
    if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
      throw new Error('configSchema.properties must be an object')
    }
    const entries = Object.entries(schema.properties as Record<string, unknown>)
    if (entries.length > 64) throw new Error('configSchema has too many properties')
    for (const [name, child] of entries) {
      if (!name || name.length > 64) throw new Error('configSchema property name is invalid')
      assertSafeConfigSchema(child, depth + 1, state)
    }
  }
  if (schema.items !== undefined) assertSafeConfigSchema(schema.items, depth + 1, state)
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
    assertSafeConfigSchema(schema.additionalProperties, depth + 1, state)
  }
}

function validateManifest(input: unknown): void {
  if (!validatePluginSchema(input)) {
    const details = validatePluginSchema.errors?.map((error: ErrorObject) => `${error.instancePath || '/'} ${error.message}`).join('; ')
    throw new Error(`plugin.json schema validation failed: ${details}`)
  }
  const manifest = input as Record<string, any>
  if (!semver.valid(manifest.version)) throw new Error('plugin version must be valid SemVer')
  if (manifest.engines?.node && !semver.validRange(manifest.engines.node)) throw new Error('Node.js engine range is invalid')
  if (
    (manifest.capabilities.includes('network.read') || manifest.capabilities.includes('network.write'))
    && !manifest.network?.allowedHosts?.length
  ) {
    throw new Error('network.read/network.write requires network.allowedHosts')
  }
  if (manifest.configSchema) {
    assertSafeConfigSchema(manifest.configSchema)
    const validateConfig = new Ajv2020({ allErrors: true, strict: true }).compile(manifest.configSchema)
    if (manifest.defaultConfig && !validateConfig(manifest.defaultConfig)) {
      throw new Error('defaultConfig does not satisfy configSchema')
    }
  }
}

async function safeSourceFile(pluginRoot: string, relativePath: unknown): Promise<string> {
  if (typeof relativePath !== 'string' || relativePath.includes('\\') || !/^[A-Za-z0-9_./-]+\.(?:ts|js|mjs)$/.test(relativePath)) {
    throw new Error('server entrypoint path is invalid')
  }
  const [realRoot, realSource] = await Promise.all([
    fsp.realpath(pluginRoot),
    fsp.realpath(path.resolve(pluginRoot, relativePath)),
  ])
  const relative = path.relative(realRoot, realSource)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('server entrypoint escapes the plugin directory')
  }
  const stat = await fsp.lstat(realSource)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('server entrypoint must be a regular file')
  return realSource
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function digest(data: crypto.BinaryLike): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

async function walk(directory: string, prefix = ''): Promise<Array<{ name: string; data: Buffer }>> {
  const output: Array<{ name: string; data: Buffer }> = []
  for (const entry of (await fsp.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
    const absolute = path.join(directory, entry.name)
    const name = path.posix.join(prefix, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${name}`)
    if (entry.isDirectory()) output.push(...await walk(absolute, name))
    else if (entry.isFile()) output.push({ name, data: await fsp.readFile(absolute) })
  }
  return output
}

async function zipFiles(files: Array<{ name: string; data: Buffer }>, output: string): Promise<void> {
  const zip = new yazl.ZipFile()
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
    zip.addBuffer(file.data, file.name, { mtime: fixedDate, mode: 0o100644, compress: true })
  }
  zip.end()
  await fsp.mkdir(path.dirname(output), { recursive: true })
  await pipeline(zip.outputStream, fs.createWriteStream(output, { mode: 0o600 }))
}

async function buildPlugin(pluginDirectory: string, outputDirectory?: string): Promise<string> {
  const pluginRoot = path.resolve(pluginDirectory)
  const manifest = JSON.parse(await fsp.readFile(path.join(pluginRoot, 'plugin.json'), 'utf8'))
  if (manifest.schemaVersion !== 2 || manifest.apiVersion !== '2' || !semver.valid(manifest.version)) {
    throw new Error('plugin.json must use schemaVersion=2, apiVersion=2 and valid SemVer')
  }
  const staging = await fsp.mkdtemp(path.join(process.cwd(), '.plugin-build-'))
  try {
    const normalizedManifest = { ...manifest, entrypoints: { ...manifest.entrypoints } }
    if (manifest.entrypoints?.server) {
      const source = await safeSourceFile(pluginRoot, manifest.entrypoints.server)
      const target = path.join(staging, 'server/main.mjs')
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await esbuild({
        entryPoints: [source],
        outfile: target,
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node24',
        packages: 'bundle',
        sourcemap: false,
        minify: false,
      })
      normalizedManifest.entrypoints.server = 'server/main.mjs'
    }
    for (const directory of ['ui', 'assets']) {
      const source = path.join(pluginRoot, directory)
      try { await fsp.cp(source, path.join(staging, directory), { recursive: true, errorOnExist: true }) } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
    for (const file of ['README.md', 'LICENSE']) {
      try { await fsp.copyFile(path.join(pluginRoot, file), path.join(staging, file)) } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
    validateManifest(normalizedManifest)
    for (const page of normalizedManifest.pages || []) {
      const pagePath = path.join(staging, ...String(page.schema).split('/'))
      const stat = await fsp.stat(pagePath).catch(() => null)
      if (!stat?.isFile()) throw new Error(`UI schema is missing: ${page.schema}`)
    }
    await fsp.writeFile(path.join(staging, 'plugin.json'), `${JSON.stringify(normalizedManifest, null, 2)}\n`)
    const payloadFiles = await walk(staging)
    const checksums = {
      algorithm: 'sha256',
      files: payloadFiles.map((file) => ({ path: file.name, sha256: digest(file.data), size: file.data.length })),
    }
    await fsp.writeFile(path.join(staging, 'checksums.json'), `${JSON.stringify(checksums, null, 2)}\n`)
    const packageDigest = digest(`EM_PLUGIN_PACKAGE_V2\n${canonicalJson(normalizedManifest)}\n${canonicalJson(checksums)}`)
    const privateKeyText = process.env.EM_PLUGIN_SIGNING_KEY
    if (privateKeyText) {
      const keyId = process.env.EM_PLUGIN_SIGNING_KEY_ID
      const publisher = process.env.EM_PLUGIN_PUBLISHER
      if (!keyId || !publisher) throw new Error('Signed build requires EM_PLUGIN_SIGNING_KEY_ID and EM_PLUGIN_PUBLISHER')
      const signature = crypto.sign(null, Buffer.from(packageDigest, 'hex'), crypto.createPrivateKey(privateKeyText))
      await fsp.writeFile(path.join(staging, 'signature.json'), `${JSON.stringify({
        algorithm: 'Ed25519', keyId, publisher, packageDigest, signature: signature.toString('base64'),
      }, null, 2)}\n`)
    }
    const files = await walk(staging)
    const output = path.join(path.resolve(outputDirectory || path.join(pluginRoot, 'dist')), `${manifest.id}-${manifest.version}.emp`)
    await zipFiles(files, output)
    process.stdout.write(`${output}\n`)
    return output
  } finally {
    await fsp.rm(staging, { recursive: true, force: true })
  }
}

async function readZipFiles(archive: string): Promise<Map<string, Buffer>> {
  const archiveStat = await fsp.stat(path.resolve(archive))
  if (!archiveStat.isFile() || archiveStat.size <= 0 || archiveStat.size > maxArchiveBytes) {
    throw new Error('package is empty or exceeds 25 MB')
  }
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(path.resolve(archive), { lazyEntries: true, autoClose: false }, (error, value) => error || !value ? reject(error || new Error('invalid zip')) : resolve(value)))
  const files = new Map<string, Buffer>()
  const caseFolded = new Set<string>()
  let expandedBytes = 0
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (entry) => {
      const normalized = path.posix.normalize(entry.fileName)
      if (entry.fileName.includes('\\') || normalized !== entry.fileName || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
        reject(new Error(`unsafe path: ${entry.fileName}`)); zip.close(); return
      }
      const folded = normalized.toLocaleLowerCase('en-US')
      const mode = (entry.externalFileAttributes >>> 16) & 0xffff
      if (caseFolded.has(folded) || (mode & 0o170000) === 0o120000) {
        reject(new Error(`duplicate or symbolic path: ${entry.fileName}`)); zip.close(); return
      }
      caseFolded.add(folded)
      if (entry.fileName.endsWith('/')) { zip.readEntry(); return }
      expandedBytes += entry.uncompressedSize
      const ratio = entry.compressedSize === 0 ? entry.uncompressedSize : entry.uncompressedSize / entry.compressedSize
      if (files.size >= maxFiles || expandedBytes > maxExpandedBytes || ratio > 100 || forbiddenExtensions.has(path.posix.extname(normalized).toLowerCase())) {
        reject(new Error(`package safety limit exceeded: ${entry.fileName}`)); zip.close(); return
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) { reject(error || new Error(`cannot read ${entry.fileName}`)); return }
        const chunks: Buffer[] = []
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        stream.once('error', reject)
        stream.once('end', () => { files.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry() })
      })
    })
    zip.once('error', reject)
    zip.once('end', resolve)
    zip.readEntry()
  })
  zip.close()
  return files
}

async function verifyArchive(archive: string, publicKeyText?: string): Promise<{ manifest: any; checksums: any; signature: any; packageDigest: string }> {
  const files = await readZipFiles(archive)
  if (!files.has('plugin.json') || !files.has('checksums.json')) throw new Error('package control files are missing')
  const manifest = JSON.parse(files.get('plugin.json')!.toString('utf8'))
  const checksums = JSON.parse(files.get('checksums.json')!.toString('utf8'))
  const signature = files.has('signature.json') ? JSON.parse(files.get('signature.json')!.toString('utf8')) : null
  validateManifest(manifest)
  const expected = new Map(checksums.files.map((item: any) => [item.path, item]))
  if (expected.has('checksums.json') || expected.has('signature.json')) throw new Error('control signatures cannot checksum themselves')
  for (const [name, data] of files) {
    if (name === 'checksums.json' || name === 'signature.json') continue
    const item: any = expected.get(name)
    if (!item || item.size !== data.length || item.sha256 !== digest(data)) throw new Error(`checksum failed: ${name}`)
  }
  for (const name of expected.keys()) if (!files.has(String(name))) throw new Error(`missing file: ${String(name)}`)
  const packageDigest = digest(`EM_PLUGIN_PACKAGE_V2\n${canonicalJson(manifest)}\n${canonicalJson(checksums)}`)
  if (signature && signature.packageDigest !== packageDigest) throw new Error('signature package digest mismatch')
  if (signature && publicKeyText) {
    const valid = crypto.verify(
      null,
      Buffer.from(packageDigest, 'hex'),
      crypto.createPublicKey(publicKeyText),
      Buffer.from(signature.signature, 'base64'),
    )
    if (!valid) throw new Error('publisher signature is invalid')
  }
  process.stdout.write(`OK: ${archive} (${files.size} entries, ${packageDigest})\n`)
  return { manifest, checksums, signature, packageDigest }
}

async function addCatalogEntry(archive: string, downloadUrl: string): Promise<void> {
  const privateKeyText = process.env.EM_PLUGIN_SIGNING_KEY
  const expectedKeyId = process.env.EM_PLUGIN_SIGNING_KEY_ID
  if (!privateKeyText || !expectedKeyId) throw new Error('catalog publishing requires the official signing key and key ID')
  const publicKey = crypto.createPublicKey(crypto.createPrivateKey(privateKeyText)).export({ format: 'pem', type: 'spki' }).toString()
  const verified = await verifyArchive(archive, publicKey)
  if (!verified.signature?.keyId) throw new Error('catalog packages must be signed')
  if (verified.signature.keyId !== expectedKeyId) throw new Error('package signer does not match the catalog signer')
  const catalogPath = path.join(root, 'catalog/index.json')
  const catalog = JSON.parse(await fsp.readFile(catalogPath, 'utf8'))
  let plugin = catalog.plugins.find((item: any) => item.id === verified.manifest.id)
  if (!plugin) {
    plugin = {
      id: verified.manifest.id,
      name: verified.manifest.name,
      description: verified.manifest.description,
      author: verified.manifest.author,
      homepage: verified.manifest.homepage,
      repository: verified.manifest.repository,
      versions: [],
    }
    catalog.plugins.push(plugin)
  }
  plugin.name = verified.manifest.name
  plugin.description = verified.manifest.description
  plugin.author = verified.manifest.author
  plugin.homepage = verified.manifest.homepage
  plugin.repository = verified.manifest.repository
  plugin.versions = plugin.versions.filter((item: any) => item.version !== verified.manifest.version)
  plugin.versions.unshift({
    version: verified.manifest.version,
    downloadUrl,
    packageDigest: verified.packageDigest,
    keyId: verified.signature.keyId,
    engines: verified.manifest.engines,
    publishedAt: new Date().toISOString(),
  })
  plugin.versions.sort((a: any, b: any) => semver.rcompare(a.version, b.version))
  catalog.plugins.sort((a: any, b: any) => a.id.localeCompare(b.id))
  catalog.generatedAt = new Date().toISOString()
  await fsp.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
}

async function signCatalog(): Promise<void> {
  const privateKeyText = process.env.EM_PLUGIN_SIGNING_KEY
  const keyId = process.env.EM_PLUGIN_SIGNING_KEY_ID
  if (!privateKeyText || !keyId) throw new Error('catalog signing requires EM_PLUGIN_SIGNING_KEY and EM_PLUGIN_SIGNING_KEY_ID')
  const catalogPath = path.join(root, 'catalog/index.json')
  const catalog = JSON.parse(await fsp.readFile(catalogPath, 'utf8'))
  const catalogDigest = digest(canonicalJson(catalog))
  const signature = crypto.sign(null, Buffer.from(catalogDigest, 'hex'), crypto.createPrivateKey(privateKeyText))
  await fsp.writeFile(path.join(root, 'catalog/signature.json'), `${JSON.stringify({
    algorithm: 'Ed25519', keyId, catalogDigest, signature: signature.toString('base64'),
  }, null, 2)}\n`)
}

async function validateAll(): Promise<void> {
  const pluginsDir = path.join(root, 'plugins')
  const entries = await fsp.readdir(pluginsDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const output = await buildPlugin(path.join(pluginsDir, entry.name), path.join(root, 'dist'))
    await verifyArchive(output)
  }
}

async function main() {
  const [command, target, output] = process.argv.slice(2)
  if (command === 'build') return buildPlugin(target || '.', output)
  if (command === 'verify') return verifyArchive(target, process.env.EM_PLUGIN_VERIFY_KEY)
  if (command === 'validate-all') return validateAll()
  if (command === 'catalog-add') return addCatalogEntry(target, output)
  if (command === 'catalog-sign') return signCatalog()
  throw new Error('Usage: em-plugin build <plugin-dir> [output-dir] | verify <package.emp> | validate-all | catalog-add <package.emp> <download-url> | catalog-sign')
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
