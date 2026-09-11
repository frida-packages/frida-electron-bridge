export interface Api {
    isolateGetCurrent: NativeFunction<NativePointer, []>;
    isolateGetCurrentContext: NativeFunction<NativePointer, [NativePointerValue]>;
    objectNew: NativeFunction<NativePointer, [NativePointerValue]>;
    getCurrentEventLoop: NativeFunction<NativePointer, [NativePointerValue]>;
    registerModuleBySymbol: NativeFunction<void, [NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue, number]>;
    functionCall: NativePointer;
    napi: Napi;
}

export interface Napi {
    openHandleScope: NativeFunction<number, [NativePointerValue, NativePointerValue]>;
    closeHandleScope: NativeFunction<number, [NativePointerValue, NativePointerValue]>;
    createThreadsafeFunction: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue, number, number, NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue]>;
    callThreadsafeFunction: NativeFunction<number, [NativePointerValue, NativePointerValue, number]>;
    unrefThreadsafeFunction: NativeFunction<number, [NativePointerValue, NativePointerValue]>;
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
    createFunction: NativeFunction<number, [NativePointerValue, NativePointerValue, number, NativePointerValue, NativePointerValue, NativePointerValue]>;
    getCbInfo: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue]>;
    throwError: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue]>;
    addFinalizer: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue]>;
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
    if (cachedApi === null) {
        cachedApi = detectApi();
    }
    return cachedApi;
}

export function whenApiAvailable(callback: ApiCallback): void {
    const api = tryGetApi();
    if (api !== null) {
        callback(api);
        return;
    }

    apiRequests.push(callback);

    if (moduleObserver === null) {
        moduleObserver = Process.attachModuleObserver({ onAdded: notifyApiRequesters });
    }
}

export type ApiCallback = (api: Api) => void;

function notifyApiRequesters(): void {
    const api = tryGetApi();
    if (api === null) {
        return;
    }

    moduleObserver!.detach();
    moduleObserver = null;

    const requests = apiRequests.splice(0);
    for (const request of requests) {
        request(api);
    }
}

let cachedApi: Api | null = null;
const apiRequests: ApiCallback[] = [];
let moduleObserver: ModuleObserver | null = null;

function detectApi(): Api | null {
    const runtime = Process.enumerateModules().find(m => m.findExportByName("napi_open_handle_scope") !== null);
    if (runtime === undefined) {
        return null;
    }

    const isolateGetCurrent = cxxFunction(runtime, "_ZN2v87Isolate10GetCurrentEv", "pointer", []);
    const isolateGetCurrentContext = cxxFunction(runtime, "_ZN2v87Isolate17GetCurrentContextEv", "pointer", ["pointer"]);
    const objectNew = cxxFunction(runtime, "_ZN2v86Object3NewEPNS_7IsolateE", "pointer", ["pointer"]);
    const getCurrentEventLoop = cxxFunction(runtime, "_ZN4node19GetCurrentEventLoopEPN2v87IsolateE", "pointer", ["pointer"]);
    const registerModuleBySymbol = cxxFunction(runtime,
        "_Z30napi_module_register_by_symbolN2v85LocalINS_6ObjectEEENS0_INS_5ValueEEENS0_INS_7ContextEEEPFP12napi_value__P10napi_env__S8_Ei",
        "void", ["pointer", "pointer", "pointer", "pointer", "int"]);
    const functionCall = runtime.findExportByName("_ZN2v88Function4CallENS_5LocalINS_7ContextEEENS1_INS_5ValueEEEiPS5_");
    if (isolateGetCurrent === null || isolateGetCurrentContext === null || objectNew === null
            || getCurrentEventLoop === null || registerModuleBySymbol === null || functionCall === null) {
        return null;
    }

    return {
        isolateGetCurrent,
        isolateGetCurrentContext,
        objectNew,
        getCurrentEventLoop,
        registerModuleBySymbol,
        functionCall,
        napi: makeNapi(runtime),
    };
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
        createFunction: bind("napi_create_function", [env, "pointer", "size_t", "pointer", "pointer", result]),
        getCbInfo: bind("napi_get_cb_info", [env, "pointer", "pointer", "pointer", result, "pointer"]),
        throwError: bind("napi_throw_error", [env, "pointer", "pointer"]),
        addFinalizer: bind("napi_add_finalizer", [env, value, "pointer", "pointer", "pointer", result]),
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

function cxxFunction(runtime: Module, symbol: string, retType: NativeFunctionReturnType, argTypes: NativeFunctionArgumentType[]): any {
    const address = runtime.findExportByName(symbol);
    if (address === null) {
        return null;
    }
    return new NativeFunction(address, retType, argTypes);
}
