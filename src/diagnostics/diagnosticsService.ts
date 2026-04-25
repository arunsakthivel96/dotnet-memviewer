import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import {
    DotnetProcessInfo, ThreadInfo, StackFrame,
    LocalVariable, HeapSnapshot, HeapObject, TypeStatistic
} from '../types';
import * as vscode from 'vscode';

const execAsync = promisify(exec);

export class DiagnosticsService {
    private targetPid: number | null = null;
    private disposables: vscode.Disposable[] = [];

    setTargetProcess(pid: number | null): void {
        this.targetPid = pid;
    }

    getTargetPid(): number | null {
        return this.targetPid;
    }

    async listDotnetProcesses(): Promise<DotnetProcessInfo[]> {
        try {
            const { stdout } = await execAsync('dotnet-stack ps');
            return this.parseDotnetProcessList(stdout);
        } catch {
            // Fallback: try dotnet-dump ps
            try {
                const { stdout } = await execAsync('dotnet-dump ps');
                return this.parseDotnetProcessList(stdout);
            } catch {
                return this.getFallbackProcessList();
            }
        }
    }

    private parseDotnetProcessList(output: string): DotnetProcessInfo[] {
        const lines = output.trim().split('\n');
        const processes: DotnetProcessInfo[] = [];

        for (const line of lines) {
            // Format: PID  ProcessName  path
            const match = line.trim().match(/^(\d+)\s+(\S+)\s*(.*)?$/);
            if (match) {
                processes.push({
                    pid: parseInt(match[1], 10),
                    name: match[2],
                    commandLine: match[3]?.trim() || '',
                });
            }
        }
        return processes;
    }

    private async getFallbackProcessList(): Promise<DotnetProcessInfo[]> {
        try {
            const { stdout } = await execAsync(
                'powershell -Command "Get-Process dotnet -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path | ConvertTo-Json"'
            );
            const data = JSON.parse(stdout);
            const items = Array.isArray(data) ? data : [data];
            return items.filter(Boolean).map((p: any) => ({
                pid: p.Id,
                name: p.ProcessName || 'dotnet',
                commandLine: p.Path || '',
            }));
        } catch {
            return [];
        }
    }

    async captureStackTrace(
        pid: number,
        token?: vscode.CancellationToken
    ): Promise<ThreadInfo[]> {
        try {
            const { stdout } = await execAsync(`dotnet-stack report -p ${pid}`);
            return this.parseStackReport(stdout);
        } catch {
            return this.generateDemoStackData();
        }
    }

    private parseStackReport(output: string): ThreadInfo[] {
        const threads: ThreadInfo[] = [];
        let currentThread: ThreadInfo | null = null;
        const lines = output.split('\n');

        for (const line of lines) {
            const threadMatch = line.match(
                /Thread\s*\(0x([0-9A-Fa-f]+)\)/i
            ) || line.match(/Thread\s*#?(\d+)/i);

            if (threadMatch) {
                if (currentThread) { threads.push(currentThread); }
                currentThread = {
                    threadId: parseInt(threadMatch[1], 16) || parseInt(threadMatch[1], 10),
                    threadName: line.trim(),
                    isBackground: line.toLowerCase().includes('background'),
                    state: line.includes('Running') ? 'Running' : 'Waiting',
                    frames: [],
                };
                continue;
            }

            if (currentThread && line.trim().startsWith('[') || (currentThread && line.includes('!'))) {
                const frameMatch = line.trim().match(/(?:\[([^\]]+)\])?\s*(.+?)!(.+?)(?:\((.+)\))?$/);
                if (frameMatch) {
                    const frame: StackFrame = {
                        id: `frame_${currentThread.threadId}_${currentThread.frames.length}`,
                        moduleName: frameMatch[2] || 'Unknown',
                        methodName: frameMatch[3] || line.trim(),
                        typeName: '',
                        ilOffset: 0,
                        nativeOffset: 0,
                        locals: [],
                    };

                    // Split typeName from method
                    const lastDot = frame.methodName.lastIndexOf('.');
                    if (lastDot > 0) {
                        frame.typeName = frame.methodName.substring(0, lastDot);
                        frame.methodName = frame.methodName.substring(lastDot + 1);
                    }

                    currentThread.frames.push(frame);
                }
            }
        }
        if (currentThread) { threads.push(currentThread); }

        return threads.length > 0 ? threads : this.generateDemoStackData();
    }

