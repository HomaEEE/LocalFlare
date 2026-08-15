"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanLocalDomains = scanLocalDomains;
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const HOME = os.homedir();
async function scanLocalDomains() {
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
async function scanHerd() {
    const roots = [
        path.join(HOME, 'Library', 'Application Support', 'Herd', 'config', 'valet'),
        path.join(HOME, 'Library', 'Application Support', 'Herd', 'config', 'sites'),
        path.join(HOME, '.config', 'herd'),
    ];
    const domains = [];
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
async function scanValet() {
    const valetDir = path.join(HOME, '.config', 'valet');
    const config = await safeJson(path.join(valetDir, 'config.json'));
    const tld = typeof config?.tld === 'string' ? config.tld : 'test';
    const domains = [];
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
async function scanMamp() {
    const candidates = [
        '/Applications/MAMP/conf/apache/extra/httpd-vhosts.conf',
        '/Applications/MAMP PRO/conf/httpd.conf',
        path.join(HOME, 'Library', 'Application Support', 'appsolute', 'MAMP PRO', 'httpd.conf'),
    ];
    const domains = [];
    for (const candidate of candidates) {
        domains.push(...extractDomains(await safeReadFile(candidate), 'MAMP'));
    }
    return domains;
}
async function scanHosts() {
    return extractDomains(await safeReadFile('/etc/hosts'), 'hosts')
        .filter((domain) => domain.host.endsWith('.test') || domain.host.endsWith('.localhost'));
}
async function scanWorkspace() {
    const domains = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        domains.push(...await domainsFromProject(folder.uri.fsPath, 'workspace'));
    }
    return domains;
}
async function scanProjectRoots() {
    const roots = vscode.workspace.getConfiguration('localflare').get('projectRoots', ['~/Sites']);
    const domains = [];
    for (const root of roots.map(expandHome)) {
        const entries = await safeReadDir(root);
        for (const entry of entries.filter((item) => item.isDirectory())) {
            domains.push(...await domainsFromProject(path.join(root, entry.name), 'projectRoot'));
        }
    }
    return domains;
}
async function domainsFromProject(projectPath, source) {
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
async function scanManual() {
    const values = vscode.workspace.getConfiguration('localflare').get('extraDomains', []);
    return values.map((value) => toDomain(value, 'manual'));
}
function extractDomains(input, source) {
    const matches = input.match(/(?:https?:\/\/)?([a-z0-9][a-z0-9.-]*\.(?:test|localhost|local|site|mamp|dev))(?:\:\d+)?/gi) ?? [];
    return matches.map((match) => toDomain(match, source));
}
function toDomain(value, source, projectPath) {
    const hasScheme = /^https?:\/\//i.test(value);
    const url = new URL(hasScheme ? value : `http://${value}`);
    const fallbackPort = vscode.workspace.getConfiguration('localflare').get('defaultOriginPort', 80);
    const port = url.port || (url.protocol === 'https:' ? '443' : String(fallbackPort));
    const origin = `${url.protocol}//${url.hostname}${port && port !== '80' && port !== '443' ? `:${port}` : ''}`;
    return { label: `${url.hostname} (${source})`, host: url.hostname, origin, source, projectPath };
}
function uniqueDomains(domains) {
    const seen = new Set();
    return domains.filter((domain) => {
        const key = `${domain.host}|${domain.origin}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    }).sort((a, b) => a.host.localeCompare(b.host));
}
function expandHome(value) {
    return value === '~' || value.startsWith('~/') ? path.join(HOME, value.slice(2)) : value;
}
async function safeReadDir(dir) {
    try {
        return await fs.readdir(dir, { withFileTypes: true });
    }
    catch {
        return [];
    }
}
async function safeReadFile(file) {
    try {
        return await fs.readFile(file, 'utf8');
    }
    catch {
        return '';
    }
}
async function safeJson(file) {
    try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=domainScanner.js.map