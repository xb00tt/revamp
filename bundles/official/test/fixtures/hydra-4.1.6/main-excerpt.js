// Excerpt from Hydra 4.1.6 out/main/index.js (MIT, github.com/hydralauncher/hydra), trimmed for Revamp's patch tests.
const PROTOCOL = "hydralauncher";
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app$z.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
            path.resolve(process.argv[1])
        ]);
    }
} else {
    app$z.setAsDefaultProtocolClient(PROTOCOL);
}