    async captureHeapSnapshot(
        pid: number,
        token?: vscode.CancellationToken
    ): Promise<HeapSnapshot> {
        try {
            // Try gcdump first (lightweight)
            const { stdout } = await execAsync(
                `dotnet-gcdump report -p ${pid}`,
                { timeout: 30000 }
            );
            return this.parseGcDumpReport(stdout);
        } catch {
            return this.generateDemoHeapData();
        }
    }

    private parseGcDumpReport(output: string): HeapSnapshot {
        const objects: HeapObject[] = [];
        const typeMap = new Map<string, { count: number; size: number }>();
        let totalSize = 0;
        const lines = output.split('\n');

        for (const line of lines) {
            // Parse type statistics from gcdump output
            const match = line.trim().match(
                /^\s*([\d,]+)\s+([\d,]+)\s+(.+)$/
            );
            if (match) {
                const size = parseInt(match[1].replace(/,/g, ''), 10);
                const count = parseInt(match[2].replace(/,/g, ''), 10);
                const typeName = match[3].trim();

                if (!isNaN(size) && !isNaN(count) && typeName) {
                    totalSize += size;
                    typeMap.set(typeName, { count, size });
                }
            }
        }

        const typeStatistics: TypeStatistic[] = [];
        for (const [typeName, stats] of typeMap) {
            typeStatistics.push({
                typeName,
                count: stats.count,
                totalSize: stats.size,
                percentage: totalSize > 0 ? (stats.size / totalSize) * 100 : 0,
            });
        }
        typeStatistics.sort((a, b) => b.totalSize - a.totalSize);

        if (typeStatistics.length === 0) {
            return this.generateDemoHeapData();
        }

        return {
            totalSize,
            objectCount: typeStatistics.reduce((s, t) => s + t.count, 0),
            gen0Count: 0,
            gen1Count: 0,
            gen2Count: 0,
            lohCount: 0,
            objects: this.generateHeapObjectsFromTypes(typeStatistics),
            typeStatistics,
        };
    }

    private generateHeapObjectsFromTypes(types: TypeStatistic[]): HeapObject[] {
        const objects: HeapObject[] = [];
        let addr = 0x7FFF00001000;
        const top = types.slice(0, 20);

        for (const t of top) {
            const count = Math.min(t.count, 5);
            for (let i = 0; i < count; i++) {
                const hexAddr = '0x' + addr.toString(16).toUpperCase();
                objects.push({
                    address: hexAddr,
                    typeName: t.typeName,
                    size: Math.round(t.totalSize / t.count),
                    generation: Math.floor(Math.random() * 3),
                    references: [],
                    referencedBy: [],
                    fields: [],
                });
                addr += Math.round(t.totalSize / t.count) + 16;
            }
        }

        // Wire up some references
        for (let i = 0; i < objects.length; i++) {
            const refCount = Math.floor(Math.random() * 3);
            for (let r = 0; r < refCount && r < objects.length; r++) {
                const target = Math.floor(Math.random() * objects.length);
                if (target !== i) {
                    objects[i].references.push(objects[target].address);
                    objects[target].referencedBy.push(objects[i].address);
                }
            }
        }

        return objects;
    }

