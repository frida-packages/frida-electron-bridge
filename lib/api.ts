export interface Api {
    isolateGetCurrent: NativeFunction<NativePointer, []>;
    isolateGetCurrentContext: LocalGetter;
    objectNew: LocalGetter;
    getCurrentEventLoop: NativeFunction<NativePointer, [NativePointerValue]>;
    registerModule: ModuleRegistrar;
    jsEntryPoints: NativePointer[];
    wakeEventLoop: () => void;
    napi: Napi;
}

export type LocalGetter = (isolate: NativePointer) => NativePointer;

export type ModuleRegistrar = (exports: NativePointer, module: NativePointer, context: NativePointer,
    init: NativePointerValue) => void;

export interface Napi {
    openHandleScope: NativeFunction<number, [NativePointerValue, NativePointerValue]>;
    closeHandleScope: NativeFunction<number, [NativePointerValue, NativePointerValue]>;
    createThreadsafeFunction: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue, number, number, NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue]>;
    callThreadsafeFunction: NativeFunction<number, [NativePointerValue, NativePointerValue, number]>;
    unrefThreadsafeFunction: NativeFunction<number, [NativePointerValue, NativePointerValue]>;
    releaseThreadsafeFunction: NativeFunction<number, [NativePointerValue, number]>;
    isExceptionPending: NativeFunction<number, [NativePointerValue, NativePointerValue]>;
    getAndClearLastException: NativeFunction<number, [NativePointerValue, NativePointerValue]>;
    getLastErrorInfo: NativeFunction<number, [NativePointerValue, NativePointerValue]>;
    runScript: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue]>;
    typeof: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue]>;
    getUndefined: NativeFunction<number, [NativePointerValue, NativePointerValue]>;
    getNull: NativeFunction<number, [NativePointerValue, NativePointerValue]>;
    getBoolean: NativeFunction<number, [NativePointerValue, number, NativePointerValue]>;
    getGlobal: NativeFunction<number, [NativePointerValue, NativePointerValue]>;
    createDouble: NativeFunction<number, [NativePointerValue, number, NativePointerValue]>;
    createStringUtf8: NativeFunction<number, [NativePointerValue, NativePointerValue, number | UInt64, NativePointerValue]>;
    createObject: NativeFunction<number, [NativePointerValue, NativePointerValue]>;
    createArrayWithLength: NativeFunction<number, [NativePointerValue, number, NativePointerValue]>;
    createArraybuffer: NativeFunction<number, [NativePointerValue, number, NativePointerValue, NativePointerValue]>;
    createFunction: NativeFunction<number, [NativePointerValue, NativePointerValue, number, NativePointerValue, NativePointerValue, NativePointerValue]>;
    getCbInfo: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue]>;
    throwError: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue]>;
    createReference: NativeFunction<number, [NativePointerValue, NativePointerValue, number, NativePointerValue]>;
    deleteReference: NativeFunction<number, [NativePointerValue, NativePointerValue]>;
    getReferenceValue: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue]>;
    getValueBool: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue]>;
    getValueDouble: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue]>;
    getValueStringUtf8: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue, number | UInt64, NativePointerValue]>;
    getValueBigintInt64: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue]>;
    coerceToString: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue]>;
    getProperty: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue]>;
    setProperty: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue]>;
    hasProperty: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue]>;
    deleteProperty: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue]>;
    getPropertyNames: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue]>;
    getElement: NativeFunction<number, [NativePointerValue, NativePointerValue, number, NativePointerValue]>;
    setElement: NativeFunction<number, [NativePointerValue, NativePointerValue, number, NativePointerValue]>;
    getArrayLength: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue]>;
    isArray: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue]>;
    strictEquals: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue]>;
    instanceOf: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue]>;
    callFunction: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue, number, NativePointerValue, NativePointerValue]>;
    newInstance: NativeFunction<number, [NativePointerValue, NativePointerValue, number, NativePointerValue, NativePointerValue]>;
}

export const NAPI_OK = 0;
export const NAPI_PENDING_EXCEPTION = 10;

