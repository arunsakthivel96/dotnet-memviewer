import * as vscode from 'vscode';
import { ProcessTreeProvider, ProcessItem } from './providers/processTreeProvider';
import { SnapshotTreeProvider } from './providers/snapshotTreeProvider';
import { DiagnosticsService } from './diagnostics/diagnosticsService';
import { DebugSessionCapture } from './diagnostics/debugSessionCapture';
import { MemoryVisualizerPanel } from './webview/memoryVisualizerPanel';
import { ToolChecker } from './diagnostics/toolChecker';

let diagnosticsService: DiagnosticsService;
let activeDebugSession: vscode.DebugSession | undefined;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
    console.log('.NET MemViewer is now active');

    const toolChecker = new ToolChecker();
    toolChecker.checkAndPromptInstall();

    diagnosticsService = new DiagnosticsService();

    const processProvider = new ProcessTreeProvider(diagnosticsService);
    const snapshotProvider = new SnapshotTreeProvider();

    // Status bar item — shows when debugging .NET
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusBarItem.command = 'memviewer.captureDebugSnapshot';
    statusBarItem.tooltip = 'Click to capture memory snapshot from debug session';
    context.subscriptions.push(statusBarItem);

    // Register tree views
    const processView = vscode.window.createTreeView('memviewer.processes', {
        treeDataProvider: processProvider,
        showCollapseAll: true,
    });

    const snapshotView = vscode.window.createTreeView('memviewer.snapshots', {
        treeDataProvider: snapshotProvider,
        showCollapseAll: true,
    });

    // ─── Debug Session Listeners ───────────────────────────────
    context.subscriptions.push(
        vscode.debug.onDidStartDebugSession((session) => {
            activeDebugSession = session;
            statusBarItem.text = '$(pulse) MemViewer: Debugging';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            statusBarItem.show();
            processProvider.setDebugSession(session);
            processProvider.refresh();
            vscode.window.showInformationMessage(
                `MemViewer: Detected debug session "${session.name}". Use "Capture Debug Snapshot" to inspect.`
            );
        }),

        vscode.debug.onDidTerminateDebugSession((session) => {
            if (activeDebugSession?.id === session.id) {
                activeDebugSession = undefined;
                statusBarItem.hide();
                processProvider.clearDebugSession();
                processProvider.refresh();
            }
        }),

        // When debugger stops (e.g., breakpoint hit), auto-notify
        vscode.debug.onDidChangeActiveDebugSession((session) => {
            if (session) {
                activeDebugSession = session;
                processProvider.setDebugSession(session);
            }
        })
    );

    // Check if already debugging on activation
    if (vscode.debug.activeDebugSession) {
        activeDebugSession = vscode.debug.activeDebugSession;
        statusBarItem.text = '$(pulse) MemViewer: Debugging';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        statusBarItem.show();
        processProvider.setDebugSession(activeDebugSession);
    }

    // ─── Command: Capture from active Debug Session ────────────
    const captureDebugCmd = vscode.commands.registerCommand(
        'memviewer.captureDebugSnapshot',
        async () => {
            const session = activeDebugSession || DebugSessionCapture.getActiveDotnetSession();
            if (!session) {
                const action = await vscode.window.showWarningMessage(
                    'No active debug session found. Start debugging a .NET app first, or load demo data.',
                    'Load Demo',
                    'Cancel'
                );
                if (action === 'Load Demo') {
                    vscode.commands.executeCommand('memviewer.loadDemo');
                }
                return;
            }

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'MemViewer: Capturing from debug session...',
                    cancellable: false,
                },
                async (progress) => {
                    try {
                        progress.report({ increment: 20, message: 'Reading threads...' });
                        const snapshot = await DebugSessionCapture.buildSnapshot(session);

                        progress.report({ increment: 60, message: 'Building visualization...' });
                        snapshotProvider.addSnapshot(snapshot);
                        MemoryVisualizerPanel.createOrShow(context.extensionUri, snapshot);

                        progress.report({ increment: 20, message: 'Done!' });
                        vscode.window.showInformationMessage(
                            `Captured ${snapshot.threads.length} threads, ${snapshot.threads.reduce((s, t) => s + t.frames.length, 0)} frames`
                        );
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Capture failed: ${err.message}`);
                    }
                }
            );
        }
    );

    // ─── Command: Select a .NET Process ────────────────────────
    const selectProcessCmd = vscode.commands.registerCommand(
        'memviewer.selectProcess',
        async () => {
            const processes = await diagnosticsService.listDotnetProcesses();
            if (processes.length === 0) {
                const action = await vscode.window.showWarningMessage(
                    'No running .NET processes found. Load demo data instead?',
                    'Load Demo', 'Cancel'
                );
                if (action === 'Load Demo') {
                    vscode.commands.executeCommand('memviewer.loadDemo');
                }
                return;
            }
            const items = processes.map(p => ({
                label: `$(terminal-process) ${p.name}`,
                description: `PID: ${p.pid}`,
                detail: p.commandLine || '',
                pid: p.pid,
            }));
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a .NET process to inspect',
                matchOnDescription: true,
                matchOnDetail: true,
            });
            if (selected) {
                diagnosticsService.setTargetProcess(selected.pid);
                processProvider.refresh();
                vscode.window.showInformationMessage(`Attached to PID: ${selected.pid}`);
            }
        }
    );

    // ─── Command: Capture Memory Snapshot (CLI-based) ──────────
    const captureSnapshotCmd = vscode.commands.registerCommand(
        'memviewer.captureSnapshot',
        async () => {
            // If there's an active debug session, prefer that
            if (activeDebugSession) {
                vscode.commands.executeCommand('memviewer.captureDebugSnapshot');
                return;
            }

            const targetPid = diagnosticsService.getTargetPid();
            if (!targetPid) {
                const action = await vscode.window.showWarningMessage(
                    'No .NET process selected. Load demo data instead?',
                    'Load Demo', 'Select Process'
                );
                if (action === 'Load Demo') {
                    vscode.commands.executeCommand('memviewer.loadDemo');
                } else if (action === 'Select Process') {
                    vscode.commands.executeCommand('memviewer.selectProcess');
                }
                return;
            }

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'MemViewer: Capturing memory snapshot...',
                    cancellable: true,
                },
                async (progress, token) => {
                    try {
                        progress.report({ increment: 10, message: 'Collecting thread stacks...' });
                        const stackData = await diagnosticsService.captureStackTrace(targetPid, token);
                        if (token.isCancellationRequested) { return; }

                        progress.report({ increment: 40, message: 'Collecting heap data...' });
                        const heapData = await diagnosticsService.captureHeapSnapshot(targetPid, token);
                        if (token.isCancellationRequested) { return; }

                        progress.report({ increment: 30, message: 'Building visualization...' });
                        const snapshot = {
                            timestamp: new Date().toISOString(),
                            pid: targetPid,
                            threads: stackData,
                            heap: heapData,
                        };
                        snapshotProvider.addSnapshot(snapshot);
                        MemoryVisualizerPanel.createOrShow(context.extensionUri, snapshot);
                        progress.report({ increment: 20, message: 'Done!' });
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Failed to capture: ${err.message}`);
                    }
                }
            );
        }
    );

    // ─── Other commands ────────────────────────────────────────
    const refreshCmd = vscode.commands.registerCommand('memviewer.refreshProcesses', () => {
        processProvider.refresh();
    });

    const openVisualizerCmd = vscode.commands.registerCommand('memviewer.openVisualizer', () => {
        const demoSnapshot = diagnosticsService.getDemoSnapshot();
        MemoryVisualizerPanel.createOrShow(context.extensionUri, demoSnapshot);
    });

    const loadDemoCmd = vscode.commands.registerCommand('memviewer.loadDemo', () => {
        const demoSnapshot = diagnosticsService.getDemoSnapshot();
        snapshotProvider.addSnapshot(demoSnapshot);
        MemoryVisualizerPanel.createOrShow(context.extensionUri, demoSnapshot);
        vscode.window.showInformationMessage('MemViewer: Loaded demo snapshot');
    });

    const processClickCmd = vscode.commands.registerCommand(
        'memviewer.onProcessClicked',
        (item: ProcessItem) => {
            diagnosticsService.setTargetProcess(item.pid);
            processProvider.refresh();
            vscode.window.showInformationMessage(`Selected process: ${item.label} (PID: ${item.pid})`);
        }
    );
    
    const clearSnapshotsCmd = vscode.commands.registerCommand('memviewer.clearSnapshots', async () => {
        const confirm = await vscode.window.showWarningMessage('Are you sure you want to clear all snapshots?', 'Yes', 'No');
        if (confirm === 'Yes') {
            snapshotProvider.clearAll();
            MemoryVisualizerPanel.currentPanel?.clear();
            vscode.window.showInformationMessage('MemViewer: Snapshots cleared');
        }
    });

    const clearLiveCmd = vscode.commands.registerCommand('memviewer.clearLiveMemory', () => {
        diagnosticsService.setTargetProcess(null);
        processProvider.refresh();
        MemoryVisualizerPanel.currentPanel?.clear();
        vscode.window.showInformationMessage('MemViewer: Live tracking reset');
    });

    const clearProcessesCmd = vscode.commands.registerCommand('memviewer.clearProcesses', () => {
        processProvider.clear();
        diagnosticsService.setTargetProcess(null);
        vscode.window.showInformationMessage('MemViewer: Process list cleared');
    });

    context.subscriptions.push(
        processView, snapshotView,
        captureDebugCmd, selectProcessCmd, captureSnapshotCmd,
        refreshCmd, openVisualizerCmd, loadDemoCmd, processClickCmd,
        clearSnapshotsCmd, clearLiveCmd, clearProcessesCmd
    );

    processProvider.refresh();
}

export function deactivate() {
    diagnosticsService?.dispose();
}