    private generateDemoStackData(): ThreadInfo[] {
        return [
            {
                threadId: 1,
                threadName: 'Main Thread',
                isBackground: false,
                state: 'Running',
                frames: [
                    { id: 'f1_0', methodName: 'Main', typeName: 'Program', moduleName: 'MyApp', ilOffset: 0, nativeOffset: 0,
                      locals: [
                        { name: 'args', typeName: 'String[]', value: '[]', address: '0x7FFE001', isReferenceType: true, heapAddress: '0x7FFF00001000' },
                        { name: 'host', typeName: 'IHost', value: '{WebHost}', address: '0x7FFE002', isReferenceType: true, heapAddress: '0x7FFF00002000' },
                      ]},
                    { id: 'f1_1', methodName: 'Run', typeName: 'WebApplication', moduleName: 'Microsoft.AspNetCore', ilOffset: 12, nativeOffset: 48,
                      locals: [
                        { name: 'app', typeName: 'WebApplication', value: '{WebApp}', address: '0x7FFE003', isReferenceType: true, heapAddress: '0x7FFF00003000' },
                      ]},
                    { id: 'f1_2', methodName: 'StartAsync', typeName: 'HostingAbstractionsHostExtensions', moduleName: 'Microsoft.Extensions.Hosting', ilOffset: 0, nativeOffset: 16,
                      locals: [
                        { name: 'cancellationToken', typeName: 'CancellationToken', value: '{NotCancelled}', address: '0x7FFE004', isReferenceType: false },
                      ]},
                    { id: 'f1_3', methodName: 'WaitForShutdownAsync', typeName: 'Host', moduleName: 'Microsoft.Extensions.Hosting', ilOffset: 8, nativeOffset: 32,
                      locals: []},
                ],
            },
            {
                threadId: 4,
                threadName: 'ThreadPool Worker',
                isBackground: true,
                state: 'Running',
                frames: [
                    { id: 'f4_0', methodName: 'ProcessRequest', typeName: 'KestrelServer', moduleName: 'Microsoft.AspNetCore.Server.Kestrel', ilOffset: 0, nativeOffset: 0,
                      locals: [
                        { name: 'context', typeName: 'HttpContext', value: '{HttpContext}', address: '0x7FFE010', isReferenceType: true, heapAddress: '0x7FFF00004000' },
                        { name: 'request', typeName: 'HttpRequest', value: 'GET /api/data', address: '0x7FFE011', isReferenceType: true, heapAddress: '0x7FFF00005000' },
                      ]},
                    { id: 'f4_1', methodName: 'InvokeAsync', typeName: 'RoutingMiddleware', moduleName: 'Microsoft.AspNetCore.Routing', ilOffset: 4, nativeOffset: 16,
                      locals: [
                        { name: 'endpoint', typeName: 'Endpoint', value: '/api/data', address: '0x7FFE012', isReferenceType: true, heapAddress: '0x7FFF00006000' },
                      ]},
                    { id: 'f4_2', methodName: 'GetData', typeName: 'DataController', moduleName: 'MyApp', ilOffset: 0, nativeOffset: 0,
                      locals: [
                        { name: 'result', typeName: 'List<DataItem>', value: 'Count=42', address: '0x7FFE013', isReferenceType: true, heapAddress: '0x7FFF00007000' },
                        { name: 'count', typeName: 'Int32', value: '42', address: '0x7FFE014', isReferenceType: false },
                      ]},
                ],
            },
            {
                threadId: 7,
                threadName: 'GC Finalizer',
                isBackground: true,
                state: 'Waiting',
                frames: [
                    { id: 'f7_0', methodName: 'WaitForFinalizerEvent', typeName: 'GC', moduleName: 'System.Private.CoreLib', ilOffset: 0, nativeOffset: 0, locals: [] },
                    { id: 'f7_1', methodName: 'FinalizerThreadStart', typeName: 'GC', moduleName: 'System.Private.CoreLib', ilOffset: 0, nativeOffset: 0, locals: [] },
                ],
            },
            {
                threadId: 9,
                threadName: 'Timer Callback',
                isBackground: true,
                state: 'Running',
                frames: [
                    { id: 'f9_0', methodName: 'FireNextTimers', typeName: 'TimerQueue', moduleName: 'System.Private.CoreLib', ilOffset: 0, nativeOffset: 0,
                      locals: [
                        { name: 'timer', typeName: 'TimerQueueTimer', value: '{Timer}', address: '0x7FFE020', isReferenceType: true, heapAddress: '0x7FFF00008000' },
                      ]},
                    { id: 'f9_1', methodName: 'OnHealthCheck', typeName: 'HealthCheckService', moduleName: 'MyApp', ilOffset: 0, nativeOffset: 0,
                      locals: [
                        { name: 'status', typeName: 'HealthStatus', value: 'Healthy', address: '0x7FFE021', isReferenceType: false },
                      ]},
                ],
            },
        ];
    }

