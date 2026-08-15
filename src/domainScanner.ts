import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

export type LocalDomainSource = 'Herd' | 'Valet' | 'MAMP' | 'hosts' | 'workspace' | 'projectRoot' | 'manual';

export interface LocalDomain {
  label: string;
  host: string;
  origin: string;
  source: LocalDomainSource;
  projectPath?: string;
}

const HOME = os.homedir();

export async function scanLocalDomains(): Promise<LocalDomain[]> {
  const [herd, valet, mamp, hosts, workspace, projectRoots, manual] = await Promise.all([
    scanHerd(),
    scanValet(),
    scanMamp(),
    scanHosts(),
    scanWorkspace(),
    scanProjectRoots(),
    scanManual(),
  ]);

  return uniqueDomains([...herd, ...valet, ...mamp, ...hosts, ...workspace, ...projectRoots, ...manual]);
}

async function scanHerd(): Promise<LocalDomain[]> {
  const roots = [
    path.join(HOME, 'Library', 'Application Support', 'Herd', 'config', 'valet'),
    path.join(HOME, 'Library', 'Application Support', 'Herd', 'config', 'sites'),
    path.join(HOME, '.config', 'herd'),
  ];
  const domains: LocalDomain[] = [];

  for (const root of roots) {
    const files = await safeReadDir(root);
    for (const file of files) {
      domains.push(...extractDomains(file.name, 'Herd'));
      const content = await safeReadFile(path.join(root, file.name));
      domains.push(...extractDomains(content, 'Herd'));
    }
  }

  return domains;
}

async function scanValet(): Promise<LocalDomain[]> {
  const valetDir = path.join(HOME, '.config', 'valet');
  const config = await safeJson(path.join(valetDir, 'config.json'));
  const tld = typeof config?.tld === 'string' ? config.tld : 'test';
  const domains: LocalDomain[] = [];

  for (const root of [path.join(valetDir, 'Sites'), path.join(valetDir, 'Nginx')]) {
    const files = await safeReadDir(root);
    for (const file of files) {
      const basename = file.name.replace(/\.test$|\.conf$/g, '');
      domains.push(toDomain(`${basename}.${tld}`, 'Valet'));
      const content = await safeReadFile(path.join(root, file.name));
      domains.push(...extractDomains(content, 'Valet'));
    }
  }

  return domains;
}

async function scanMamp(): Promise<LocalDomain[]> {
  const candidates = [
    '/Applications/MAMP/conf/apache/extra/httpd-vhosts.conf',
    '/Applications/MAMP PRO/conf/httpd.conf',
    path.join(HOME, 'Library', 'Application Support', 'appsolute', 'MAMP PRO', 'httpd.conf'),
  ];
  const domains: LocalDomain[] = [];

  for (const candidate of candidates) {
    domains.push(...extractDomains(await safeReadFile(candidate), 'MAMP'));
  }

  return domains;
}

async function scanHosts(): Promise<LocalDomain[]> {
  return extractDomains(await safeReadFile('/etc/hosts'), 'hosts')
    .filter((domain) => domain.host.endsWith('.test') || domain.host.endsWith('.localhost'));
}

async function scanWorkspace(): Promise<LocalDomain[]> {
  const domains: LocalDomain[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    domains.push(...await domainsFromProject(folder.uri.fsPath, 'workspace'));
  }
  return domains;
}

async function scanProjectRoots(): Promise<LocalDomain[]> {
  const roots = vscode.workspace.getConfiguration('localflare').get<string[]>('projectRoots', ['~/Sites']);
  const domains: LocalDomain[] = [];

  for (const root of roots.map(expandHome)) {
    const entries = await safeReadDir(root);
    for (const entry of entries.filter((item) => item.isDirectory())) {
      domains.push(...await domainsFromProject(path.join(root, entry.name), 'projectRoot'));
    }
  }

  return domains;
}

async function domainsFromProject(projectPath: string, source: LocalDomainSource): Promise<LocalDomain[]> {
  const env = await safeReadFile(path.join(projectPath, '.env'));
  const appUrl = env.match(/^APP_URL=(.+)$/m)?.[1];
  if (appUrl) {
    return [toDomain(appUrl.trim().replace(/^['"]|['"]$/g, ''), source, projectPath)];
  }

  const composerJson = await safeJson(path.join(projectPath, 'composer.json'));
  const packageJson = await safeJson(path.join(projectPath, 'package.json'));
  if (composerJson || packageJson) {
    const host = `${path.basename(projectPath).toLowerCase().replace(/[^a-z0-9-]/g, '-')}.test`;
    return [toDomain(host, source, projectPath)];
  }

  return [];
}

async function scanManual(): Promise<LocalDomain[]> {
  const values = vscode.workspace.getConfiguration('localflare').get<string[]>('extraDomains', []);
  return values.map((value) => toDomain(value, 'manual'));
}

function extractDomains(input: string, source: LocalDomainSource): LocalDomain[] {
  const matches = input.match(/(?:https?:\/\/)?([a-z0-9][a-z0-9.-]*\.(?:test|localhost|local|site|mamp|dev))(?:\:\d+)?/gi) ?? [];
  return matches.map((match) => toDomain(match, source));
}

function toDomain(value: string, source: LocalDomainSource, projectPath?: string): LocalDomain {
  const hasScheme = /^https?:\/\//i.test(value);
  const url = new URL(hasScheme ? value : `http://${value}`);
  const fallbackPort = vscode.workspace.getConfiguration('localflare').get<number>('defaultOriginPort', 80);
  const port = url.port || (url.protocol === 'https:' ? '443' : String(fallbackPort));
  const origin = `${url.protocol}//${url.hostname}${port && port !== '80' && port !== '443' ? `:${port}` : ''}`;

  return { label: `${url.hostname} (${source})`, host: url.hostname, origin, source, projectPath };
}

function uniqueDomains(domains: LocalDomain[]): LocalDomain[] {
  const seen = new Set<string>();
  return domains.filter((domain) => {
    const key = `${domain.host}|${domain.origin}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.host.localeCompare(b.host));
}

function expandHome(value: string): string {
  return value === '~' || value.startsWith('~/') ? path.join(HOME, value.slice(2)) : value;
}

async function safeReadDir(dir: string): Promise<import('node:fs').Dirent[]> {
  try { return await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
}

async function safeReadFile(file: string): Promise<string> {
  try { return await fs.readFile(file, 'utf8'); } catch { return ''; }
}

async function safeJson(file: string): Promise<Record<string, unknown> | undefined> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>; } catch { return undefined; }
}
