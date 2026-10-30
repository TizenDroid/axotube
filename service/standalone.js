// Entry point for the standalone bundle (standalone/service/dist/index.js).
// One bundle carries both the content proxy on 127.0.0.1:8099 and the control
// server on 8085 (pairing, config sync, phone commands, DIAL casting), so the
// standalone app and the Tizen module always run the same control code.
global.isAxoTubeStandalone = true;
require("./proxy.js");
require("./service.js");
