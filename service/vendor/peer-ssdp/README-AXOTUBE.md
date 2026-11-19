Vendored copy of @patrickkfkan/peer-ssdp 0.1.0 (MIT, see LICENSE).
The only change: `new Buffer(string)` is replaced by `Buffer.from(string)` (four call sites).
`new Buffer` is deprecated on current Node (DEP0005). Buffer.from exists on Node 4.5+, and on
Node 4.4 service/node4-compat.js supplies a working Buffer.from before this module loads.
