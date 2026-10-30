// The queue must keep working after YouTube replaces the player element.
// Runs the real videoQueuing.js with playerLifecycle and the resolver stubbed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function makePlayer(name) {
  const listeners = [];
  return {
    name,
    state: { isEnded: false, isPlaying: false },
    videoId: "v1",
    addEventListener(type, fn) {
      if (type === "onStateChange") listeners.push(fn);
    },
    removeEventListener(type, fn) {
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    },
    getPlayerStateObject() {
      return this.state;
    },
    getVideoData() {
      return { video_id: this.videoId };
    },
    fire() {
      listeners.slice().forEach((fn) => fn());
    },
    listenerCount() {
      return listeners.length;
    },
  };
}

function load() {
  const source = fs
    .readFileSync(path.join(ROOT, "mods/features/videoQueuing.js"), "utf8")
    .replace(/^import\s+[\s\S]*?;\s*$/gm, "");
  const played = [];
  let playerCallback = null;
  const sandbox = {
    console,
    document: { getElementById: () => null },
    setTimeout: (fn) => fn(), // run the 500 ms delay now
    resolveCommand: (cmd) => played.push(cmd),
    watchPlayer: (cb) => (playerCallback = cb),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return {
    queue: sandbox.queuedVideos,
    played,
    setPlayer: (p) => playerCallback(p),
  };
}

const entry = (id) => ({
  tileRenderer: { contentId: id, onSelectCommand: { watchEndpoint: { videoId: id } } },
});

test("the queue advances on the first player", () => {
  const { queue, played, setPlayer } = load();
  queue.videos = [entry("a"), entry("b"), entry("c")];
  const p1 = makePlayer("p1");
  setPlayer(p1);
  p1.videoId = "a";
  queue.currentIndex = 0;
  p1.state = { isEnded: true };
  p1.fire();
  assert.deepEqual(played.at(-1), { watchEndpoint: { videoId: "b" } });
});

test("after the player is replaced, the new player drives the queue and the old one is detached", () => {
  const { queue, played, setPlayer } = load();
  queue.videos = [entry("a"), entry("b"), entry("c")];
  const p1 = makePlayer("p1");
  setPlayer(p1);
  const p2 = makePlayer("p2");
  setPlayer(p2);

  assert.equal(p1.listenerCount(), 0, "old player keeps no listener");
  assert.equal(p2.listenerCount(), 1, "new player has the listener");

  // Play "b" on the new player, then let it end: "c" must play next.
  p2.videoId = "b";
  p2.state = { isPlaying: true };
  p2.fire();
  assert.equal(queue.currentIndex, 1);
  p2.state = { isEnded: true };
  p2.fire();
  assert.deepEqual(played.at(-1), { watchEndpoint: { videoId: "c" } });
});

test("a null player (navigated away) detaches the listener without throwing", () => {
  const { setPlayer } = load();
  const p1 = makePlayer("p1");
  setPlayer(p1);
  setPlayer(null);
  assert.equal(p1.listenerCount(), 0);
});

test("the queue is cleared after its last video ends", () => {
  const { queue, played, setPlayer } = load();
  queue.videos = [entry("a")];
  const p = makePlayer("p");
  setPlayer(p);
  p.videoId = "a";
  queue.currentIndex = 0;
  p.state = { isEnded: true };
  p.fire();
  assert.equal(JSON.stringify(played.at(-1)), JSON.stringify({ customAction: { action: "CLEAR_QUEUE" } }));
  assert.equal(queue.currentIndex, -1);
});
