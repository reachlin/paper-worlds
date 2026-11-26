// world/intro.js — the opening card: what this is, and how to walk it.
//
// One sheet of the page's own stock, laid over the world while it rises: the name, the one-line pitch
// and the controls, lettered in the location's ink. It is dismissed with the button, Enter, Space or
// Escape, and it never returns. While it is open it keeps the keyboard and the wheel to itself, so
// the man does not walk off behind the card; the canvas is under the overlay, so drags cannot reach
// him either.
//
// ?test and ?capture skip it: headless QA and stills want the world, not the card.

export function showIntro(loc) {
  const q = new URLSearchParams(location.search);
  if (q.has('test') || q.has('capture')) return null;

  const stock = loc.stock || '#f7f0e2';
  const ink = loc.label?.ink || '#3f3a32';
  const line = loc.label?.line || '#8b8378';
  const seal = '#4a7a46';

  const style = document.createElement('style');
  style.id = 'papercraft-intro-style';
  style.textContent = `
    #papercraft-intro{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;
      padding:24px;background:radial-gradient(120% 95% at 50% 38%,rgba(30,20,10,.14),rgba(20,13,6,.46));
      opacity:1;transition:opacity .34s ease;font-family:Georgia,'Times New Roman',serif}
    #papercraft-intro.gone{opacity:0;pointer-events:none}
    #papercraft-intro .pc-card{position:relative;width:min(92vw,452px);max-height:88vh;overflow:auto;
      padding:clamp(26px,5vw,42px) clamp(24px,5vw,44px) clamp(24px,4vw,34px);color:${ink};background:${stock};
      border-radius:3px;box-shadow:0 0 0 1px rgba(58,41,28,.34),0 26px 60px -22px rgba(24,14,5,.72),0 6px 16px rgba(30,18,8,.24)}
    #papercraft-intro .pc-card::before{content:'';position:absolute;inset:0;pointer-events:none;opacity:.5;border-radius:3px;
      background:
        repeating-linear-gradient(112deg,rgba(120,96,64,.05) 0 1px,transparent 1px 5px),
        repeating-linear-gradient(24deg,rgba(120,96,64,.035) 0 1px,transparent 1px 7px)}
    #papercraft-intro .pc-card::after{content:'';position:absolute;inset:9px;pointer-events:none;
      border:1px solid ${line};opacity:.32;border-radius:1px}
    #papercraft-intro .pc-head{display:flex; align-items:flex-start; justify-content:space-between; gap:18px; position:relative}
    #papercraft-intro .pc-kicker{font-size:10px;letter-spacing:.34em;text-transform:uppercase;color:${line};margin:2px 0 12px}
    #papercraft-intro h1{margin:0;font-size:clamp(32px,7vw,44px);line-height:1.04;font-weight:600;letter-spacing:.04em}
    #papercraft-intro .pc-en{margin:10px 0 0;font-size:11px;letter-spacing:.4em;text-transform:uppercase;color:${line}}
    #papercraft-intro .pc-seal{flex:none;width:46px;height:46px;margin-top:2px;border:2px solid ${seal};color:${seal};
      display:grid;place-items:center;font-size:13px;line-height:1.1;font-weight:600;letter-spacing:.04em;border-radius:2px;opacity:.92}
    #papercraft-intro .pc-rule{display:flex;align-items:center;gap:10px;margin:22px 0 18px;color:${line};position:relative}
    #papercraft-intro .pc-rule::before,#papercraft-intro .pc-rule::after{content:'';height:1px;flex:1;background:${line};opacity:.5}
    #papercraft-intro .pc-rule i{width:6px;height:6px;transform:rotate(45deg);background:${line};opacity:.7}
    #papercraft-intro .pc-lede{margin:0 0 22px;font-size:15px;line-height:1.75;position:relative}
    #papercraft-intro .pc-lede small{display:block;margin-top:4px;font-size:12.5px;color:${line};font-style:italic}
    #papercraft-intro dl{display:grid;grid-template-columns:auto 1fr;gap:10px 16px;margin:0 0 26px;font-size:13px;
      align-items:center;position:relative}
    #papercraft-intro dt{margin:0;white-space:nowrap}
    #papercraft-intro dd{margin:0;color:${ink};opacity:.82;line-height:1.45}
    #papercraft-intro kbd{display:inline-block;min-width:1.35em;padding:2px 6px;margin-right:3px;text-align:center;
      font:600 11px/1.5 ui-monospace,'SF Mono',Menlo,monospace;color:${ink};background:rgba(120,96,64,.09);
      border:1px solid ${line};border-radius:3px;box-shadow:0 1px 0 rgba(90,68,42,.2)}
    #papercraft-intro .pc-go{position:relative;width:100%;padding:13px 18px;font:inherit;font-size:15px;letter-spacing:.12em;
      color:${stock};background:${ink};border:0;border-radius:2px;cursor:pointer;transition:background .18s ease,transform .18s ease}
    #papercraft-intro .pc-go:hover{background:${seal}}
    #papercraft-intro .pc-go:active{transform:translateY(1px)}
    #papercraft-intro .pc-go:focus-visible{outline:2px solid ${seal};outline-offset:3px}
    #papercraft-intro .pc-foot{margin:12px 0 0;text-align:center;font-size:11px;color:${line};opacity:.85;position:relative}
    #papercraft-intro .pc-copy{margin:7px 0 0;text-align:center;font-size:10.5px;letter-spacing:.08em;color:${line};opacity:.66;position:relative}
    @media (max-width:420px){#papercraft-intro dl{grid-template-columns:1fr;gap:6px 0}
      #papercraft-intro dd{margin:0 0 8px}}
    @media (prefers-reduced-motion:reduce){#papercraft-intro{transition:none}}
  `;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.id = 'papercraft-intro';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'papercraft-intro-title');
  wrap.innerHTML = `
    <div class="pc-card">
      <div class="pc-head">
        <div>
          <p class="pc-kicker">New York City</p>
          <h1 id="papercraft-intro-title">Paper Central Park</h1>
          <p class="pc-en">A Paper Manhattan You Can Walk</p>
        </div>
        <div class="pc-seal" aria-hidden="true">CP</div>
      </div>
      <div class="pc-rule" aria-hidden="true"><i></i></div>
      <p class="pc-lede">A paper Central Park you can walk: the real lakes, the real bridges, the
        city wall pressing against the green.
        <small>Walk the Mall, cross Bow Bridge, and find the park's landmarks — Bethesda, Belvedere and the skyline.</small></p>
      <dl>
        <dt><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd></dt>
        <dd>walk</dd>
        <dt>drag</dt>
        <dd>look around</dd>
        <dt>wheel</dt>
        <dd>zoom</dd>
        <dt><kbd>Tab</kbd></dt>
        <dd>show / hide the chart</dd>
        <dt><kbd>M</kbd></dt>
        <dd>music on / off</dd>
        <dt>click a name tag</dt>
        <dd>read the site's story</dd>
        <dt>double-click the chart</dt>
        <dd>set the man down on the nearest dry land</dd>
      </dl>
      <button class="pc-go" type="button">Begin</button>
      <p class="pc-foot">Tab opens the chart at any time</p>
      <p class="pc-copy">© 2026 reachlin</p>
    </div>`;
  document.body.appendChild(wrap);

  const btn = wrap.querySelector('.pc-go');
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    removeEventListener('keydown', onKey, true);
    removeEventListener('wheel', onWheel, { capture: true });
    wrap.classList.add('gone');
    const drop = () => { wrap.remove(); style.remove(); };
    wrap.addEventListener('transitionend', drop, { once: true });
    setTimeout(drop, 600);                            // in case the transition never fires (hidden tab, reduced motion)
  };

  // While the card is open the keys are the card's. Enter/Space/Escape dismiss it; every other key is
  // swallowed before the harness sees it, so the man does not walk off while you are reading.
  const onKey = (e) => {
    // browser chords (reload, devtools, function keys) keep their defaults; the page's own keys do not
    if (e.metaKey || e.ctrlKey || e.altKey || /^F\d+$/.test(e.key)) { e.stopImmediatePropagation(); return; }
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault(); e.stopImmediatePropagation(); close(); return;
    }
    if (e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); btn.focus(); return; }
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const onWheel = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };

  addEventListener('keydown', onKey, true);
  addEventListener('wheel', onWheel, { capture: true, passive: false });
  btn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
  btn.focus({ preventScroll: true });

  return { el: wrap, close };
}