export const NAPI_AUTO_LENGTH = uint64("0xffffffffffffffff");

export const NAPI_TSFN_RELEASE = 0;
export const NAPI_TSFN_BLOCKING = 1;

export const MODULE_API_VERSION = 8;

export enum ValueType {
    Undefined,
    Null,
    Boolean,
    Number,
    String,
    Symbol,
    Object,
    Function,
    External,
    Bigint,
}

export function tryGetApi(): Api | null {
    const detection = detect();
    return (detection instanceof Error) ? null : detection;
}

export function whenApiAvailable(callback: ApiCallback): CancelApiRequest {
    const detection = detect();
    if (detection !== null) {
        callback(detection);
        return ignoreCancellation;
    }

    apiRequests.add(callback);

    if (moduleObserver === null) {
        moduleObserver = Process.attachModuleObserver({ onAdded: notifyApiRequesters });
    }

    return () => {
        if (apiRequests.delete(callback) && apiRequests.size === 0) {
            detachModuleObserver();
        }
    };
}

export type ApiCallback = (api: Api | Error) => void;
export type CancelApiRequest = () => void;

function detect(): Api | Error | null {
    if (cachedDetection === null) {
        cachedDetection = tryDetectApi();
    }
    return cachedDetection;
}

function tryDetectApi(): Api | Error | null {
    try {
        return detectApi();
    } catch (e) {
        return e as Error;
    }
}

function ignoreCancellation(): void {
}

function notifyApiRequesters(): void {
    const detection = detect();
    if (detection === null) {
        return;
    }

    detachModuleObserver();

    const requests = Array.from(apiRequests);
    apiRequests.clear();
    for (const request of requests) {
        request(detection);
    }
}

function detachModuleObserver(): void {
    moduleObserver!.detach();
    moduleObserver = null;
}

let cachedDetection: Api | Error | null = null;
const apiRequests = new Set<ApiCallback>();
let moduleObserver: ModuleObserver | null = null;

function detectApi(): Api | Error | null {
    const runtime = Process.enumerateModules().find(m => m.findExportByName("napi_open_handle_scope") !== null);
    if (runtime === undefined) {
        return null;
    }

    const { symbols } = cxxAbi;
    const registerModuleBySymbol = (symbols.registerModuleBySymbol !== null)
        ? runtime.findExportByName(symbols.registerModuleBySymbol)
        : null;
    const required = [
        symbols.isolateGetCurrent,
        symbols.isolateGetCurrentContext,
        symbols.objectNew,
        symbols.getCurrentEventLoop,
        symbols.functionCall,
        ...EVENT_LOOP_EXPORTS,
        ...((registerModuleBySymbol === null) ? ["napi_module_register"] : []),
    ];
    const missing = required.filter(name => runtime.findExportByName(name) === null);
    if (missing.length !== 0) {
        return new Error(`Unsupported Electron runtime: ${runtime.name} does not export ${missing.join(", ")}`);
    }

    const napiContextRegister = (registerModuleBySymbol === null)
        ? findCodeAddress(runtime, runtime.getExportByName("napi_module_register"))
        : null;
    if (registerModuleBySymbol === null && napiContextRegister === null) {
        return new Error(`Unsupported Electron runtime: unable to locate the module registration in ${runtime.name}`);
    }

    const defaultLoopSlot = findLoadedAddress(runtime.getExportByName("uv_default_loop"));
    if (defaultLoopSlot === null) {
        return new Error(`Unsupported Electron runtime: unable to locate libuv's default loop in ${runtime.name}`);
    }

    return {
        isolateGetCurrent: new NativeFunction(runtime.getExportByName(symbols.isolateGetCurrent), "pointer", []),
        isolateGetCurrentContext: cxxAbi.bindMethodReturningLocal(runtime.getExportByName(symbols.isolateGetCurrentContext)),
        objectNew: cxxAbi.bindFunctionReturningLocal(runtime.getExportByName(symbols.objectNew)),
        getCurrentEventLoop: new NativeFunction(runtime.getExportByName(symbols.getCurrentEventLoop), "pointer", ["pointer"]),
        registerModule: (registerModuleBySymbol !== null)
            ? makeSymbolRegistrar(registerModuleBySymbol)
            : makeContextRegistrar(napiContextRegister!),
        jsEntryPoints: [symbols.functionCall, symbols.functionCallWithIsolate, "uv_run"]
            .map(name => runtime.findExportByName(name))
            .filter(address => address !== null) as NativePointer[],
        wakeEventLoop: makeEventLoopWaker(runtime, defaultLoopSlot),
        napi: makeNapi(runtime),
    };
}

