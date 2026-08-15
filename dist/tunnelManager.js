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
exports.TunnelManager = void 0;
const node_child_process_1 = require("node:child_process");
const vscode = __importStar(require("vscode"));
class TunnelManager {
    process;
    activeTunnel;
    output = vscode.window.createOutputChannel('LocalFlare');
    changeEmitter = new vscode.EventEmitter();
    onDidChangeTunnels = this.changeEmitter.event;
    getTunnels() {
        return this.activeTunnel ? [this.activeTunnel] : [];
    }
    async login() {
        await this.runOneShot(['tunnel', 'login']);
    }
    async startQuickTunnel(domain) {
        this.stop();
        this.activeTunnel = {
            id: `quick:${domain.origin}`,
            kind: 'quick',
            domain,
            label: `Quick tunnel: ${domain.host}`,
            origin: domain.origin,
            status: 'starting',
        };
        this.changeEmitter.fire();
        this.start(['tunnel', '--url', domain.origin], `Quick tunnel for ${domain.host}`);
    }
    async startNamedTunnel(domain, hostname, tunnelName) {
        this.stop();
        await this.runOneShot(['tunnel', 'create', tunnelName], true);
        await this.runOneShot(['tunnel', 'route', 'dns', tunnelName, hostname], true);
        this.activeTunnel = {
            id: `named:${tunnelName}`,
            kind: 'named',
            domain,
            label: `${hostname} → ${domain.host}`,
            origin: domain.origin,
            hostname,
            publicUrl: `https://${hostname}`,
            status: 'starting',
        };
        this.changeEmitter.fire();
        this.start(['tunnel', 'run', '--url', domain.origin, tunnelName], `${hostname} → ${domain.origin}`);
    }
    stop() {
        if (this.process) {
            this.process.kill();
            this.process = undefined;
            this.output.appendLine('Stopped active cloudflared process.');
        }
        if (this.activeTunnel) {
            this.activeTunnel.status = 'stopped';
            this.changeEmitter.fire();
        }
    }
    start(args, label) {
        const executable = vscode.workspace.getConfiguration('localflare').get('cloudflaredPath', 'cloudflared');
        this.output.show(true);
        this.output.appendLine(`Starting ${label}`);
        this.output.appendLine(`$ ${executable} ${args.join(' ')}`);
        this.process = (0, node_child_process_1.spawn)(executable, args);
        this.process.stdout.on('data', (data) => this.handleOutput(data.toString()));
        this.process.stderr.on('data', (data) => this.handleOutput(data.toString()));
        this.process.on('error', (error) => {
            if (this.activeTunnel)
                this.activeTunnel.status = 'failed';
            this.changeEmitter.fire();
            vscode.window.showErrorMessage(`cloudflared failed: ${error.message}`);
        });
        this.process.on('exit', (code) => {
            this.output.appendLine(`cloudflared exited with code ${code ?? 'unknown'}.`);
            if (this.activeTunnel && this.activeTunnel.status !== 'stopped') {
                this.activeTunnel.status = code === 0 ? 'stopped' : 'failed';
            }
            this.process = undefined;
            this.changeEmitter.fire();
        });
    }
    handleOutput(text) {
        this.output.append(text);
        const quickUrl = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0];
        if (quickUrl && this.activeTunnel) {
            this.activeTunnel.publicUrl = quickUrl;
            this.activeTunnel.status = 'online';
            this.changeEmitter.fire();
            vscode.window.showInformationMessage(`LocalFlare tunnel is online: ${quickUrl}`, 'Copy URL')
                .then((choice) => choice === 'Copy URL' ? vscode.env.clipboard.writeText(quickUrl) : undefined);
        }
        if (/connection registered|registered tunnel connection|serving tunnel/i.test(text) && this.activeTunnel) {
            this.activeTunnel.status = 'online';
            this.changeEmitter.fire();
        }
    }
    async runOneShot(args, tolerateExisting = false) {
        const executable = vscode.workspace.getConfiguration('localflare').get('cloudflaredPath', 'cloudflared');
        this.output.show(true);
        this.output.appendLine(`$ ${executable} ${args.join(' ')}`);
        await new Promise((resolve, reject) => {
            const child = (0, node_child_process_1.spawn)(executable, args);
            let combined = '';
            child.stdout.on('data', (data) => { combined += data.toString(); this.output.append(data.toString()); });
            child.stderr.on('data', (data) => { combined += data.toString(); this.output.append(data.toString()); });
            child.on('error', reject);
            child.on('exit', (code) => {
                if (code === 0 || (tolerateExisting && /already exists|already has/i.test(combined)))
                    resolve();
                else
                    reject(new Error(`cloudflared exited with code ${code ?? 'unknown'}`));
            });
        });
    }
}
exports.TunnelManager = TunnelManager;
//# sourceMappingURL=tunnelManager.js.map