(() => {
  const get = (id) => document.getElementById(id);
  const form = get('starter-settings');
  const hero = get('starter-hero');
  const role = get('starter-role');
  const run = get('starter-run');
  const retry = get('starter-retry');
  const copy = get('starter-copy');
  const copyStatus = get('starter-copy-status');
  const status = get('starter-status');
  const results = get('starter-results');
  const lanes = get('starter-lanes');
  const counts = new Intl.NumberFormat('en-US');
  const decimals = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  const state = { meta: null, view: null, lane: null, request: null };
  const statLabels = {
    lastHitDamage: 'Creep hit before armor',
    attackDps: 'Attack DPS vs. 2 armor',
    health: 'Health',
    physicalEhp: 'Physical effective HP',
    magicEhp: 'Magic effective HP',
    laneHealing: 'Extra healing in 2 min',
    laneMana: 'Extra mana in 2 min',
    moveSpeed: 'Move speed',
    vision: 'Sentries bought',
  };
  const laneStats = {
    balanced: ['lastHitDamage', 'health', 'laneHealing', 'laneMana'],
    sustain: ['laneHealing', 'laneMana', 'health', 'magicEhp'],
    trading: ['attackDps', 'physicalEhp', 'health', 'laneHealing'],
    'last-hits': ['lastHitDamage', 'attackDps', 'health', 'laneHealing'],
  };

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function safeKey(key) {
    return /^[a-z0-9_-]+$/.test(key ?? '');
  }

  function money(value) {
    return Number.isFinite(value) ? `${counts.format(value)}g` : '—';
  }

  function setStatus(message, failed = false) {
    status.textContent = message;
    status.classList.toggle('starter-error', failed);
    retry.hidden = !failed;
  }

  async function fetchJson(url, signal) {
    const response = await fetch(url, { signal }).catch((error) => {
      if (signal?.aborted) throw error;
      throw new Error('Could not connect to the analyzer. Try again.');
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.error ?? 'Could not load starting items.');
    return data;
  }

  function itemIcon(key) {
    return safeKey(key)
      ? `<span class="item-icon" aria-hidden="true"><img src="/assets/items/${key}.png" alt="" loading="lazy" decoding="async"></span>`
      : '<span></span>';
  }

  function itemList(items) {
    return `<ul class="starter-items" aria-label="Items to buy before the horn" role="list">${items.map((item) => {
      const { key, name, cost, quantity = 1 } = item;
      const amount = quantity > 1 ? ` <span class="starter-quantity">×${counts.format(quantity)}</span>` : '';
      return `<li>${itemIcon(key)}<strong class="starter-item-name">${escape(name)}${amount}</strong>
        <span class="starter-item-price">${money(cost * quantity)}${quantity > 1 ? `<small>${money(cost)} each</small>` : ''}</span></li>`;
    }).join('')}</ul>`;
  }

  function statsMarkup(metrics, keys) {
    const values = keys.filter((key) => Number.isFinite(metrics?.[key]));
    if (!values.length) return '';
    return `<dl class="starter-metrics">${values.map((key) =>
      `<div><dt>${statLabels[key]}</dt><dd>${decimals.format(metrics[key])}</dd></div>`).join('')}</dl>`;
  }

  function listNotes(notes) {
    return (notes ?? []).filter((note) => typeof note === 'string').map((note) => `<li>${escape(note)}</li>`).join('');
  }

  function packageMarkup(loadout, lane, heading, isPrimary) {
    const primaryStats = laneStats[lane.key] ?? laneStats.balanced;
    const fullStats = Object.keys(statLabels);
    const otherStats = isPrimary ? fullStats.filter((key) => !primaryStats.includes(key)) : fullStats;
    const score = Number.isFinite(loadout.score) ? `<p class="subtle">Lane score ${decimals.format(loadout.score)}</p>` : '';
    const notes = listNotes(loadout.notes);
    const details = statsMarkup(loadout.metrics, otherStats);
    return `<article class="surface starter-package">
      <header class="starter-package-heading">
        <h3>${heading}</h3>
        <strong class="starter-total">${money(loadout.cost)} spent · ${money(loadout.unspent)} left</strong>
      </header>
      ${itemList(loadout.items ?? [])}
      ${isPrimary ? statsMarkup(loadout.metrics, primaryStats) : ''}
      ${score}
      ${notes ? `<ul class="starter-notes">${notes}</ul>` : ''}
      ${details ? `<details class="starter-metric-details"><summary>${isPrimary ? 'More lane estimates' : 'Lane estimates'}</summary>${details}</details>` : ''}
    </article>`;
  }

  function shareUrl(view) {
    const params = new URLSearchParams({ hero: view.hero.slug, role: view.role, lane: state.lane });
    return `/starting-builds?${params}`;
  }

  function renderLane() {
    const view = state.view;
    const selected = view.lanes.find(({ key }) => key === state.lane) ?? view.lanes[0];
    state.lane = selected?.key ?? state.meta.defaults.lane;
    for (const button of lanes.querySelectorAll('[data-lane]')) {
      button.setAttribute('aria-pressed', String(button.dataset.lane === state.lane));
    }
    if (!selected) {
      get('starter-loadouts').innerHTML = '<p class="surface starter-empty">No starting loadouts are available for this role.</p>';
      return;
    }
    const [strongest, ...alternatives] = selected.results ?? [];
    get('starter-loadouts').innerHTML = `<section aria-labelledby="starter-lane-heading">
      <header class="starter-lane-heading">
        <h2 id="starter-lane-heading">${escape(selected.label)}</h2>
        ${selected.description ? `<p class="subtle">${escape(selected.description)}</p>` : ''}
      </header>
      ${strongest ? `<div class="starter-card-grid${alternatives.length ? '' : ' starter-single'}">
        ${packageMarkup(strongest, selected, 'Recommended loadout', true)}
        ${alternatives.length ? `<div class="starter-alternatives">${alternatives.map((loadout, index) =>
          packageMarkup(loadout, selected, `Alternative ${index + 1}`, false)).join('')}</div>` : ''}
      </div>` : '<p class="surface starter-empty">No loadouts fit the starting budget for this goal.</p>'}
    </section>`;
  }

  function render(view, lane) {
    state.view = view;
    state.lane = lane;
    const { slug, name } = view.hero;
    const portrait = get('starter-portrait');
    portrait.hidden = !safeKey(slug);
    portrait.innerHTML = !portrait.hidden ? `<img src="/assets/heroes/${slug}.jpg" alt="" decoding="async">` : '';
    get('starter-result-heading').textContent = `${name} · ${view.roleLabel}`;
    get('starter-context').textContent = `${money(view.budget)} starting budget`;
    get('starter-hero-link').href = `/hero/${encodeURIComponent(slug)}?${new URLSearchParams({ role: view.role })}`;
    const context = new URLSearchParams({ hero: slug, role: view.role });
    get('starter-search-link').href = `/best-builds?${context}`;
    get('starter-timing-link').href = `/build-timings?${context}`;
    lanes.innerHTML = view.lanes.filter(({ key }) => safeKey(key)).map(({ key, label }) =>
      `<button type="button" data-lane="${key}" aria-pressed="false" aria-controls="starter-loadouts">${escape(label)}</button>`).join('');
    const assumptions = (view.assumptions ?? []).map((line) => `<p>${escape(line)}</p>`).join('');
    const tested = Number.isFinite(view.search?.evaluated)
      ? `<p>${counts.format(view.search.evaluated)} loadouts evaluated within the starting budget.</p>` : '';
    const { observed } = view;
    const replays = observed?.sampleSize > 0 && Array.isArray(observed.items)
      ? `<details class="starter-metric-details"><summary>Recorded before-horn purchases</summary>
        <p>Item appearances across ${counts.format(observed.sampleSize)} recorded Legend replay${observed.sampleSize === 1 ? '' : 's'} for this hero and position.</p>
        <ul class="starter-notes">${observed.items.map((item) => `<li>${escape(item.name)} · ${counts.format(item.games)}</li>`).join('')}</ul></details>` : '';
    get('starter-method').innerHTML = `${assumptions}${tested}${replays}`;
    results.hidden = false;
    renderLane();
  }

  function readQuery() {
    const query = new URLSearchParams(location.search);
    for (const control of [hero, role]) {
      control.value = query.get(control.name) ?? state.meta.defaults[control.name];
      if (!control.checkValidity()) control.value = state.meta.defaults[control.name];
    }
    const lane = query.get('lane');
    return state.meta.lanes?.some(({ key }) => key === lane) ? lane : state.meta.defaults.lane;
  }

  async function search(lane, publish = false) {
    const query = new URLSearchParams(new FormData(form));
    state.request?.abort();
    const request = new AbortController();
    state.request = request;
    run.disabled = true;
    copy.disabled = true;
    lanes.inert = true;
    results.setAttribute('aria-busy', 'true');
    copyStatus.textContent = '';
    setStatus('Comparing opening loadouts…');
    try {
      const view = await fetchJson(`/api/starting-builds?${query}`, request.signal);
      if (request.signal.aborted) return;
      if (!view.hero || !Array.isArray(view.lanes)) throw new Error('Starting items are temporarily unavailable.');
      render(view, lane);
      if (publish && shareUrl(view) !== location.pathname + location.search) {
        history.pushState(null, '', shareUrl(view));
      }
      setStatus(new URLSearchParams(new FormData(form)).toString() === query.toString()
        ? '' : 'Select Find starting items to apply your changes.');
    } catch (error) {
      if (!request.signal.aborted) setStatus(error.message || 'Starting items could not load.', true);
    } finally {
      if (!request.signal.aborted) {
        run.disabled = false;
        copy.disabled = !state.view;
        lanes.inert = false;
        results.removeAttribute('aria-busy');
      }
    }
  }

  async function start() {
    setStatus('Loading heroes and roles…');
    try {
      state.meta = await fetchJson('/api/starting-builds/meta');
      get('starter-patch').textContent = `Patch ${state.meta.patch}`;
      hero.replaceChildren(...state.meta.heroes.map(({ name, slug }) => new Option(name, slug)));
      role.replaceChildren(...state.meta.roles.map(({ key, label }) => new Option(label, key)));
      hero.disabled = false;
      role.disabled = false;
      await search(readQuery());
    } catch (error) {
      setStatus(error.message || 'Could not load heroes and roles.', true);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.meta) void search(state.lane ?? state.meta.defaults.lane, true);
  });
  retry.addEventListener('click', () => void (state.meta ? search(state.lane ?? readQuery(), true) : start()));
  form.addEventListener('change', () => {
    if (state.view && !run.disabled) setStatus('Select Find starting items to apply your changes.');
  });
  lanes.addEventListener('click', (event) => {
    const desired = event.target.closest('[data-lane]')?.dataset.lane;
    if (!state.view || !desired || desired === state.lane) return;
    state.lane = desired;
    renderLane();
    copyStatus.textContent = '';
    history.pushState(null, '', shareUrl(state.view));
  });
  window.addEventListener('popstate', () => {
    if (!state.meta) return;
    const lane = readQuery();
    if (state.view?.hero.slug === hero.value && state.view.role === role.value && !lanes.inert) {
      state.lane = lane;
      renderLane();
      setStatus('');
      copyStatus.textContent = '';
    } else void search(lane);
  });
  copy.addEventListener('click', async () => {
    if (!state.view) return;
    const path = shareUrl(state.view);
    try {
      await navigator.clipboard.writeText(new URL(path, location.origin).href);
      copyStatus.textContent = 'Starting build link copied.';
    } catch {
      if (path !== location.pathname + location.search) history.replaceState(null, '', path);
      copyStatus.textContent = 'Copy the address to share this starting build.';
    }
  });
  void start();
})();
