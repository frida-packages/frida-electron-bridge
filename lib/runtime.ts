import {
    Api,
    CancelApiRequest,
    NAPI_OK,
    NAPI_TSFN_BLOCKING,
    NAPI_TSFN_RELEASE,
    tryGetApi,
    whenApiAvailable,
} from "./api.js";
import { getProcessRole, ProcessRole } from "./process.js";
import { abandonSymbol, disposeSymbol, Realm } from "./realm.js";

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
        getScheduler().schedule({
            run(realm) {
                resolve(fn(realm));
            },
            fail: reject,
        });
    });
}

export async function dispose(): Promise<void> {
    const scheduler = schedulers.active;
    if (scheduler === null) {
        return;
    }

    schedulers.active = null;
    schedulers.retiring.add(scheduler);
    await scheduler.dispose();
    schedulers.retiring.delete(scheduler);
}

function describeMissingNodeEnvironment({ type }: ProcessRole): string {
    if (type === "renderer") {
        return "This renderer is sandboxed, so it has no Node environment; "
            + "reach it through Debugger from the main process instead";
    }
    return `This process (--type=${type}) has no Node environment`;
}

function getScheduler(): Scheduler {
    if (schedulers.active === null) {
        schedulers.active = new Scheduler();
    }
    return schedulers.active;
}

const schedulers = {
    active: null as Scheduler | null,
    retiring: new Set<Scheduler>(),
};

Script.bindWeak(schedulers, abandonSchedulers);

function abandonSchedulers(): void {
    schedulers.active?.abandon();
    for (const scheduler of schedulers.retiring) {
        scheduler.abandon();
    }
}

interface Job {
    run(realm: Realm): void;
    fail(error: Error): void;
}

const EVENT_LOOP_WAKEUP_INTERVAL = 50;

type SchedulerState = "idle" | "awaiting-runtime" | "bootstrapping" | "running" | "failed" | "disposed";

class Scheduler {
    #state: SchedulerState = "idle";
    #failure: Error | null = null;
    #jobs: Job[] = [];
    #api: Api | null = null;
    #cancelApiRequest: CancelApiRequest | null = null;
    #bootstrappers: InvocationListener[] = [];
    #wakeupTimer: TimeoutId | null = null;
    #realm: Realm | null = null;
    #threadsafeFunction: NativePointer | null = null;

    schedule(job: Job): void {
        if (this.#failure !== null) {
            job.fail(this.#failure);
            return;
        }

        this.#jobs.push(job);

        if (this.#state === "idle") {
            this.#awaitRuntime();
        } else if (this.#state === "running") {
            this.#dispatch();
        }
    }

    dispose(): Promise<void> {
        if (this.#state !== "running") {
            this.#cancelApiRequest?.();
            this.#stopBootstrap();
            this.#fail(new Error("Electron bridge disposed"));
            this.#state = "disposed";
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            this.#jobs.push({
                run: () => {
                    this.#release();
                    resolve();
                },
                fail: reject,
            });
            this.#dispatch();
        });
    }

    abandon(): void {
        if (this.#threadsafeFunction === null) {
            return;
        }

        this.#realm![abandonSymbol]();
        this.#api!.napi.releaseThreadsafeFunction(this.#threadsafeFunction, NAPI_TSFN_RELEASE);
        this.#threadsafeFunction = null;
        this.#state = "disposed";
    }

    #awaitRuntime(): void {
        this.#state = "awaiting-runtime";

        this.#cancelApiRequest = whenApiAvailable(api => {
            if (api instanceof Error) {
                this.#fail(api);
            } else {
                this.#startBootstrap(api);
            }
        });
    }

    #fail(error: Error): void {
        this.#state = "failed";
        this.#failure = error;

        const jobs = this.#jobs.splice(0);
        for (const job of jobs) {
            job.fail(error);
        }
    }

    #startBootstrap(api: Api): void {
        const { jsEntryPoints, isolateGetCurrent, getCurrentEventLoop, registerModule, wakeEventLoop } = api;

        this.#api = api;
        this.#state = "bootstrapping";

        const onJsThreadEntered = () => {
            if (this.#state !== "bootstrapping") {
                return;
            }

            const isolate = isolateGetCurrent();
            if (isolate.isNull() || getCurrentEventLoop(isolate).isNull()) {
                return;
            }

            if (!registerModule.ready) {
                registerModule.prepareOutsideHooks(wakeEventLoop);
                return;
            }

            this.#stopBootstrap();

            try {
                this.#adoptIsolate(isolate);
            } catch (e) {
                this.#fail(e as Error);
                return;
            }

            this.#state = "running";
            this.#dispatch();
        };

        this.#bootstrappers = jsEntryPoints.map(target => Interceptor.attach(target, onJsThreadEntered));

        wakeEventLoop();
        this.#wakeupTimer = setInterval(wakeEventLoop, EVENT_LOOP_WAKEUP_INTERVAL);
    }

    #stopBootstrap(): void {
        for (const bootstrapper of this.#bootstrappers.splice(0)) {
            bootstrapper.detach();
        }

        if (this.#wakeupTimer !== null) {
            clearInterval(this.#wakeupTimer);
            this.#wakeupTimer = null;
        }
    }

    #adoptIsolate(isolate: NativePointer): void {
        const { isolateGetCurrentContext, objectNew, registerModule } = this.#api!;

        const context = isolateGetCurrentContext(isolate);
        const exports = objectNew(isolate);
        const module = objectNew(isolate);

        let env = NULL;
        const onModuleInit = new NativeCallback((moduleEnv: NativePointer): NativePointer => {
            env = moduleEnv;
            return NULL;
        }, "pointer", ["pointer", "pointer"]);

        registerModule.register(exports, module, context, onModuleInit);

        this.#adoptEnv(env);
    }

    #adoptEnv(env: NativePointer): void {
        const api = this.#api!;
        const { napi } = api;

        const realm = new Realm(env, api);
        this.#realm = realm;

        const result = Memory.alloc(Process.pointerSize);
        const status = realm.withScope(() => {
            const drain = realm.fromJs(() => { this.#runPendingJobs(); });
            return napi.createThreadsafeFunction(env, drain.handle, NULL, realm.newString("frida-electron-bridge").handle,
                0, 1, NULL, NULL, NULL, NULL, result);
        });
        if (status !== NAPI_OK) {
            throw new Error(`Unable to create a threadsafe function (status ${status})`);
        }

        const tsfn = result.readPointer();
        napi.unrefThreadsafeFunction(env, tsfn);

        this.#threadsafeFunction = tsfn;
    }

    #runPendingJobs(): void {
        const realm = this.#realm!;

        const jobs = this.#jobs;
        this.#jobs = [];

        for (const job of jobs) {
            try {
                realm.withScope(() => {
                    job.run(realm);
                });
            } catch (e) {
                job.fail(e as Error);
            }
        }
    }

    #dispatch(): void {
        const { callThreadsafeFunction } = this.#api!.napi;
        callThreadsafeFunction(this.#threadsafeFunction!, NULL, NAPI_TSFN_BLOCKING);
    }

    #release(): void {
        this.#realm![disposeSymbol]();
        this.#api!.napi.releaseThreadsafeFunction(this.#threadsafeFunction!, NAPI_TSFN_RELEASE);
        this.#threadsafeFunction = null;
        this.#state = "disposed";
    }
}
