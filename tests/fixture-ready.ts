import Electron from "../lib/index.js";

export async function whenFixtureReady(): Promise<void> {
    while (await Electron.evaluate("typeof fixture") !== "object") {
        await new Promise(resolve => { setTimeout(resolve, 50); });
    }
}
