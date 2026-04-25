import * as vscode from 'vscode';
import { ThreadInfo, StackFrame, LocalVariable, MemorySnapshot, HeapSnapshot } from '../types';

/**
 * Captures thread/stack data from an active VS Code debug session
 * using the Debug Adapter Protocol (DAP).
 */
export class DebugSessionCapture {
    /**
     * Check if there's an active .NET debug session
     */
    static getActiveDotnetSession(): vscode.DebugSession | undefined {
        const session = vscode.debug.activeDebugSession;
        if (!session) { return undefined; }
        // Match coreclr, dotnet, or any .NET debugger type
        const dotnetTypes = ['coreclr', 'clr', 'dotnet', 'blazorwasm'];
        if (dotnetTypes.includes(session.type)) {
            return session;
        }
        // Also check by name pattern
        if (session.name.toLowerCase().includes('.net') || session.name.toLowerCase().includes('dotnet')) {
            return session;
        }
        return session; // Return any session as fallback
    }

    /**
     * Capture all threads and their stack frames from the active debug session
     */
    static async captureFromDebugSession(session: vscode.DebugSession): Promise<ThreadInfo[]> {
        const threads: ThreadInfo[] = [];

        try {
            // DAP request: get all threads
            const threadsResponse = await session.customRequest('threads');
            const dapThreads: any[] = threadsResponse.threads || [];

            for (const dapThread of dapThreads) {
                // DAP request: get stack trace for this thread
                let frames: StackFrame[] = [];
                try {
                    const stackResponse = await session.customRequest('stackTrace', {
                        threadId: dapThread.id,
                        startFrame: 0,
                        levels: 100, // Get up to 100 frames
                    });

                    const dapFrames: any[] = stackResponse.stackFrames || [];
                    frames = await Promise.all(
                        dapFrames.map(async (df: any, idx: number) => {
                            // Try to get scopes and variables for each frame
                            const locals = await this.getFrameLocals(session, df.id);
                            return this.convertDapFrame(df, dapThread.id, idx, locals);
                        })
                    );
                } catch (err) {
                    // Thread might not be stopped — skip its stack
                    console.log(`Could not get stack for thread ${dapThread.id}: ${err}`);
                }

                threads.push({
                    threadId: dapThread.id,
                    threadName: dapThread.name || `Thread ${dapThread.id}`,
                    isBackground: (dapThread.name || '').toLowerCase().includes('worker') ||
                                  (dapThread.name || '').toLowerCase().includes('pool'),
                    state: frames.length > 0 ? 'Stopped' : 'Running',
                    frames,
                });
            }
        } catch (err) {
            console.error('Failed to capture threads from debug session:', err);
        }

        return threads;
    }

    /**
     * Get local variables for a stack frame via DAP scopes + variables
     */
    private static async getFrameLocals(
        session: vscode.DebugSession,
        frameId: number
    ): Promise<LocalVariable[]> {
        const locals: LocalVariable[] = [];

        try {
            const scopesResponse = await session.customRequest('scopes', { frameId });
            const scopes: any[] = scopesResponse.scopes || [];

            for (const scope of scopes) {
                // Focus on "Locals" and "Arguments" scopes
                if (scope.name === 'Locals' || scope.name === 'Arguments' || scope.presentationHint === 'locals') {
                    try {
                        const varsResponse = await session.customRequest('variables', {
                            variablesReference: scope.variablesReference,
                        });
                        const variables: any[] = varsResponse.variables || [];

                        for (const v of variables) {
                            const isRef = this.isReferenceType(v.type || '');
                            locals.push({
                                name: v.name,
                                typeName: v.type || 'unknown',
                                value: v.value || '',
                                address: v.memoryReference || '0x0',
                                isReferenceType: isRef,
                                heapAddress: isRef && v.memoryReference ? v.memoryReference : undefined,
                            });
                        }
                    } catch {
                        // Variable fetch failed for this scope
                    }
                }
            }
        } catch {
            // Scope fetch failed
        }

        return locals;
    }

