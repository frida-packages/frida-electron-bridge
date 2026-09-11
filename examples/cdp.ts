import { Debugger } from "../lib/index.js";

async function main(): Promise<void> {
    const targets = await Debugger.list();
    send({ targets });

    const page = targets.find(t => t.type === "window")!;
    const session = await Debugger.attach(page.id);

    send({
        title: await session.evaluate("document.title"),
        userCount: await session.evaluate("document.querySelectorAll('*').length"),
        metrics: (await session.send("Performance.getMetrics")) !== undefined,
    });

    await session.detach();
}

main().catch((e: Error) => { send({ error: e.stack }); });