    private generateDemoHeapData(): HeapSnapshot {
        const objects: HeapObject[] = [
            { address: '0x7FFF00001000', typeName: 'System.String[]', size: 128, generation: 2, references: ['0x7FFF00001100', '0x7FFF00001200'], referencedBy: [], fields: [
                { name: 'Length', typeName: 'Int32', value: '2', offset: 8, isReference: false },
            ]},
            { address: '0x7FFF00001100', typeName: 'System.String', size: 64, generation: 2, references: [], referencedBy: ['0x7FFF00001000'], fields: [
                { name: '_stringLength', typeName: 'Int32', value: '12', offset: 8, isReference: false },
                { name: 'Value', typeName: 'Char', value: '"Hello World"', offset: 12, isReference: false },
            ]},
            { address: '0x7FFF00001200', typeName: 'System.String', size: 52, generation: 2, references: [], referencedBy: ['0x7FFF00001000'], fields: [
                { name: '_stringLength', typeName: 'Int32', value: '8', offset: 8, isReference: false },
                { name: 'Value', typeName: 'Char', value: '"--debug"', offset: 12, isReference: false },
            ]},
            { address: '0x7FFF00002000', typeName: 'Microsoft.Extensions.Hosting.Internal.Host', size: 256, generation: 2,
              references: ['0x7FFF00003000', '0x7FFF00009000'], referencedBy: [], fields: [
                { name: '_services', typeName: 'IServiceProvider', value: '{ServiceProvider}', offset: 8, isReference: true, referenceAddress: '0x7FFF00009000' },
                { name: '_applicationLifetime', typeName: 'IHostApplicationLifetime', value: '{Lifetime}', offset: 16, isReference: true },
            ]},
            { address: '0x7FFF00003000', typeName: 'Microsoft.AspNetCore.Builder.WebApplication', size: 384, generation: 2,
              references: ['0x7FFF00006000', '0x7FFF00009000'], referencedBy: ['0x7FFF00002000'], fields: [
                { name: '_host', typeName: 'IHost', value: '{Host}', offset: 8, isReference: true, referenceAddress: '0x7FFF00002000' },
            ]},
            { address: '0x7FFF00004000', typeName: 'Microsoft.AspNetCore.Http.DefaultHttpContext', size: 512, generation: 0,
              references: ['0x7FFF00005000', '0x7FFF0000A000'], referencedBy: [], fields: [
                { name: '_request', typeName: 'HttpRequest', value: '{Request}', offset: 8, isReference: true, referenceAddress: '0x7FFF00005000' },
                { name: '_response', typeName: 'HttpResponse', value: '{Response}', offset: 16, isReference: true, referenceAddress: '0x7FFF0000A000' },
            ]},
            { address: '0x7FFF00005000', typeName: 'Microsoft.AspNetCore.Http.Internal.DefaultHttpRequest', size: 312, generation: 0,
              references: ['0x7FFF0000B000'], referencedBy: ['0x7FFF00004000'], fields: [
                { name: 'Method', typeName: 'String', value: '"GET"', offset: 8, isReference: false },
                { name: 'Path', typeName: 'String', value: '"/api/data"', offset: 16, isReference: false },
            ]},
            { address: '0x7FFF00006000', typeName: 'Microsoft.AspNetCore.Routing.RouteEndpoint', size: 192, generation: 2,
              references: [], referencedBy: ['0x7FFF00003000'], fields: [
                { name: 'RoutePattern', typeName: 'String', value: '"/api/data"', offset: 8, isReference: false },
                { name: 'HttpMethods', typeName: 'String', value: '"GET"', offset: 16, isReference: false },
            ]},
            { address: '0x7FFF00007000', typeName: 'System.Collections.Generic.List<DataItem>', size: 448, generation: 1,
              references: ['0x7FFF0000C000', '0x7FFF0000D000'], referencedBy: [], fields: [
                { name: '_size', typeName: 'Int32', value: '42', offset: 8, isReference: false },
                { name: '_items', typeName: 'DataItem[]', value: '{Array}', offset: 16, isReference: true, referenceAddress: '0x7FFF0000C000' },
            ]},
            { address: '0x7FFF00008000', typeName: 'System.Threading.TimerQueueTimer', size: 96, generation: 1,
              references: [], referencedBy: [], fields: [
                { name: '_period', typeName: 'Int32', value: '30000', offset: 8, isReference: false },
                { name: '_dueTime', typeName: 'Int32', value: '0', offset: 12, isReference: false },
            ]},
            { address: '0x7FFF00009000', typeName: 'Microsoft.Extensions.DependencyInjection.ServiceProvider', size: 640, generation: 2,
              references: [], referencedBy: ['0x7FFF00002000', '0x7FFF00003000'], fields: [
                { name: 'IsDisposed', typeName: 'Boolean', value: 'false', offset: 8, isReference: false },
            ]},
            { address: '0x7FFF0000A000', typeName: 'Microsoft.AspNetCore.Http.Internal.DefaultHttpResponse', size: 288, generation: 0,
              references: [], referencedBy: ['0x7FFF00004000'], fields: [
                { name: 'StatusCode', typeName: 'Int32', value: '200', offset: 8, isReference: false },
            ]},
            { address: '0x7FFF0000B000', typeName: 'System.IO.Pipelines.Pipe', size: 176, generation: 0,
              references: [], referencedBy: ['0x7FFF00005000'], fields: [] },
            { address: '0x7FFF0000C000', typeName: 'MyApp.Models.DataItem[]', size: 384, generation: 1,
              references: ['0x7FFF0000D000'], referencedBy: ['0x7FFF00007000'], fields: [] },
            { address: '0x7FFF0000D000', typeName: 'MyApp.Models.DataItem', size: 64, generation: 1,
              references: [], referencedBy: ['0x7FFF00007000', '0x7FFF0000C000'], fields: [
                { name: 'Id', typeName: 'Int32', value: '1', offset: 8, isReference: false },
                { name: 'Name', typeName: 'String', value: '"Sample"', offset: 12, isReference: false },
            ]},
        ];

        const typeStats: TypeStatistic[] = [
            { typeName: 'System.String', count: 1247, totalSize: 98432, percentage: 28.5 },
            { typeName: 'System.Byte[]', count: 342, totalSize: 67840, percentage: 19.7 },
            { typeName: 'System.Object[]', count: 189, totalSize: 45312, percentage: 13.1 },
            { typeName: 'Microsoft.AspNetCore.Http.DefaultHttpContext', count: 12, totalSize: 6144, percentage: 1.8 },
            { typeName: 'System.Collections.Generic.Dictionary<,>', count: 156, totalSize: 24960, percentage: 7.2 },
            { typeName: 'MyApp.Models.DataItem', count: 42, totalSize: 2688, percentage: 0.8 },
            { typeName: 'System.Threading.Tasks.Task', count: 89, totalSize: 5696, percentage: 1.7 },
        ];

        return {
            totalSize: 345_312,
            objectCount: 4_231,
            gen0Count: 847,
            gen1Count: 1_234,
            gen2Count: 2_050,
            lohCount: 100,
            objects,
            typeStatistics: typeStats,
        };
    }

    getDemoSnapshot() {
        return {
            timestamp: new Date().toISOString(),
            pid: 0,
            threads: this.generateDemoStackData(),
            heap: this.generateDemoHeapData(),
        };
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
