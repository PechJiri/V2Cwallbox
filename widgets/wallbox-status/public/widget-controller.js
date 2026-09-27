(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./widget-core.js'));
  else root.V2CController = factory(root.V2CCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  function create(homey, view, options) {
    const o = options || {};
    const intervalMs = Number.isFinite(o.intervalMs) ? Math.max(3000, o.intervalMs) : 5000;
    const timeoutMs = Number.isFinite(o.timeoutMs) ? Math.max(1, o.timeoutMs) : 10000;
    const deviceId = o.deviceId === undefined ? null : Core.selectedDeviceId({ device_id: o.deviceId });
    let closed = false, busy = false, active = true, started = false, timer = null;
    let inflight = null, failures = 0, epoch = 0, sequence = 0, applied = 0, lastRaw = null;
    function path(force) {
      const parts = [];
      if (deviceId !== null) parts.push('deviceId=' + encodeURIComponent(deviceId));
      if (force) parts.push('force=true');
      return '/status' + (parts.length ? '?' + parts.join('&') : '');
    }
    function request(method, url, body) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
        Promise.resolve().then(() => homey.api(method, url, body)).then(
          result => { clearTimeout(timeout); resolve(result); },
          error => { clearTimeout(timeout); reject(error); }
        );
      });
    }
    function apply(raw) {
      lastRaw = raw;
      if (!closed) view.render(Core.normalizeStatus(raw));
    }
    function errorState(error) {
      return /select a wallbox|selected wallbox|wallbox selection/i.test(String(error && error.message || '')) ? 'selection' : 'offline';
    }
    function schedule() {
      clearTimeout(timer); timer = null;
      if (!closed && started && active && !busy) timer = setTimeout(() => refresh(),
        Math.min(30000, intervalMs * Math.pow(2, Math.min(failures, 3))));
    }
    function refresh({ force = false } = {}) {
      if (closed || busy) return Promise.resolve(null);
      if (!force && inflight && inflight.epoch === epoch) return inflight.promise;
      clearTimeout(timer);
      const record = { epoch, id: ++sequence, promise: null };
      const current = () => !closed && record.epoch === epoch && record.id >= applied;
      record.promise = (async () => {
        try {
          const raw = await request('GET', path(force));
          if (current()) { applied = record.id; failures = 0; apply(raw); }
          return raw;
        } catch (error) {
          if (current()) {
            applied = record.id; failures += 1; lastRaw = null;
            view.render(Core.empty(errorState(error)));
          }
          return null;
        } finally {
          if (inflight === record) inflight = null;
          if (record.epoch === epoch) schedule();
        }
      })();
      inflight = record;
      return record.promise;
    }
    async function act(action) {
      if (closed || busy) return;
      if (action === 'refresh') {
        view.clearMessage();
        // Retry is a fresh status read, never a replay of a previous POST.
        view.setBusy(true);
        try { return await refresh({ force: true }); }
        finally { if (!closed) view.setBusy(false); }
      }
      let command;
      try { command = Core.commandFor(action, Core.normalizeStatus(lastRaw)); }
      catch (_) { view.message('requestFailed'); return; }
      if (!command) return;
      // Capture the intent and invalidate older polls immediately. A slow GET must
      // not delay Stop, invert the request or overwrite its forced readback.
      busy = true; epoch += 1; clearTimeout(timer);
      const commandEpoch = epoch;
      let phase = 'write';
      view.clearMessage(); view.setBusy(true);
      try {
        try { if (typeof homey.hapticFeedback === 'function') homey.hapticFeedback(); } catch (_) {}
        const ack = await request('POST', '/paused', { paused: command.paused, deviceId });
        if (closed || commandEpoch !== epoch) return;
        if (!ack || ack.success !== true) throw new Error('Action not acknowledged');
        phase = 'readback';
        const requestId = ++sequence;
        const raw = await request('GET', path(true));
        if (closed || commandEpoch !== epoch) return;
        applied = requestId; failures = 0; apply(raw);
        if (!Core.commandConfirmed(raw, command.paused)) view.message('awaiting');
      } catch (error) {
        if (!closed && commandEpoch === epoch) {
          if (phase === 'readback') {
            apply({ ...(lastRaw || {}), stale: true, confirmed: false });
            view.message('awaiting');
          } else {
            const key = /positive achievable Homey target required/i.test(String(error && error.message || '')) ? 'targetRequired' : 'requestFailed';
            view.message(key);
          }
        }
      } finally {
        busy = false;
        if (!closed) { view.setBusy(false); schedule(); }
      }
    }
    return {
      refresh, act,
      start() { if (started || closed) return; started = true; if (active) refresh(); },
      setActive(value) {
        const next = !!value; if (next === active) return; active = next;
        if (!active) { clearTimeout(timer); timer = null; }
        else if (started) refresh();
      },
      destroy() { closed = true; epoch += 1; clearTimeout(timer); timer = null; },
      isBusy() { return busy; }
    };
  }
  return { create };
});
