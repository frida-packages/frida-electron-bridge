import { expect, test } from "@frida/injest/agent";
import Electron from "../lib/index.js";

test.isolated("runs the first perform() promptly in an idle app", async () => {
    await whenAppIsIdle();

    const started = Date.now();
    expect(await Electron.evaluate("1 + 1")).toBe(2);
    expect(Date.now() - started).toBeLessThan(500);
});

const JS_ENTRY_POINTS = [
    "uv_run",
    "_ZN2v88Function4CallENS_5LocalINS_7ContextEEENS1_INS_5ValueEEEiPS5_",
    "_ZN2v88Function4CallEPNS_7IsolateENS_5LocalINS_7ContextEEENS3_INS_5ValueEEEiPS7_",
];
const QUIET_PERIOD = 1000;

async function whenAppIsIdle(): Promise<void> {
    const runtime = Process.enumerateModules().find(m => m.findExportByName("napi_open_handle_scope") !== null)!;

    let entries = 0;
    const listeners = JS_ENTRY_POINTS
        .map(name => runtime.findExportByName(name))
        .filter(address => address !== null)
        .map(address => Interceptor.attach(address!, () => { entries++; }));

    let entriesBefore = -1;
    while (entries !== entriesBefore) {
        entriesBefore = entries;
        await new Promise(resolve => { setTimeout(resolve, QUIET_PERIOD); });
    }

    for (const listener of listeners) {
        listener.detach();
    }
}
