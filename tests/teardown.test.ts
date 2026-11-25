import { expect, test } from "@frida/injest/agent";
import Electron from "../lib/index.js";

test.isolated("makes callbacks held by the target harmless once disposed", async () => {
    let calls = 0;
    await Electron.perform(realm => {
        const holdCallback = realm.evaluate(`(callback => {
            globalThis.heldCallback = callback;
            globalThis.heldCallbackTimer = setInterval(() => { globalThis.heldCallbackResult = heldCallback(); }, 5);
        })`);
        holdCallback(() => ++calls);
    });
    while (calls === 0) {
        await sleep(10);
    }

    const settledLater = Electron.perform(realm => realm.await(realm.evaluate("new Promise(resolve => { setTimeout(resolve, 300); })")));

    await Electron.dispose();
    await expect(settledLater).rejects.toThrow("Electron bridge disposed");

    const callsAtDisposal = calls;
    await sleep(400);
    expect(calls).toBe(callsAtDisposal);

    const result = await Electron.evaluate("[typeof heldCallback, heldCallbackResult, clearInterval(heldCallbackTimer)]");
    expect(result).toEqual(["function", undefined, undefined]);
});

test.isolated("rejects work scheduled before disposal could bootstrap", async () => {
    const early = Electron.perform(realm => realm.toJs(realm.evaluate("1")));
    await Electron.dispose();
    await expect(early).rejects.toThrow("Electron bridge disposed");
    expect(await Electron.evaluate("2")).toBe(2);
});

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => { setTimeout(resolve, ms); });
}
