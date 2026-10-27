// Pure, DOM-free connection-status mapping for the veto page: a transport
// state name maps to the translation key and the CSS class that paint it.
// Rendering (veto.js) and looks (veto.css) live elsewhere; this module only
// decides, so tests can run under `node --test` without a DOM.
export const STATUS_BASE_CLASS = 'vt-status';

const VIEWS = Object.freeze({
  serverOnline: Object.freeze({ textKey: 'serverOnline', className: 'vt-status--online' }),
  serverRetry: Object.freeze({ textKey: 'serverRetry', className: 'vt-status--retry' }),
  serverWait: Object.freeze({ textKey: 'serverWait', className: 'vt-status--wait' }),
  vdoConnection: Object.freeze({ textKey: 'vdoConnection', className: 'vt-status--neutral' }),
  browserOffline: Object.freeze({ textKey: 'browserOffline', className: 'vt-status--offline' }),
});

// All states the mapping knows about, in declaration order.
export const statusStates = () => Object.keys(VIEWS);

// state -> { textKey, className }, or null for an unknown state.
export function statusView(state) {
  const view = VIEWS[state];
  return view ? { textKey: view.textKey, className: view.className } : null;
}
