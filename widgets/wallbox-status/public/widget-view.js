(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./widget-core.js'));
  else root.V2CView = factory(root.V2CCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
 'use strict';
 const icons = {
  waiting:'<path d="M9 3v4M15 3v4M7 7h10v3a5 5 0 0 1-5 5v5M9 20h6"/>',
  ready:'<path d="M5 16h14M5 16v3M19 16v3M4 13l2-6h12l2 6v3H4zM7 12h.01M17 12h.01"/>',
  charging:'<path d="m13 2-8 12h6l-1 8 9-13h-6z" fill="currentColor" stroke="none"/>',
  paused:'<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  offline:'<path d="m3 3 18 18M4 9a14 14 0 0 1 2-1M10 6a14 14 0 0 1 10 3M7 13a9 9 0 0 1 3-1M15 12l2 1M10 17l2-1 2 1M12 21h.01"/>',
  homey:'<circle cx="12" cy="12" r="3"/><path d="M12 9V4M9 13l-4 3M15 13l4 3"/><circle cx="12" cy="3" r="1.5"/><circle cx="4" cy="17" r="1.5"/><circle cx="20" cy="17" r="1.5"/>',
  wallbox:'<rect x="4" y="3" width="11" height="18" rx="2"/><path d="m10 7-3 5h4l-2 5M15 7h2l3 3v7a2 2 0 0 1-4 0v-3"/>',
  stale:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l3 2"/>',
  fault:'<path d="m12 3 10 18H2zM12 9v5M12 17h.01"/>',
  unknown:'<circle cx="12" cy="12" r="9"/><path d="M12 6v7M12 17h.01"/>',
  loading:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  pause:'<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  resume:'<path d="m8 4 12 8-12 8z" fill="currentColor" stroke="none"/>',
  refresh:'<path d="M20 5v5h-5M4 19v-5h5M5 9a8 8 0 0 1 13-4l2 3M19 15A8 8 0 0 1 6 19l-2-3"/>'
 };
 const strings = {
  "en": {
    "waiting": "No car connected",
    "ready": "Car connected",
    "charging": "Charging",
    "paused": "Paused",
    "offline": "Offline",
    "unknown": "Status unavailable",
    "loading": "Loading…",
    "stale": "Unconfirmed",
    "fault": "Fault",
    "faultF": "Fault F",
    "faultE": "Fault E",
    "faultD": "Ventilation D",
    "selection": "Select wallbox",
    "power": "Power",
    "energy": "Session",
    "pause": "Pause charging",
    "resume": "Resume charging",
    "refresh": "Try again",
    "busy": "Updating…",
    "idle": "Ready for your next drive",
    "loadingNote": "Reading wallbox status",
    "requestFailed": "Command failed",
    "awaiting": "Unconfirmed",
    "targetRequired": "Target required",
    "requestFailedDetail": "Command failed or its result is unknown. Refresh status; the command will not be repeated.",
    "awaitingDetail": "Command sent but its requested effect is not confirmed. Refresh status; the command will not be repeated.",
    "targetRequiredDetail": "Homey requires a positive achievable power target. Set it in the device controls. This button only refreshes status.",
    "ownerHomey": "Power controlled by Homey",
    "ownerWallbox": "Power controlled directly by the wallbox",
    "ownerUnknown": "Power controller is not confirmed",
    "lastKnown": "Last known values; not a confirmed live reading"
  },
  "cs": {
    "waiting": "Auto nepřipojeno",
    "ready": "Auto připojeno",
    "charging": "Nabíjení",
    "paused": "Pozastaveno",
    "offline": "Nedostupné",
    "unknown": "Stav není známý",
    "loading": "Načítání…",
    "stale": "Neověřeno",
    "fault": "Porucha",
    "faultF": "Porucha F",
    "faultE": "Porucha E",
    "faultD": "Větrání D",
    "selection": "Vyberte wallbox",
    "power": "Výkon",
    "energy": "Nabito",
    "pause": "Pozastavit",
    "resume": "Povolit nabíjení",
    "refresh": "Zkusit znovu",
    "busy": "Aktualizuji…",
    "idle": "Připraveno na další cestu",
    "loadingNote": "Načítám stav wallboxu",
    "requestFailed": "Příkaz selhal",
    "awaiting": "Neověřeno",
    "targetRequired": "Chybí cíl",
    "requestFailedDetail": "Příkaz selhal nebo jeho výsledek není známý. Obnovit stav; příkaz se nebude opakovat.",
    "awaitingDetail": "Příkaz byl odeslán, ale požadovaný účinek není potvrzen. Obnovit stav; příkaz se nebude opakovat.",
    "targetRequiredDetail": "Homey vyžaduje kladný dosažitelný cílový výkon. Nastavte jej v ovládání zařízení. Toto tlačítko pouze obnoví stav.",
    "ownerHomey": "Výkon řídí Homey",
    "ownerWallbox": "Výkon řídí přímo wallbox",
    "ownerUnknown": "Řízení výkonu není ověřeno",
    "lastKnown": "Poslední známé hodnoty; neověřené aktuální měření"
  }
};
 function svg(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(icons[name]||icons.unknown)+'</svg>'; }
 let counter=0;
 function create(container, options) {
  const o=options||{};const id='v2c-'+(++counter);let disposed=false,busy=false,visible=true,manualMotion=true,feedback=null;
  const locale=o.locale==='cs'?'cs':'en';
  function t(key){ const fallback=strings[locale][key]||strings.en[key]||key; return o.translate ? o.translate(key,fallback) : fallback; }
  const asset=(name)=>o.assets&&o.assets[name] ? o.assets[name] : (o.assetBase||'./assets/')+name;
  // Plate and vector coordinates are one shared scene-space; no floating line over an unrelated image.
  const cable="M158.00 238.00 L158.46 243.31 L158.98 248.54 L159.55 253.71 L160.18 258.80 L160.87 263.81 L161.62 268.74 L162.44 273.59 L163.32 278.35 L164.27 283.03 L165.30 287.62 L166.39 292.11 L167.57 296.51 L168.82 300.82 L170.16 305.02 L171.58 309.12 L173.08 313.12 L174.68 317.01 L176.37 320.79 L178.15 324.46 L180.02 328.02 L181.98 331.45 L183.98 334.77 L186.04 337.97 L188.14 341.05 L190.28 344.00 L192.46 346.82 L194.67 349.50 L196.90 352.06 L199.16 354.48 L201.43 356.76 L203.71 358.90 L206.00 360.89 L208.29 362.74 L210.57 364.44 L212.84 365.99 L215.10 367.39 L217.33 368.64 L219.55 369.72 L221.73 370.64 L223.89 371.40 L226.02 372.00 L226.02 372.00 L229.00 373.01 L231.76 373.71 L234.32 374.11 L236.74 374.20 L239.02 374.00 L241.21 373.50 L243.33 372.73 L245.40 371.67 L247.44 370.34 L249.48 368.74 L251.53 366.88 L253.60 364.76 L255.73 362.38 L257.91 359.77 L260.16 356.91 L262.50 353.81 L264.93 350.49 L267.47 346.94 L270.12 343.17 L272.89 339.19 L275.80 335.00 L278.84 330.61 L282.03 326.03 L285.37 321.25 L288.88 316.28 L292.54 311.13 L296.38 305.81 L300.40 300.32 L304.59 294.67 L308.98 288.85 L313.48 282.88 L317.96 276.77 L322.41 270.51 L326.82 264.12 L331.20 257.60 L335.56 250.95 L339.89 244.17 L344.19 237.29 L348.48 230.29 L352.75 223.20 L357.00 216.00 L366.00 207.00";
  delete container.dataset.assetError;container.classList.add('v2c-widget');container.dataset.state='loading';container.dataset.presence='idle';
  container.setAttribute('role','group');container.setAttribute('aria-label','V2C Wallbox');
  container.innerHTML=`<div class="v2c-scene" aria-hidden="true">
  <svg viewBox="0 0 564 443" preserveAspectRatio="xMinYMid slice" focusable="false">
   <defs><radialGradient id="${id}-halo"><stop offset="0" stop-color="currentColor" stop-opacity=".9"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient></defs>
   <image class="v2c-plate light idle" width="564" height="443"/>
   <image class="v2c-plate light connected" width="564" height="443"/>
   <image class="v2c-plate dark idle" width="564" height="443"/>
   <image class="v2c-plate dark connected" width="564" height="443"/>
   <ellipse class="v2c-state-light" cx="116" cy="170" rx="116" ry="175" style="fill:url(#${id}-halo);color:var(--state)"/>
   <path class="v2c-led" d="M64 101 L64 231"/>
   <ellipse class="v2c-wait-ring" cx="117" cy="171" rx="78" ry="110"/>
   <path class="v2c-cable v2c-cable-glow" d="${cable}"/>
   <path class="v2c-cable" d="${cable}"/>
   <path class="v2c-energy" d="${cable}" pathLength="140"/>
   <g class="v2c-offline-symbol" transform="translate(223 112)" fill="none" stroke="var(--state)" stroke-width="4" stroke-linecap="round">
    <circle cx="0" cy="0" r="23" fill="var(--v2c-surface)"/><path d="M0-12v15M0 12h.01"/>
   </g>
  </svg></div>
  <span class="v2c-owner" role="img"><span class="v2c-owner-icon"></span><span class="v2c-owner-text">—</span></span>
  <div class="v2c-copy">
   <div class="v2c-brand"><span class="v2c-brand-dot"></span>V2C · WALLBOX</div>
   <div class="v2c-status"><span class="v2c-status-icon"></span><span class="v2c-status-text"></span></div>
   <div class="v2c-metrics">
    <div class="v2c-metric"><div class="v2c-metric-number"><span class="v2c-value power-value">—</span><span class="v2c-unit">kW</span></div><div class="v2c-metric-label power-label"></div></div>
    <div class="v2c-metric secondary"><div class="v2c-metric-number"><span class="v2c-value energy-value">—</span><span class="v2c-unit">kWh</span></div><div class="v2c-metric-label energy-label"></div></div>
   </div>
   <div class="v2c-action-row"><button type="button" class="v2c-button" hidden><span class="v2c-action-icon"></span><span class="v2c-action-text"></span></button><span class="v2c-idle-note"></span></div>
  </div>
  <span class="v2c-sr-only v2c-announcement" role="status" aria-live="polite" aria-atomic="true"></span>`;
  const q=s=>container.querySelector(s);const button=q('.v2c-button');
  ['light-idle','light-connected','dark-idle','dark-connected'].forEach((kind,i)=>{
   const img=container.querySelectorAll('image')[i];
   img.addEventListener('error',()=>{container.dataset.assetError='true';},{once:true});
   img.setAttribute('href',asset('scene-'+kind+'.webp'));
  });
  q('.power-label').textContent=t('power');q('.energy-label').textContent=t('energy');
  let model=Core.empty('loading');
  function render(next) {
   if(disposed)return;model=next;
   if(next.presence)container.dataset.presence=next.presence;
   const previous=container.dataset.state;container.dataset.state=next.state;
   container.dataset.quality=next.quality||'unknown';
   let stateKey=next.state;
   if(next.state==='fault'&&next.faultCode)stateKey={4:'faultF',5:'faultE',6:'faultD'}[next.faultCode]||'fault';
   q('.v2c-status-icon').innerHTML=svg(next.state);q('.v2c-status-text').textContent=t(stateKey);
   q('.v2c-status').title=next.faultDescription?String(next.faultDescription):t(stateKey);
   q('.power-value').textContent=Core.formatMetric(next.power,locale);q('.energy-value').textContent=Core.formatMetric(next.energy,locale);
   q('.v2c-metrics').title=next.quality==='last-known'?t('lastKnown'):'';
   const ownerKey=next.owner==='homey'?'ownerHomey':next.owner==='wallbox'?'ownerWallbox':'ownerUnknown';
   q('.v2c-owner-text').textContent=next.owner==='homey'?'Homey':next.owner==='wallbox'?'Wallbox':'—';
   q('.v2c-owner-icon').innerHTML=svg(next.owner||'unknown');
   q('.v2c-owner').title=t(ownerKey);q('.v2c-owner').setAttribute('aria-label',t(ownerKey));
   q('.v2c-owner').dataset.known=String(!!next.owner);
   container.querySelectorAll('.v2c-metric').forEach(el=>{el.dataset.long=String(el.querySelector('.v2c-value').textContent.length>5);});
   const action=feedback?'refresh':next.action;
   button.hidden=!action;button.disabled=busy;button.dataset.feedback=String(!!feedback);
   q('.v2c-action-icon').innerHTML=svg(feedback?'unknown':action||'refresh');
   q('.v2c-action-text').textContent=t(busy?'busy':feedback||action||'refresh');
   const actionDescription=feedback?t(feedback+'Detail'):t(action||'refresh');
   button.setAttribute('aria-label',busy?t('busy'):actionDescription);button.title=actionDescription;
   q('.v2c-idle-note').hidden=!!action||!['waiting','loading'].includes(next.state);
   q('.v2c-idle-note').textContent=t(next.state==='loading'?'loadingNote':'idle');
   if(previous!==next.state)q('.v2c-announcement').textContent=t(stateKey);
  }
  function setBusy(value){busy=!!value;container.setAttribute('aria-busy',String(busy));render(model);}
  function message(key){feedback=key;render(model);q('.v2c-announcement').textContent=t(key+'Detail');}
  function clearMessage(){feedback=null;render(model);}
  const onClick=()=>{const action=feedback?'refresh':model.action;if(!busy&&action&&o.onAction)o.onAction(action);};button.addEventListener('click',onClick);
  function motion(){container.dataset.motion=(!document.hidden&&visible&&manualMotion)?'on':'off';}
  document.addEventListener('visibilitychange',motion);
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;motion();if(o.onVisibility)o.onVisibility(visible);},{threshold:0}):null;
  if(observer)observer.observe(container);motion();render(model);
  return {render,setBusy,message,clearMessage,setMotion(value){manualMotion=!!value;motion();},setTheme(theme){if(theme)container.dataset.theme=theme;else delete container.dataset.theme;},getModel(){return model;},destroy(){disposed=true;observer&&observer.disconnect();document.removeEventListener('visibilitychange',motion);button.removeEventListener('click',onClick);container.innerHTML='';}};
 }
 return {create,strings};
});
