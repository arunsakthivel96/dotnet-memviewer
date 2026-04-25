export interface DotnetProcessInfo {
    pid: number;
    name: string;
    commandLine?: string;
}

export interface ThreadInfo {
    threadId: number;
    threadName: string;
    isBackground: boolean;
    state: string;
    frames: StackFrame[];
}

export interface StackFrame {
    id: string;
    methodName: string;
    typeName: string;
    moduleName: string;
    ilOffset: number;
    nativeOffset: number;
    locals: LocalVariable[];
}

export interface LocalVariable {
    name: string;
    typeName: string;
    value: string;
    address: string;
    isReferenceType: boolean;
    heapAddress?: string;
}

export interface HeapObject {
    address: string;
    typeName: string;
    size: number;
    generation: number;
    references: string[];
    referencedBy: string[];
    fields: ObjectField[];
}

export interface ObjectField {
    name: string;
    typeName: string;
    value: string;
    offset: number;
    isReference: boolean;
    referenceAddress?: string;
}

export interface HeapSnapshot {
    totalSize: number;
    objectCount: number;
    gen0Count: number;
    gen1Count: number;
    gen2Count: number;
    lohCount: number;
    objects: HeapObject[];
    typeStatistics: TypeStatistic[];
}

export interface TypeStatistic {
    typeName: string;
    count: number;
    totalSize: number;
    percentage: number;
}

export interface MemorySnapshot {
    timestamp: string;
    pid: number;
    threads: ThreadInfo[];
    heap: HeapSnapshot;
}

export interface WebviewMessage {
    command: string;
    data?: any;
}
