import Electron from "../lib/index.js";

Electron.perform(realm => {
    const { app, BrowserWindow } = realm.require("electron");

    const windows = BrowserWindow.getAllWindows();
    const titles: string[] = [];
    const n = realm.toJs(windows.length);
    for (let i = 0; i !== n; i++) {
        titles.push(realm.toJs(windows[i].getTitle()));
    }

    send({
        name: realm.toJs(app.getName()),
        version: realm.toJs(app.getVersion()),
        electron: realm.toJs(realm.global.process.versions.electron),
        titles,
    });
}).catch((e: Error) => {
    send({ error: e.stack });
});
