import {
    Api,
    MODULE_API_VERSION,
    NAPI_TSFN_BLOCKING,
    tryGetApi,
    whenApiAvailable,
} from "./api.js";
import { getProcessRole, ProcessRole } from "./process.js";
import { Realm } from "./realm.js";

export type PerformCallback<T> = (realm: Realm) => T;

export function isAvailable(): boolean {
    return tryGetApi() !== null;
}

export function hasNodeEnvironment(): boolean {
    return getProcessRole().hasNodeEnvironment;
}

export function perform<T>(fn: PerformCallback<T>): Promise<T> {
    const role = getProcessRole();
    if (!role.hasNodeEnvironment) {
        return Promise.reject(new Error(describeMissingNodeEnvironment(role)));
    }

    return new Promise<T>((resolve, reject) => {
        whenApiAvailable(api => {
            getScheduler(api).schedule(realm => {
                try {
                    resolve(fn(realm));
                } catch (e) {
                    reject(e);
                }
            });
        });
    });
}

function getScheduler(api: Api): Scheduler {
    if (cachedScheduler === null) {
        cachedScheduler = new Scheduler(api);
    }
    return cachedScheduler;
}

function describeMissingNodeEnvironment({ type }: ProcessRole): string {
    if (type === "renderer") {
        return "This renderer is sandboxed, so it has no Node environment; "
            + "reach it through Debugger from the main process instead";
    }
    return `This process (--type=${type}) has no Node environment`;
}

let cachedScheduler: Scheduler | null = null;

class Scheduler {
    #api: Api;
    #jobs: PerformCallback<void>[] = [];
    #realm: Realm | null = null;
    #threadsafeFunction: NativePointer | null = null;
    #bootstrapper: InvocationListener | null = null;
    #callbacks: NativeCallback<"void" | "pointer", any>[] = [];

    constructor(api: Api) {
        this.#api = api;
    }

    schedule(fn: PerformCallback<void>): void {
        this.#jobs.push(fn);

        if (this.#threadsafeFunction !== null) {
            this.#dispatch();
        } else if (this.#bootstrapper === null) {
            this.#startBootstrap();
        }
    }

    #dispatch(): void {
        const { callThreadsafeFunction } = this.#api.napi;
        callThreadsafeFunction(this.#threadsafeFunction!, NULL, NAPI_TSFN_BLOCKING);
    }

    #startBootstrap(): void {
        const { functionCall, isolateGetCurrent, getCurrentEventLoop } = this.#api;

        const onJsThreadEntered = () => {
            const isolate = isolateGetCurrent();
            if (getCurrentEventLoop(isolate).isNull()) {
                return;
            }

            this.#bootstrapper!.detach();
            this.#bootstrapper = null;
            this.#adoptIsolate(isolate);
            this.#dispatch();
        };

        this.#bootstrapper = Interceptor.attach(functionCall, onJsThreadEntered);
    }

    #adoptIsolate(isolate: NativePointer): void {
        const { isolateGetCurrentContext, objectNew, registerModuleBySymbol } = this.#api;

        const context = isolateGetCurrentContext(isolate);
        const exports = objectNew(isolate);
        const module = objectNew(isolate);

        const onModuleInit = new NativeCallback((env: NativePointer): NativePointer => {
            this.#adoptEnv(env);
            return NULL;
        }, "pointer", ["pointer", "pointer"]);
        this.#callbacks.push(onModuleInit);

        registerModuleBySymbol(exports, module, context, onModuleInit, MODULE_API_VERSION);
    }

    #adoptEnv(env: NativePointer): void {
        const { napi } = this.#api;

        this.#realm = new Realm(env, this.#api);

        const onJobsPending = new NativeCallback((): void => {
            this.#runPendingJobs();
        }, "void", ["pointer", "pointer", "pointer", "pointer"]);
        this.#callbacks.push(onJobsPending);

        const result = Memory.alloc(Process.pointerSize);
        napi.createThreadsafeFunction(env, NULL, NULL, this.#realm.newString("frida-electron-bridge"),
            0, 1, NULL, NULL, NULL, onJobsPending, result);
        const tsfn = result.readPointer();
        napi.unrefThreadsafeFunction(env, tsfn);

        this.#threadsafeFunction = tsfn;
    }

    #runPendingJobs(): void {
        const realm = this.#realm!;

        const jobs = this.#jobs;
        this.#jobs = [];

        for (const job of jobs) {
            realm.withScope(() => {
                job(realm);
            });
        }
    }
}