    /**
     * Convert a DAP StackFrame to our StackFrame type
     */
    private static convertDapFrame(
        dapFrame: any,
        threadId: number,
        index: number,
        locals: LocalVariable[]
    ): StackFrame {
        const fullName = dapFrame.name || 'Unknown';

        // Parse "Namespace.Class.Method" format
        let typeName = '';
        let methodName = fullName;
        let moduleName = '';

        // Extract module from source if available
        if (dapFrame.source && dapFrame.source.name) {
            moduleName = dapFrame.source.name.replace(/\.(cs|fs|vb)$/i, '');
        }

        // Split Type.Method
        const lastDot = fullName.lastIndexOf('.');
        if (lastDot > 0) {
            typeName = fullName.substring(0, lastDot);
            methodName = fullName.substring(lastDot + 1);
            // Clean up method name (remove parameter list)
            const parenIdx = methodName.indexOf('(');
            if (parenIdx > 0) {
                methodName = methodName.substring(0, parenIdx);
            }
        }

        // If moduleName is empty, try to extract from typeName
        if (!moduleName && typeName) {
            const firstDot = typeName.indexOf('.');
            if (firstDot > 0) {
                moduleName = typeName.substring(0, firstDot);
            } else {
                moduleName = typeName;
            }
        }

        return {
            id: `dap_${threadId}_${index}`,
            methodName,
            typeName,
            moduleName: moduleName || 'Unknown',
            ilOffset: dapFrame.instructionPointerReference ? parseInt(dapFrame.instructionPointerReference, 16) || 0 : 0,
            nativeOffset: 0,
            locals,
        };
    }

    /**
     * Heuristic to determine if a .NET type is a reference type
     */
    private static isReferenceType(typeName: string): boolean {
        if (!typeName) { return false; }
        const valueTypes = [
            'int', 'int32', 'int64', 'int16', 'byte', 'sbyte',
            'uint', 'uint32', 'uint64', 'uint16',
            'float', 'double', 'decimal', 'bool', 'boolean',
            'char', 'long', 'ulong', 'short', 'ushort',
            'intptr', 'uintptr', 'void', 'nint', 'nuint',
            'system.int32', 'system.int64', 'system.boolean',
            'system.double', 'system.single', 'system.byte',
            'system.char', 'system.decimal', 'system.datetime',
            'system.timespan', 'system.guid',
        ];
        const lower = typeName.toLowerCase().replace('?', '');
        if (valueTypes.includes(lower)) { return false; }
        // Structs and enums could be value types, but we can't know for sure
        // Default to reference type for complex types
        if (lower === 'string' || lower === 'system.string') { return true; }
        if (lower.includes('[]') || lower.includes('list') || lower.includes('dictionary')) { return true; }
        // If it has a dot (namespace), likely reference type
        if (typeName.includes('.')) { return true; }
        return false;
    }

    /**
     * Build a full MemorySnapshot from a debug session
     */
    static async buildSnapshot(session: vscode.DebugSession): Promise<MemorySnapshot> {
        const threads = await this.captureFromDebugSession(session);

        // Build a basic heap model from the variables we found
        const heap = this.buildHeapFromLocals(threads);

        return {
            timestamp: new Date().toISOString(),
            pid: 0, // DAP doesn't expose PID directly
            threads,
            heap,
        };
    }

    /**
     * Build a heap model from local variables found in stack frames
     */
    private static buildHeapFromLocals(threads: ThreadInfo[]): HeapSnapshot {
        const objectMap = new Map<string, any>();
        let totalSize = 0;

        // Collect all reference-type locals as heap objects
        for (const thread of threads) {
            for (const frame of thread.frames) {
                for (const local of frame.locals) {
                    if (local.isReferenceType && local.heapAddress && !objectMap.has(local.heapAddress)) {
                        const size = this.estimateSize(local.typeName);
                        objectMap.set(local.heapAddress, {
                            address: local.heapAddress,
                            typeName: local.typeName,
                            size,
                            generation: 0,
                            references: [],
                            referencedBy: [],
                            fields: [{
                                name: 'value',
                                typeName: local.typeName,
                                value: local.value,
                                offset: 0,
                                isReference: false,
                            }],
                        });
                        totalSize += size;
                    }
                }
            }
        }

        const objects = Array.from(objectMap.values());
        const typeMap = new Map<string, { count: number; size: number }>();
        for (const obj of objects) {
            const existing = typeMap.get(obj.typeName) || { count: 0, size: 0 };
            existing.count++;
            existing.size += obj.size;
            typeMap.set(obj.typeName, existing);
        }

        const typeStatistics = Array.from(typeMap.entries()).map(([typeName, stats]) => ({
            typeName,
            count: stats.count,
            totalSize: stats.size,
            percentage: totalSize > 0 ? (stats.size / totalSize) * 100 : 0,
        })).sort((a, b) => b.totalSize - a.totalSize);

        return {
            totalSize,
            objectCount: objects.length,
            gen0Count: objects.length,
            gen1Count: 0,
            gen2Count: 0,
            lohCount: 0,
            objects,
            typeStatistics,
        };
    }

    private static estimateSize(typeName: string): number {
        const lower = typeName.toLowerCase();
        if (lower.includes('string')) { return 64; }
        if (lower.includes('[]') || lower.includes('array')) { return 128; }
        if (lower.includes('list')) { return 96; }
        if (lower.includes('dictionary')) { return 160; }
        if (lower.includes('task')) { return 72; }
        return 48; // Default object size estimate
    }
}
