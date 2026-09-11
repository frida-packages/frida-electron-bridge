import Electron from "../lib/index.js";

Electron.perform(realm => {
    const { location, document, navigator } = realm.global;

    send({
        type: realm.toJs(realm.global.process.type),
        href: realm.toJs(location.href),
        title: realm.toJs(document.title),
        userAgent: realm.toJs(navigator.userAgent),
    });
}).catch((e: Error) => {
    send({ error: e.stack });
});