interface CxxAbi {
    symbols: CxxSymbols;
    bindMethodReturningLocal(address: NativePointer): LocalGetter;
    bindFunctionReturningLocal(address: NativePointer): LocalGetter;
}

interface CxxSymbols {
    isolateGetCurrent: string;
    isolateGetCurrentContext: string;
    objectNew: string;
    getCurrentEventLoop: string;
    functionCall: string;
    functionCallWithIsolate: string;
    registerModuleBySymbol: string | null;
}

const itaniumAbi: CxxAbi = {
    symbols: {
        isolateGetCurrent: "_ZN2v87Isolate10GetCurrentEv",
        isolateGetCurrentContext: "_ZN2v87Isolate17GetCurrentContextEv",
        objectNew: "_ZN2v86Object3NewEPNS_7IsolateE",
        getCurrentEventLoop: "_ZN4node19GetCurrentEventLoopEPN2v87IsolateE",
        functionCall: "_ZN2v88Function4CallENS_5LocalINS_7ContextEEENS1_INS_5ValueEEEiPS5_",
        functionCallWithIsolate: "_ZN2v88Function4CallEPNS_7IsolateENS_5LocalINS_7ContextEEENS3_INS_5ValueEEEiPS7_",
        registerModuleBySymbol:
            "_Z30napi_module_register_by_symbolN2v85LocalINS_6ObjectEEENS0_INS_5ValueEEENS0_INS_7ContextEEEPFP12napi_value__P10napi_env__S8_Ei",
    },
    bindMethodReturningLocal: returnLocalInRegister,
    bindFunctionReturningLocal: returnLocalInRegister,
};

const msvcAbi: CxxAbi = {
    symbols: {
        isolateGetCurrent: "?GetCurrent@Isolate@v8@@SAPEAV12@XZ",
        isolateGetCurrentContext: "?GetCurrentContext@Isolate@v8@@QEAA?AV?$Local@VContext@v8@@@2@XZ",
        objectNew: "?New@Object@v8@@SA?AV?$Local@VObject@v8@@@2@PEAVIsolate@2@@Z",
        getCurrentEventLoop: "?GetCurrentEventLoop@node@@YAPEAUuv_loop_s@@PEAVIsolate@v8@@@Z",
        functionCall: "?Call@Function@v8@@QEAA?AV?$MaybeLocal@VValue@v8@@@2@V?$Local@VContext@v8@@@2@V?$Local@VValue@v8@@@2@HQEAV52@@Z",
        functionCallWithIsolate:
            "?Call@Function@v8@@QEAA?AV?$MaybeLocal@VValue@v8@@@2@PEAVIsolate@2@V?$Local@VContext@v8@@@2@V?$Local@VValue@v8@@@2@HQEAV62@@Z",
        registerModuleBySymbol: null,
    },
    bindMethodReturningLocal: returnLocalThroughSlotAfterThis,
    bindFunctionReturningLocal: returnLocalThroughLeadingSlot,
};

const cxxAbi = (Process.platform === "windows") ? msvcAbi : itaniumAbi;

function returnLocalInRegister(address: NativePointer): LocalGetter {
    const impl = new NativeFunction(address, "pointer", ["pointer"]);
    return isolate => impl(isolate);
}

function returnLocalThroughSlotAfterThis(address: NativePointer): LocalGetter {
    const impl = new NativeFunction(address, "pointer", ["pointer", "pointer"]);
    return isolate => impl(isolate, Memory.alloc(Process.pointerSize)).readPointer();
}

