import * as vscode from 'vscode';
import { DiagnosticsService } from '../diagnostics/diagnosticsService';
import { DotnetProcessInfo } from '../types';

export class ProcessItem extends vscode.TreeItem {
    constructor(
        public readonly pid: number,
        public readonly processName: string,
        public readonly cmdLine: string,
        public readonly isSelected: boolean,
        public readonly isDebugging: boolean = false
    ) {
        super(processName, vscode.TreeItemCollapsibleState.None);
        this.description = isDebugging ? `Debugging` : `PID: ${pid}`;
        this.tooltip = isDebugging
            ? `🔴 Active Debug Session\n${processName}`
            : `${processName} (PID: ${pid})\n${cmdLine}`;

        if (isDebugging) {
            this.iconPath = new vscode.ThemeIcon('debug-alt', new vscode.ThemeColor('charts.red'));
        } else if (isSelected) {
            this.iconPath = new vscode.ThemeIcon('debug-start', new vscode.ThemeColor('charts.green'));
        } else {
            this.iconPath = new vscode.ThemeIcon('terminal-process');
        }

        this.contextValue = isDebugging ? 'debuggingProcess' : 'dotnetProcess';

        if (!isDebugging) {
            this.command = {
                command: 'memviewer.onProcessClicked',
                title: 'Select Process',
                arguments: [this],
            };
        } else {
            this.command = {
                command: 'memviewer.captureDebugSnapshot',
                title: 'Capture Debug Snapshot',
            };
        }
    }
}

export class ProcessTreeProvider implements vscode.TreeDataProvider<ProcessItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ProcessItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private processes: DotnetProcessInfo[] = [];
    private debugSession: vscode.DebugSession | undefined;

    constructor(private diagnosticsService: DiagnosticsService) {}

    setDebugSession(session: vscode.DebugSession): void {
        this.debugSession = session;
    }

    clearDebugSession(): void {
        this.debugSession = undefined;
    }

    refresh(): void {
        this.diagnosticsService.listDotnetProcesses().then(procs => {
            this.processes = procs;
            this._onDidChangeTreeData.fire(undefined);
        });
    }

    clear(): void {
        this.processes = [];
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ProcessItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<ProcessItem[]> {
        const items: ProcessItem[] = [];
        const targetPid = this.diagnosticsService.getTargetPid();

        // Show active debug session first
        if (this.debugSession) {
            items.push(new ProcessItem(
                0,
                `🔴 ${this.debugSession.name}`,
                '',
                false,
                true
            ));
        }

        // Then show discovered processes
        for (const p of this.processes) {
            items.push(new ProcessItem(
                p.pid,
                p.name,
                p.commandLine || '',
                p.pid === targetPid,
                false
            ));
        }

        return items;
    }
}
