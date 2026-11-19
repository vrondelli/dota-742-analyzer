(() => {
  const get = (id) => document.getElementById(id);
  const form = get('search-settings');
  const heroSelect = get('search-hero');
  const roleSelect = get('search-role');
  const armor = get('search-armor');
  const resistance = get('search-resistance');
  const run = get('search-run');
  const retry = get('search-retry');
  const copy = get('search-copy');
  const status = get('search-status');
  const copyStatus = get('search-copy-status');
  const results = get('search-results');
  const counts = new Intl.NumberFormat('en-US');
  const decimals = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  const state = { meta: null, request: null, applied: null };

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function money(value) {
    return Number.isFinite(value) ? `${counts.format(value)}g` : '—';
  }

  function clock(minute) {
    return Number.isFinite(minute) ? `${minute}:00` : '—';
  }

  function safeKey(key) {
    return /^[a-z0-9_-]+$/.test(key ?? '');
  }

  function itemIcon(key) {
    return safeKey(key)
      ? `<span class="item-icon" aria-hidden="true"><img src="/assets/items/${key}.png" alt="" loading="lazy" decoding="async"></span>`
      : '<span></span>';
  }

  async function fetchJson(url, signal) {
    const response = await fetch(url, { signal });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.error ?? 'Could not load build search.');
    return data;
  }

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('build-search-error', error);
    retry.hidden = !error;
  }

  function slug(hero) {
    return hero?.slug ?? hero?.key?.replace(/^npc_dota_hero_/, '');
  }

  function readQuery() {
    const query = new URLSearchParams(location.search);
    const choices = [heroSelect, roleSelect, armor, resistance];
    for (const control of choices) {
      control.value = query.get(control.name) ?? state.meta.defaults[control.name];
      if (!control.checkValidity()) control.value = state.meta.defaults[control.name];
    }
    get('search-advanced').open = [armor, resistance].some(({ name, value }) => Number(value) !== Number(state.meta.defaults[name]));
  }

  function comparisonLink(route, farm, view, query) {
    const keys = route.steps.map(({ key }) => key);
    if (!keys.length || keys.length > 6 || new Set(keys).size !== keys.length || !keys.every(safeKey)) return '';
    const params = new URLSearchParams({ hero: slug(view.hero), role: view.role, farm: farm.key });
    for (const field of ['targetArmor', 'targetMagicResistance']) {
      if (Number.isFinite(view.options?.[field])) params.set(field, view.options[field]);
      else if (query.has(field)) params.set(field, query.get(field));
    }
    for (const key of keys) params.append('item', key);
    return `<a class="build-search-compare" href="/build-timings?${escape(params.toString())}">Compare purchase timings</a>`;
  }

  const extraCriteria = [
    { key: 'physicalDps', label: 'Physical DPS' },
    { key: 'procDps', label: 'Magic proc DPS' },
    { key: 'physicalEhp', label: 'Physical effective HP' },
    { key: 'magicEhp', label: 'Magic effective HP' },
    { key: 'manaRegen', label: 'Mana regeneration' },
  ];

  function metricsMarkup(route, objective) {
    const { metrics, earlyScore } = route;
    const criteria = [...(objective.criteria ?? []), ...extraCriteria];
    const seen = new Set();
    const rows = criteria.flatMap(({ key, label, unit }) => {
      if (seen.has(key) || !Number.isFinite(metrics?.[key])) return [];
      seen.add(key);
      const suffix = unit ? ` ${escape(unit)}` : '';
      return [`<dt>${escape(label)}</dt><dd>${decimals.format(metrics[key])}${suffix}</dd>`];
    });
    if (Number.isFinite(earlyScore)) {
      rows.push(`<dt>Average score before checkpoint</dt><dd>${decimals.format(earlyScore)} ${escape(objective.scoreUnit ?? 'pt')}</dd>`);
    }
    return rows.length
      ? `<details class="build-search-route-metrics"><summary>Score details</summary><dl>${rows.join('')}</dl></details>`
      : '';
  }

  function stepMarkup(step, index) {
    const credit = (step.replacedItems ?? []).map(({ name }) => name).filter(Boolean);
    const recipe = credit.length ? `<span class="build-search-recipe">Uses ${escape(credit.join(', '))}</span>` : '';
    return `<li>
      <span class="build-search-step-number" aria-hidden="true">${index + 1}.</span>
      ${itemIcon(step.key)}
      <div class="build-search-item-name"><strong>${escape(step.name)}</strong>${recipe}</div>
      <div class="build-search-step-meta"><span class="build-search-step-time">${clock(step.minute)}</span>
        <span class="build-search-step-cost">${money(step.incrementalCost ?? step.cost)}</span></div>
    </li>`;
  }

  function routeMarkup(route, index, farm, view, query) {
    const unit = view.objective.scoreUnit ?? 'pt';
    const score = Number.isFinite(route.score) ? `${decimals.format(route.score)} ${escape(unit)}` : 'Score unavailable';
    const label = index === 0 ? 'First choice' : `Choice ${index + 1}`;
    const steps = Array.isArray(route.steps) ? route.steps : [];
    const items = Array.isArray(route.items) ? route.items : [];
    return `<section class="build-search-route" aria-label="${label}">
      <div class="build-search-route-head">
        <strong>${score}</strong>
        <span class="subtle">${money(route.spent)} spent</span>
      </div>
      ${steps.length
        ? `<ol class="build-search-steps" aria-label="Purchase order" role="list">${steps.map(stepMarkup).join('')}</ol>`
        : '<p class="subtle">No purchases completed by this minute.</p>'}
      ${items.length ? `<p class="sr-only">Final inventory: ${escape(items.map(({ name }) => name).join(', '))}</p>` : ''}
      ${metricsMarkup(route, view.objective)}
      ${comparisonLink({ ...route, steps }, farm, view, query)}
    </section>`;
  }

  function markMarkup(mark, farm, view, query) {
    const [winner, ...alternatives] = mark.results ?? [];
    const title = escape(`search-mark-${farm.key}-${mark.minute}`);
    return `<article class="surface build-search-mark" aria-labelledby="${title}">
      <header><h3 id="${title}">${clock(mark.minute)}</h3><p class="subtle">${money(mark.budget)} budget · Level ${escape(mark.level ?? '—')}</p></header>
      ${winner ? routeMarkup(winner, 0, farm, view, query) : '<p class="build-search-empty">No plans at this checkpoint.</p>'}
      ${alternatives.length ? `<details class="build-search-alternatives">
        <summary>${alternatives.length} alternative${alternatives.length === 1 ? '' : 's'}</summary>
        ${alternatives.map((route, index) => routeMarkup(route, index + 1, farm, view, query)).join('')}
      </details>` : ''}
    </article>`;
  }

  function render(view, query) {
    const heroSlug = slug(view.hero);
    const portrait = safeKey(heroSlug) ? `<img src="/assets/heroes/${heroSlug}.jpg" alt="" decoding="async">` : '';
    get('search-portrait').innerHTML = portrait;
    get('search-portrait').hidden = !portrait;
    get('search-results-heading').textContent = `${view.hero.name} · ${view.roleLabel}`;
    const startingQuery = new URLSearchParams({ hero: view.hero.slug, role: view.role });
    get('search-starting-link').href = `/starting-builds?${startingQuery}`;
    get('search-objective').textContent = view.objective.label;
    const criteria = (view.objective.criteria ?? []).map(({ label, weight }) =>
      `<li>${escape(label)}${Number.isFinite(weight) ? ` ${decimals.format(weight)}%` : ''}</li>`
    ).join('');
    const breadth = view.farms.flatMap(({ label, search }) => Number.isFinite(search?.evaluated)
      ? [`<li>${escape(label)} · ${counts.format(search.evaluated)} candidate purchases scored${Number.isFinite(search.candidateItems)
        ? ` across ${counts.format(search.candidateItems)} eligible items` : ''}</li>`]
      : []).join('');
    get('search-method').innerHTML = `<p>${escape(view.objective.description)}</p>
      ${criteria ? `<ul class="build-search-criteria" aria-label="Scoring weights">${criteria}</ul>` : ''}
      ${(view.assumptions ?? []).map((line) => `<p>${escape(line)}</p>`).join('')}
      ${breadth ? `<ul class="build-search-criteria" aria-label="Search breadth">${breadth}</ul>` : ''}`;
    const farms = view.farms.filter(({ key }) => safeKey(key));
    get('search-jumps').innerHTML = farms.map(({ key, label }) => `<a href="#search-farm-${key}">${escape(label)}</a>`).join('');
    get('search-matrix').innerHTML = farms.map((farm) => `<section class="build-search-farm" id="search-farm-${farm.key}" aria-labelledby="search-farm-heading-${farm.key}">
      <h2 id="search-farm-heading-${farm.key}">${escape(farm.label)}</h2>
      <div class="build-search-marks">${farm.marks.map((mark) => markMarkup(mark, farm, view, query)).join('')}</div>
    </section>`).join('');
    results.hidden = false;
  }

  async function search({ updateUrl = true } = {}) {
    const query = new URLSearchParams(new FormData(form));
    state.request?.abort();
    const request = new AbortController();
    state.request = request;
    run.disabled = true;
    copy.disabled = true;
    results.setAttribute('aria-busy', 'true');
    copyStatus.textContent = '';
    setStatus('Searching purchase orders…');
    try {
      const view = await fetchJson(`/api/best-builds?${query}`, request.signal);
      if (request.signal.aborted) return;
      if (!view.hero || !view.objective || !Array.isArray(view.farms)) throw new Error('Search results are temporarily unavailable.');
      render(view, query);
      state.applied = query.toString();
      if (updateUrl) {
        const method = location.search ? 'pushState' : 'replaceState';
        const next = `/best-builds?${query}${location.hash}`;
        if (`${location.pathname}${location.search}${location.hash}` !== next) history[method](null, '', next);
      }
      setStatus(new URLSearchParams(new FormData(form)).toString() === state.applied
        ? '' : 'Select Find builds to apply your changes.');
    } catch (error) {
      if (!request.signal.aborted) setStatus(error.message || 'Search could not finish.', true);
    } finally {
      if (!request.signal.aborted) {
        run.disabled = false;
        copy.disabled = !state.applied;
        results.removeAttribute('aria-busy');
      }
    }
  }

  async function start() {
    setStatus('Loading heroes and roles…');
    try {
      const meta = await fetchJson('/api/best-builds/meta');
      state.meta = meta;
      get('search-patch').textContent = `Patch ${meta.patch}`;
      const heroes = [...meta.heroes].sort((a, b) => a.name.localeCompare(b.name));
      heroSelect.replaceChildren(...heroes.map((hero) => new Option(hero.name, slug(hero))));
      roleSelect.replaceChildren(...meta.roles.map(({ key, label }) => new Option(label, key)));
      heroSelect.disabled = false;
      roleSelect.disabled = false;
      readQuery();
      await search({ updateUrl: false });
    } catch (error) {
      setStatus(error.message || 'Could not load heroes and roles.', true);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.meta) void search();
  });
  retry.addEventListener('click', () => void (state.meta ? search() : start()));
  form.addEventListener('input', () => {
    if (state.applied && !run.disabled) setStatus('Select Find builds to apply your changes.');
  });
  window.addEventListener('popstate', () => {
    if (!state.meta) return;
    const before = new URLSearchParams(new FormData(form)).toString();
    readQuery();
    const next = new URLSearchParams(new FormData(form)).toString();
    if (before !== next || state.applied !== next) void search({ updateUrl: false });
  });
  copy.addEventListener('click', async () => {
    if (!state.applied) return;
    const url = new URL(`/best-builds?${state.applied}`, location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      copyStatus.textContent = 'Build search link copied.';
    } catch {
      if (location.search !== `?${state.applied}`) history.replaceState(null, '', url);
      copyStatus.textContent = 'Copy the address to share this search.';
    }
  });
  void start();
})();