function returnLocalThroughLeadingSlot(address: NativePointer): LocalGetter {
    const impl = new NativeFunction(address, "pointer", ["pointer", "pointer"]);
    return isolate => impl(Memory.alloc(Process.pointerSize), isolate).readPointer();
}

function makeSymbolRegistrar(address: NativePointer): ModuleRegistrar {
    const impl = new NativeFunction(address, "void", ["pointer", "pointer", "pointer", "pointer", "int"]);
    return (exports, module, context, init) => {
        impl(exports, module, context, init, MODULE_API_VERSION);
    };
}

const NAPI_MODULE_REGISTER_FUNC_OFFSET = 8 + Process.pointerSize;
const NAPI_MODULE_SIZE = 8 + 8 * Process.pointerSize;

function makeContextRegistrar(address: NativePointer): ModuleRegistrar {
    const impl = new NativeFunction(address, "void", ["pointer", "pointer", "pointer", "pointer"]);
    return (exports, module, context, init) => {
        const napiModule = Memory.alloc(NAPI_MODULE_SIZE);
        napiModule.add(NAPI_MODULE_REGISTER_FUNC_OFFSET).writePointer(init);
        impl(exports, module, context, napiModule);
    };
}

const INSTRUCTION_SEARCH_LIMIT = 32;

function findCodeAddress(runtime: Module, code: NativePointer): NativePointer | null {
    const address = findPcRelativeAddress(code, "address");
    if (address === null || address.compare(runtime.base) < 0 || address.compare(runtime.base.add(runtime.size)) >= 0) {
        return null;
    }
    return address;
}

function findLoadedAddress(code: NativePointer): NativePointer | null {
    return findPcRelativeAddress(code, "load");
}

function findPcRelativeAddress(code: NativePointer, use: "address" | "load"): NativePointer | null {
    const pages = new Map<string, NativePointer>();
    let cursor = code;
    for (let i = 0; i !== INSTRUCTION_SEARCH_LIMIT; i++) {
        const insn = Instruction.parse(cursor) as Arm64Instruction | X86Instruction;
        const [destination, source, offset] = insn.operands as any[];
        if (insn.mnemonic === "adrp") {
            pages.set(destination.value, ptr(source.value.toString()));
        } else if (use === "address") {
            if (insn.mnemonic === "adr") {
                return ptr(source.value.toString());
            }
            if (insn.mnemonic === "add" && pages.has(source.value) && offset?.type === "imm") {
                return pages.get(source.value)!.add(offset.value);
            }
            if (insn.mnemonic === "lea" && source.value.base === "rip") {
                return insn.next.add(source.value.disp);
            }
        } else if (source?.type === "mem") {
            const { base, disp } = source.value;
            if (base === "rip") {
                return insn.next.add(disp);
            }
            const page = pages.get(base);
            if (page !== undefined) {
                return page.add(disp);
            }
        }
        cursor = insn.next;
    }
    return null;
}

const EVENT_LOOP_EXPORTS = ["uv_run", "uv_default_loop", "uv_async_send"];

function makeEventLoopWaker(runtime: Module, defaultLoopSlot: NativePointer): () => void {
    const asyncSend = new NativeFunction(runtime.getExportByName("uv_async_send"), "int", ["pointer"]);
    let wakeupHandle: NativePointer | null = null;
    return () => {
        if (wakeupHandle === null) {
            const loop = defaultLoopSlot.readPointer();
            if (loop.isNull()) {
                return;
            }
            wakeupHandle = findWorkQueueAsync(loop);
            if (wakeupHandle === null) {
                return;
            }
        }
        asyncSend(wakeupHandle);
    };
}

const UV_ASYNC = 1;
const UV_LOOP_SCAN_LIMIT = 1024;

function findWorkQueueAsync(loop: NativePointer): NativePointer | null {
    const loopFieldOffset = Process.pointerSize;
    const typeFieldOffset = 2 * Process.pointerSize;
    for (let offset = 0; offset !== UV_LOOP_SCAN_LIMIT; offset += Process.pointerSize) {
        const candidate = loop.add(offset);
        if (candidate.add(loopFieldOffset).readPointer().equals(loop) && candidate.add(typeFieldOffset).readU32() === UV_ASYNC) {
            return candidate;
        }
    }
    return null;
}

