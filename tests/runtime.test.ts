import { expect, test } from "@frida/injest/agent";
import Electron from "../lib/index.js";

test("detects the Electron runtime", () => {
    expect(Electron.available).toBeTruthy();
});

test("evaluates source in the target realm", async () => {
    expect(await Electron.evaluate("1 + 2")).toBe(3);
});

test("marshals the version metadata", async () => {
    const versions = await Electron.evaluate("({ electron: process.versions.electron, node: process.versions.node })");
    expect(versions.electron).toMatch(/^\d+\./);
    expect(versions.node).toMatch(/^\d+\./);
});

test("surfaces exceptions thrown by the target", async () => {
    await expect(Electron.evaluate("throw new Error('kaboom')")).rejects.toThrow("kaboom");
});
