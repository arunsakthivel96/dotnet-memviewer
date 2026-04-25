import * as vscode from 'vscode';
import { MemorySnapshot } from '../types';

class SnapshotItem extends vscode.TreeItem {
    constructor(public readonly snapshot: MemorySnapshot, index: number) {
        super(`Snapshot #${index + 1}`, vscode.TreeItemCollapsibleState.None);
        const time = new Date(snapshot.timestamp).toLocaleTimeString();
        this.description = `PID ${snapshot.pid} — ${time}`;
        this.tooltip = `Threads: ${snapshot.threads.length}\nHeap Objects: ${snapshot.heap.objectCount}\nHeap Size: ${formatBytes(snapshot.heap.totalSize)}`;
        this.iconPath = new vscode.ThemeIcon('history');
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) { return bytes + ' B'; }
    if (bytes < 1024 * 1024) { return (bytes / 1024).toFixed(1) + ' KB'; }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export class SnapshotTreeProvider implements vscode.TreeDataProvider<SnapshotItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SnapshotItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private snapshots: MemorySnapshot[] = [];

    addSnapshot(snapshot: MemorySnapshot): void {
        this.snapshots.unshift(snapshot);
        this._onDidChangeTreeData.fire(undefined);
    }

    clearAll(): void {
        this.snapshots = [];
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: SnapshotItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<SnapshotItem[]> {
        return this.snapshots.map((s, i) => new SnapshotItem(s, i));
    }
}