function makeNapi(runtime: Module): Napi {
    const bind = (name: string, argTypes: NativeFunctionArgumentType[]): any =>
        new NativeFunction(runtime.getExportByName(name), "int", argTypes);

    const env = "pointer";
    const value = "pointer";
    const result = "pointer";

    return {
        openHandleScope: bind("napi_open_handle_scope", [env, result]),
        closeHandleScope: bind("napi_close_handle_scope", [env, value]),
        createThreadsafeFunction: bind("napi_create_threadsafe_function",
            [env, value, value, value, "size_t", "size_t", "pointer", "pointer", "pointer", "pointer", result]),
        callThreadsafeFunction: bind("napi_call_threadsafe_function", [value, "pointer", "int"]),
        unrefThreadsafeFunction: bind("napi_unref_threadsafe_function", [env, value]),
        releaseThreadsafeFunction: bind("napi_release_threadsafe_function", [value, "int"]),
        isExceptionPending: bind("napi_is_exception_pending", [env, result]),
        getAndClearLastException: bind("napi_get_and_clear_last_exception", [env, result]),
        getLastErrorInfo: bind("napi_get_last_error_info", [env, result]),
        runScript: bind("napi_run_script", [env, value, result]),
        typeof: bind("napi_typeof", [env, value, result]),
        getUndefined: bind("napi_get_undefined", [env, result]),
        getNull: bind("napi_get_null", [env, result]),
        getBoolean: bind("napi_get_boolean", [env, "bool", result]),
        getGlobal: bind("napi_get_global", [env, result]),
        createDouble: bind("napi_create_double", [env, "double", result]),
        createStringUtf8: bind("napi_create_string_utf8", [env, "pointer", "size_t", result]),
        createObject: bind("napi_create_object", [env, result]),
        createArrayWithLength: bind("napi_create_array_with_length", [env, "size_t", result]),
        createArraybuffer: bind("napi_create_arraybuffer", [env, "size_t", "pointer", result]),
        createFunction: bind("napi_create_function", [env, "pointer", "size_t", "pointer", "pointer", result]),
        getCbInfo: bind("napi_get_cb_info", [env, "pointer", "pointer", "pointer", result, "pointer"]),
        throwError: bind("napi_throw_error", [env, "pointer", "pointer"]),
        createReference: bind("napi_create_reference", [env, value, "uint32", result]),
        deleteReference: bind("napi_delete_reference", [env, value]),
        getReferenceValue: bind("napi_get_reference_value", [env, value, result]),
        getValueBool: bind("napi_get_value_bool", [env, value, result]),
        getValueDouble: bind("napi_get_value_double", [env, value, result]),
        getValueStringUtf8: bind("napi_get_value_string_utf8", [env, value, "pointer", "size_t", result]),
        getValueBigintInt64: bind("napi_get_value_bigint_int64", [env, value, result, "pointer"]),
        coerceToString: bind("napi_coerce_to_string", [env, value, result]),
        getProperty: bind("napi_get_property", [env, value, value, result]),
        setProperty: bind("napi_set_property", [env, value, value, value]),
        hasProperty: bind("napi_has_property", [env, value, value, result]),
        deleteProperty: bind("napi_delete_property", [env, value, value, result]),
        getPropertyNames: bind("napi_get_property_names", [env, value, result]),
        getElement: bind("napi_get_element", [env, value, "uint32", result]),
        setElement: bind("napi_set_element", [env, value, "uint32", value]),
        getArrayLength: bind("napi_get_array_length", [env, value, result]),
        isArray: bind("napi_is_array", [env, value, result]),
        strictEquals: bind("napi_strict_equals", [env, value, value, result]),
        instanceOf: bind("napi_instanceof", [env, value, value, result]),
        callFunction: bind("napi_call_function", [env, value, value, "size_t", "pointer", result]),
        newInstance: bind("napi_new_instance", [env, value, "size_t", "pointer", result]),
    };
}
