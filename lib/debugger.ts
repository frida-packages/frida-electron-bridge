import { Realm } from "./realm.js";
import { perform } from "./runtime.js";
import { JsProxy } from "./value.js";

export interface WebContentsTarget {
    id: number;
    type: string;
    url: string;
    title: string;
}

export type DebuggerEventHandler = (method: string, params: any) => void;

export class Debugger {
    #webContentsId: number;

    private constructor(webContentsId: number) {
        this.#webContentsId = webContentsId;
    }

    static list(): Promise<WebContentsTarget[]> {
        return perform(describeAllWebContents);
    }

    static async attach(webContentsId: number, protocolVersion: string = "1.3"): Promise<Debugger> {
        await perform(realm => {
            const target = getDebugger(realm, webContentsId);
            if (!realm.toJs(target.isAttached())) {
                target.attach(protocolVersion);
            }
        });
        return new Debugger(webContentsId);
    }

    get webContentsId(): number {
        return this.#webContentsId;
    }

    async send(method: string, params: any = {}): Promise<any> {
        return await perform(realm => realm.await(getDebugger(realm, this.#webContentsId).sendCommand(method, params)));
    }

    async evaluate(expression: string): Promise<any> {
        const { result } = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        return result.value;
    }

    addEventHandler(handler: DebuggerEventHandler): Promise<void> {
        return perform(realm => {
            const onMessage = (_event: JsProxy, method: JsProxy, params: JsProxy) => {
                try {
                    handler(realm.toJs(method), realm.toJs(params));
                } catch (e) {
                    Script.nextTick(rethrow, e);
                }
            };
            getDebugger(realm, this.#webContentsId).on("message", onMessage);
        });
    }

    detach(): Promise<void> {
        return perform(realm => {
            getDebugger(realm, this.#webContentsId).detach();
        });
    }
}

function describeAllWebContents(realm: Realm): WebContentsTarget[] {
    const all = realm.require("electron").webContents.getAllWebContents();

    const targets: WebContentsTarget[] = [];
    const n = realm.toJs(all.length);
    for (let i = 0; i !== n; i++) {
        const contents = all[i];
        targets.push({
            id: realm.toJs(contents.id),
            type: realm.toJs(contents.getType()),
            url: realm.toJs(contents.getURL()),
            title: realm.toJs(contents.getTitle()),
        });
    }
    return targets;
}

function getDebugger(realm: Realm, webContentsId: number): JsProxy {
    return realm.require("electron").webContents.fromId(webContentsId).debugger;
}

function rethrow(error: Error): never {
    throw error;
}
