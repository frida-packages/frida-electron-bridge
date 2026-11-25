import { describe, expect, test } from "@frida/injest/agent";
import Electron, { Debugger, WebContentsTarget } from "../lib/index.js";

describe("devtools protocol", () => {
    test("lists the app's web contents", async () => {
        const window = await waitForWindow();
        expect(window.type).toBe("window");
        expect(window.url).toMatch("data:text/html");
    });

    test("evaluates in the renderer through CDP", async () => {
        const target = await attachToWindow();
        expect(await target.evaluate("document.title")).toBe("fixture window");
        expect(await target.evaluate("1 + 1")).toBe(2);
        await target.detach();
    });

    test("reads the DOM through CDP", async () => {
        const target = await attachToWindow();
        const { root } = await target.send("DOM.getDocument");
        expect(root.nodeName).toBe("#document");
        await target.detach();
    });

    test("streams protocol events", async () => {
        const target = await attachToWindow();

        const consoleApiCalled = new Promise<any>(resolve => {
            target.addEventHandler((method, params) => {
                if (method === "Runtime.consoleAPICalled" && params.args[0].value === "ping from the page") {
                    resolve(params);
                }
            });
        });

        await target.send("Runtime.enable");
        await target.evaluate("console.log('ping from the page')");

        const params = await consoleApiCalled;
        expect(params.type).toBe("log");

        await target.detach();
    });

    test("keeps event handler errors out of the app", async () => {
        await Electron.evaluate(`(() => {
            globalThis.uncaughtInApp = [];
            globalThis.recordUncaught = error => { uncaughtInApp.push(error.message); };
            process.on("uncaughtException", recordUncaught);
        })()`);

        const target = await attachToWindow();
        let calls = 0;
        await target.addEventHandler(() => {
            calls++;
            throw new Error("buggy handler");
        });
        await target.send("Runtime.enable");
        await target.evaluate("console.log('provoking the handler')");
        await target.detach();

        expect(calls).toBeGreaterThan(0);
        const uncaught = await Electron.evaluate("(process.off('uncaughtException', recordUncaught), uncaughtInApp)");
        expect(uncaught).toEqual([]);
    });
});

async function attachToWindow(): Promise<Debugger> {
    const window = await waitForWindow();
    return await Debugger.attach(window.id);
}

async function waitForWindow(): Promise<WebContentsTarget> {
    while (true) {
        const window = (await Debugger.list()).find(target => target.type === "window" && target.title === "fixture window");
        if (window !== undefined) {
            return window;
        }
        await new Promise(resolve => { setTimeout(resolve, 50); });
    }
}
