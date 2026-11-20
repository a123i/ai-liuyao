(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShakeController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function emptyCoins() {
    return Array.from({ length: 6 }, () => [false, false, false]);
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function createShakeController({ random = Math.random, captureTime = () => null } = {}) {
    let phase = 'idle';
    let stopped = 0;
    let coins = emptyCoins();
    let completedAt = null;
    let timeError = false;

    function snapshot() {
      return {
        phase,
        stopped,
        coins: clone(coins),
        completedAt: clone(completedAt),
        timeError
      };
    }

    function tick() {
      if (phase !== 'rolling') return snapshot();
      // Only the active line rolls. Earlier lines stay fixed; later lines wait.
      for (let c = 0; c < 3; c++) coins[stopped][c] = random() < 0.5;
      return snapshot();
    }

    function start() {
      phase = 'rolling';
      stopped = 0;
      coins = emptyCoins();
      completedAt = null;
      timeError = false;
      return tick();
    }

    function stopNext() {
      if (phase !== 'rolling') return snapshot();
      stopped++;
      if (stopped === 6) {
        phase = 'complete';
        try {
          completedAt = captureTime();
          timeError = !completedAt;
        } catch {
          completedAt = null;
          timeError = true;
        }
      }
      return phase === 'rolling' ? tick() : snapshot();
    }

    function reset() {
      phase = 'idle';
      stopped = 0;
      coins = emptyCoins();
      completedAt = null;
      timeError = false;
      return snapshot();
    }

    return { start, tick, stopNext, reset, snapshot };
  }

  return { createShakeController };
});
