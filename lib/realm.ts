import {
    Api,
    NAPI_AUTO_LENGTH,
    NAPI_OK,
    NAPI_PENDING_EXCEPTION,
    Napi,
    ValueType,
} from "./api.js";
import { JsProxy, JsRef, JsValue, makeProxy, unwrap, unwrapSymbol } from "./value.js";

export const disposeSymbol = Symbol("frida-electron-bridge.dispose");
export const abandonSymbol = Symbol("frida-electron-bridge.abandon");

export class Realm {
    #env: NativePointer;
    #napi: Napi;
    #scratch: NativePointer;
    #disposedFlag: NativePointer;
    #functionWrapper: JsRef;
    #requireFn: JsRef | null = null;
    #refs = new Set<JsRef>();
    #functions = new Map<number, Function>();
    #nextFunctionId = 1;
    #pendingAwaits = new Set<(reason: Error) => void>();
    #invokeCallback: NativeCallback<"pointer", ["pointer", "pointer"]>;
    #releaseCallback: NativeCallback<"pointer", ["pointer", "pointer"]>;

    constructor(env: NativePointer, api: Api) {
        this.#env = env;
        this.#napi = api.napi;
        this.#scratch = Memory.alloc(2 * Process.pointerSize);

        this.#invokeCallback = new NativeCallback((_env: NativePointer, info: NativePointer): NativePointer => {
            return this.#dispatchToAgent(info).handle;
        }, "pointer", ["pointer", "pointer"]);
        this.#releaseCallback = new NativeCallback((_env: NativePointer, info: NativePointer): NativePointer => {
            return this.#releaseAgentFunction(info).handle;
        }, "pointer", ["pointer", "pointer"]);

        const { disposedFlag, functionWrapper } = this.withScope(() => this.#createFunctionWrapper());
        this.#disposedFlag = disposedFlag;
        this.#functionWrapper = functionWrapper;
    }

    get global(): JsProxy {
        return this.#invoke(this.#napi.getGlobal).wrap();
    }

    require(id: string): JsProxy {
        const require = this.#getRequire();
        return makeProxy(this.callFunction(require, null, [id]), null);
    }

    evaluate(source: string): JsProxy {
        const { runScript } = this.#napi;
        const result = this.#scratch;
        this.#check(runScript(this.#env, this.newString(source).handle, result));
        return this.#adopt(result.readPointer()).wrap();
    }

    toJs(value: any): any {
        return unwrap(value).toJs();
    }

    await(value: any): Promise<any> {
        const promise = unwrap(value);
        return new Promise((resolve, reject) => {
            this.#pendingAwaits.add(reject);
            const onSettled = [
                (result: any) => {
                    this.#pendingAwaits.delete(reject);
                    resolve(this.toJs(result));
                },
                (reason: any) => {
                    this.#pendingAwaits.delete(reject);
                    reject(new Error(this.readString(unwrap(reason))));
                },
            ];
            this.callFunction(this.getProperty(promise, "then"), promise, onSettled);
        });
    }

    persist(value: any): JsRef {
        const result = this.#scratch;
        this.#check(this.#napi.createReference(this.#env, unwrap(value).handle, 1, result));
        const ref = new JsRef(this, result.readPointer());
        this.#refs.add(ref);
        return ref;
    }

    resolveRef(ref: JsRef): JsValue {
        const result = this.#scratch;
        this.#check(this.#napi.getReferenceValue(this.#env, ref.handle, result));
        return this.#adopt(result.readPointer());
    }

    freeRef(ref: JsRef): void {
        this.#refs.delete(ref);
        this.#check(this.#napi.deleteReference(this.#env, ref.handle));
    }

    withScope<T>(fn: () => T): T {
        const { openHandleScope, closeHandleScope } = this.#napi;

        const result = this.#scratch;
        this.#check(openHandleScope(this.#env, result));
        const scope = result.readPointer();
        try {
            return fn();
        } finally {
            closeHandleScope(this.#env, scope);
        }
    }

    newString(value: string): JsValue {
        const { createStringUtf8 } = this.#napi;
        const result = this.#scratch;
        this.#check(createStringUtf8(this.#env, Memory.allocUtf8String(value), NAPI_AUTO_LENGTH, result));
        return this.#adopt(result.readPointer());
    }

    fromJs(value: any): JsValue {
        const napi = this.#napi;
        switch (typeof value) {
            case "undefined":
                return this.#invoke(napi.getUndefined);
            case "boolean":
                return this.#invokeWith(napi.getBoolean, value ? 1 : 0);
            case "number":
                return this.#invokeWith(napi.createDouble, value);
            case "string":
                return this.newString(value);
            case "function":
                return this.#fromJsFunction(value);
            case "object":
                return (value === null) ? this.#invoke(napi.getNull) : this.#fromJsObject(value);
            default:
                return unwrap(value);
        }
    }

    get liveCallbacks(): number {
        return this.#functions.size;
    }

    typeOf(value: JsValue): ValueType {
        const result = this.#scratch;
        this.#check(this.#napi.typeof(this.#env, value.handle, result));
        return result.readInt() as ValueType;
    }

    isArray(value: JsValue): boolean {
        return this.#queryBoolean(this.#napi.isArray, value);
    }

    arrayLength(value: JsValue): number {
        const result = this.#scratch;
        this.#check(this.#napi.getArrayLength(this.#env, value.handle, result));
        return result.readU32();
    }

    readString(value: JsValue): string {
        const { coerceToString, getValueStringUtf8 } = this.#napi;
        const env = this.#env;
        const result = this.#scratch;

        this.#check(coerceToString(env, value.handle, result));
        const str = result.readPointer();

        this.#check(getValueStringUtf8(env, str, NULL, 0, result));
        const size = result.readULong().valueOf() + 1;

        const buffer = Memory.alloc(size);
        this.#check(getValueStringUtf8(env, str, buffer, size, result));
        return buffer.readUtf8String()!;
    }

    readNumber(value: JsValue): number {
        const result = this.#scratch;
        this.#check(this.#napi.getValueDouble(this.#env, value.handle, result));
        return result.readDouble();
    }

    readBoolean(value: JsValue): boolean {
        const result = this.#scratch;
        this.#check(this.#napi.getValueBool(this.#env, value.handle, result));
        return result.readU8() !== 0;
    }

    readBigInt(value: JsValue): bigint {
        const result = this.#scratch;
        this.#check(this.#napi.getValueBigintInt64(this.#env, value.handle, result, result.add(Process.pointerSize)));
        return BigInt(result.readS64().toString());
    }

    getProperty(target: JsValue, key: string): JsValue {
        const result = this.#scratch;
        this.#check(this.#napi.getProperty(this.#env, target.handle, this.newString(key).handle, result));
        return this.#adopt(result.readPointer());
    }

    setProperty(target: JsValue, key: string, value: any): void {
        this.#check(this.#napi.setProperty(this.#env, target.handle, this.newString(key).handle, this.fromJs(value).handle));
    }

    hasProperty(target: JsValue, key: string): boolean {
        const result = this.#scratch;
        this.#check(this.#napi.hasProperty(this.#env, target.handle, this.newString(key).handle, result));
        return result.readU8() !== 0;
    }

    deleteProperty(target: JsValue, key: string): boolean {
        const result = this.#scratch;
        this.#check(this.#napi.deleteProperty(this.#env, target.handle, this.newString(key).handle, result));
        return result.readU8() !== 0;
    }

    propertyNames(target: JsValue): string[] {
        const result = this.#scratch;
        this.#check(this.#napi.getPropertyNames(this.#env, target.handle, result));
        const names = this.#adopt(result.readPointer());

        const keys: string[] = [];
        const n = this.arrayLength(names);
        for (let i = 0; i !== n; i++) {
            keys.push(this.readString(this.getElement(names, i)));
        }
        return keys;
    }

    getElement(target: JsValue, index: number): JsValue {
        const result = this.#scratch;
        this.#check(this.#napi.getElement(this.#env, target.handle, index, result));
        return this.#adopt(result.readPointer());
    }

    setElement(target: JsValue, index: number, value: any): void {
        this.#check(this.#napi.setElement(this.#env, target.handle, index, this.fromJs(value).handle));
    }

    callFunction(target: JsValue, receiver: JsValue | null, args: any[]): JsValue {
        const result = this.#scratch;
        const self = (receiver !== null) ? receiver : this.#invoke(this.#napi.getUndefined);
        this.#check(this.#napi.callFunction(this.#env, self.handle, target.handle, args.length, this.#marshalArgs(args), result));
        return this.#adopt(result.readPointer());
    }

    construct(target: JsValue, args: any[]): JsValue {
        const result = this.#scratch;
        this.#check(this.#napi.newInstance(this.#env, target.handle, args.length, this.#marshalArgs(args), result));
        return this.#adopt(result.readPointer());
    }

    instanceOf(value: JsValue, constructor: JsValue): boolean {
        const result = this.#scratch;
        this.#check(this.#napi.instanceOf(this.#env, value.handle, constructor.handle, result));
        return result.readU8() !== 0;
    }

    strictEquals(a: JsValue, b: JsValue): boolean {
        const result = this.#scratch;
        this.#check(this.#napi.strictEquals(this.#env, a.handle, b.handle, result));
        return result.readU8() !== 0;
    }

    [disposeSymbol](): void {
        this[abandonSymbol]();

        for (const ref of Array.from(this.#refs)) {
            ref.free();
        }

        const disposed = new Error("Electron bridge disposed");
        for (const reject of Array.from(this.#pendingAwaits)) {
            reject(disposed);
        }
        this.#pendingAwaits.clear();
    }

    [abandonSymbol](): void {
        this.#disposedFlag.writeU8(1);
    }

    #createFunctionWrapper(): { disposedFlag: NativePointer, functionWrapper: JsRef } {
        const result = this.#scratch;
        this.#check(this.#napi.createArraybuffer(this.#env, 1, result, result.add(Process.pointerSize)));
        const disposedFlag = result.readPointer();
        const flagBuffer = this.#adopt(result.add(Process.pointerSize).readPointer());

        const factory = unwrap(this.evaluate(FUNCTION_WRAPPER_FACTORY));
        const wrapper = this.callFunction(factory, null, [
            flagBuffer,
            this.#newNativeFunction(this.#invokeCallback),
            this.#newNativeFunction(this.#releaseCallback),
        ]);

        return { disposedFlag, functionWrapper: this.persist(wrapper) };
    }

    #newNativeFunction(callback: NativeCallback<"pointer", ["pointer", "pointer"]>): JsValue {
        const result = this.#scratch;
        this.#check(this.#napi.createFunction(this.#env, NULL, 0, callback, NULL, result));
        return this.#adopt(result.readPointer());
    }

    #getRequire(): JsValue {
        if (this.#requireFn === null) {
            this.#requireFn = this.persist(this.evaluate(REQUIRE_LOOKUP));
        }
        return this.#requireFn.get();
    }

    #fromJsFunction(value: Function): JsValue {
        const wrapped = (value as any)[unwrapSymbol];
        if (wrapped !== undefined) {
            return wrapped;
        }
        return this.#newFunction(value);
    }

    #newFunction(fn: Function): JsValue {
        const id = this.#nextFunctionId++;
        this.#functions.set(id, fn);
        return this.callFunction(this.#functionWrapper.get(), null, [id]);
    }

    #dispatchToAgent(info: NativePointer): JsValue {
        const [id, ...args] = this.#readArguments(info);
        const fn = this.#functions.get(this.readNumber(id))!;
        try {
            return this.fromJs(fn(...args.map(arg => arg.wrap())));
        } catch (e) {
            this.#napi.throwError(this.#env, NULL, Memory.allocUtf8String((e as Error).message));
            return this.#invoke(this.#napi.getUndefined);
        }
    }

    #releaseAgentFunction(info: NativePointer): JsValue {
        const [id] = this.#readArguments(info);
        this.#functions.delete(this.readNumber(id));
        return this.#invoke(this.#napi.getUndefined);
    }

    #readArguments(info: NativePointer): JsValue[] {
        const { getCbInfo } = this.#napi;
        const env = this.#env;

        const argc = Memory.alloc(Process.pointerSize);
        getCbInfo(env, info, argc, NULL, NULL, NULL);
        const n = argc.readPointer().toUInt32();

        const argv = Memory.alloc(Math.max(n, 1) * Process.pointerSize);
        getCbInfo(env, info, argc, argv, NULL, NULL);

        const args: JsValue[] = [];
        for (let i = 0; i !== n; i++) {
            args.push(this.#adopt(argv.add(i * Process.pointerSize).readPointer()));
        }
        return args;
    }

    #fromJsObject(value: any): JsValue {
        if (value instanceof JsValue) {
            return value;
        }

        const wrapped = value[unwrapSymbol];
        if (wrapped !== undefined) {
            return wrapped;
        }

        if (Array.isArray(value)) {
            return this.#newArray(value);
        }

        return this.#newObject(value);
    }

    #newArray(elements: any[]): JsValue {
        const result = this.#scratch;
        this.#check(this.#napi.createArrayWithLength(this.#env, elements.length, result));
        const array = this.#adopt(result.readPointer());
        elements.forEach((element, index) => {
            this.setElement(array, index, element);
        });
        return array;
    }

    #newObject(properties: Record<string, any>): JsValue {
        const object = this.#invoke(this.#napi.createObject);
        for (const [key, value] of Object.entries(properties)) {
            this.setProperty(object, key, value);
        }
        return object;
    }

    #marshalArgs(args: any[]): NativePointer {
        const storage = Memory.alloc(Math.max(args.length, 1) * Process.pointerSize);
        args.forEach((arg, index) => {
            storage.add(index * Process.pointerSize).writePointer(this.fromJs(arg).handle);
        });
        return storage;
    }

    #invoke(op: (env: NativePointerValue, result: NativePointerValue) => number): JsValue {
        const result = this.#scratch;
        this.#check(op(this.#env, result));
        return this.#adopt(result.readPointer());
    }

    #invokeWith(op: (env: NativePointerValue, arg: any, result: NativePointerValue) => number, arg: any): JsValue {
        const result = this.#scratch;
        this.#check(op(this.#env, arg, result));
        return this.#adopt(result.readPointer());
    }

    #queryBoolean(op: (env: NativePointerValue, value: NativePointerValue, result: NativePointerValue) => number, value: JsValue): boolean {
        const result = this.#scratch;
        this.#check(op(this.#env, value.handle, result));
        return result.readU8() !== 0;
    }

    #adopt(handle: NativePointer): JsValue {
        return new JsValue(this, handle);
    }

    #check(status: number): void {
        if (status === NAPI_OK) {
            return;
        }

        if (status === NAPI_PENDING_EXCEPTION || this.#exceptionIsPending()) {
            throw this.#takePendingException();
        }

        throw new Error(`N-API call failed: ${this.#lastErrorMessage()} (status ${status})`);
    }

    #exceptionIsPending(): boolean {
        const result = this.#scratch;
        this.#napi.isExceptionPending(this.#env, result);
        return result.readU8() !== 0;
    }

    #takePendingException(): Error {
        const result = this.#scratch;
        this.#napi.getAndClearLastException(this.#env, result);
        const exception = this.#adopt(result.readPointer());

        const error = new Error(this.readString(this.getProperty(exception, "message")));
        const stack = this.getProperty(exception, "stack");
        if (!stack.isNullish) {
            error.stack = this.readString(stack);
        }
        return error;
    }

    #lastErrorMessage(): string {
        const result = this.#scratch;
        this.#napi.getLastErrorInfo(this.#env, result);
        return result.readPointer().readPointer().readUtf8String() ?? "unknown error";
    }
}

const FUNCTION_WRAPPER_FACTORY = `(function (flagBuffer, invoke, release) {
    const disposed = new Uint8Array(flagBuffer);
    const registry = new FinalizationRegistry(id => {
        if (disposed[0] === 0) {
            release(id);
        }
    });
    return id => {
        const fn = function (...args) {
            return (disposed[0] === 0) ? invoke(id, ...args) : undefined;
        };
        registry.register(fn, id);
        return fn;
    };
})`;

const REQUIRE_LOOKUP = `(() => {
    if (typeof require === "function") {
        return require;
    }

    const { mainModule } = process;
    if (mainModule?.id === ".") {
        return mainModule.require.bind(mainModule);
    }

    const { createRequire } = process.getBuiltinModule("module");
    const { join } = process.getBuiltinModule("path");
    const resourcesRequire = createRequire(join(process.resourcesPath, "package.json"));
    const appPath = (process.type === "browser")
        ? resourcesRequire("electron").app.getAppPath()
        : process.argv.find(arg => arg.startsWith("--app-path="))?.substring("--app-path=".length);
    return (appPath !== undefined) ? createRequire(resourcesRequire.resolve(appPath)) : resourcesRequire;
})()`;
