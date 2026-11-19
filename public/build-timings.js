(() => {
  const get = (id) => document.getElementById(id);
  const form = get('timing-settings');
  const status = get('timing-status');
  const run = get('timing-run');
  const retry = get('timing-retry');
  const copy = get('timing-copy');
  const itemSelect = get('timing-item');
  const addItem = get('timing-add-item');
  const metricSelect = get('timing-metric');
  const minuteSelect = get('timing-minute');
  const canvas = get('timing-canvas');
  const maxSteps = 6;
  const counts = new Intl.NumberFormat('en-US');
  const decimals = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  const names = new Intl.ListFormat('en', { type: 'conjunction' });
  const palette = ['#f4a08a', '#94d8b8', '#abc2ff', '#e8ca84', '#d7b6f5', '#85dce3', '#ffa9ce', '#cfda9a'];
  const dashes = [[], [6, 3], [2, 3], [10, 4], [7, 3, 2, 3]];
  const state = { meta: null, items: null, steps: [], result: null, query: null, request: null, dirty: false };

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function slug(hero) {
    return hero.slug ?? hero.key?.replace(/^npc_dota_hero_/, '');
  }

  function money(value) {
    return Number.isFinite(value) ? `${counts.format(value)}g` : '—';
  }

  function damage(value) {
    return Number.isFinite(value) ? decimals.format(value) : '—';
  }

  function clock(value) {
    return Number.isFinite(value) ? `${value}:00` : 'Later';
  }

  function asset(collection, key, extension) {
    return /^[a-z0-9_-]+$/.test(key ?? '') ? `/assets/${collection}/${key}.${extension}` : '';
  }

  function icon(key) {
    const src = asset('items', key, 'png');
    return src ? `<span class="item-icon" aria-hidden="true"><img alt="" loading="lazy" src="${src}"></span>` : '';
  }

  async function fetchJson(url, signal) {
    const response = await fetch(url, { signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'The comparison could not load.');
    return body;
  }

  function options(select, rows, value, label) {
    select.replaceChildren(...rows.map((row) => new Option(label(row), value(row))));
  }

  function updateStepControls() {
    addItem.disabled = !itemSelect.value || state.steps.length >= maxSteps;
    itemSelect.disabled = state.steps.length >= maxSteps;
  }

  function renderSteps() {
    const selected = itemSelect.value;
    options(itemSelect, [{ key: '', name: 'Choose an item' }, ...state.items.values()], (item) => item.key,
      (item) => item.key ? `${item.name} · ${money(item.cost)}` : item.name);
    for (const option of itemSelect.options) option.disabled = state.steps.includes(option.value);
    if (!state.steps.includes(selected)) itemSelect.value = selected;
    get('timing-step-count').textContent = state.steps.length ? `${state.steps.length} of ${maxSteps}` : '';
    get('timing-custom-steps').innerHTML = state.steps.map((key, index) => {
      const item = state.items.get(key);
      const label = escape(item.name);
      return `<li><div class="timing-step-detail"><span class="timing-step-number" aria-hidden="true">${index + 1}</span>${icon(key)}<div><strong>${label}</strong><p class="subtle">${money(item.cost)}</p></div></div>
        <div class="timing-step-actions">
          <button class="compact-button" type="button" aria-label="Move ${label} earlier" data-action="up" data-step="${index}" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="compact-button" type="button" aria-label="Move ${label} later" data-action="down" data-step="${index}" ${index === state.steps.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="compact-button" type="button" aria-label="Remove ${label}" data-action="remove" data-step="${index}">×</button>
        </div></li>`;
    }).join('');
    updateStepControls();
  }

  function setStatus(message, failed = false) {
    status.textContent = message;
    status.classList.toggle('timing-error', failed);
    retry.hidden = !failed;
  }

  function readSharedSettings() {
    const query = new URLSearchParams(location.search);
    const defaults = state.meta.defaults;
    for (const input of [get('timing-hero'), get('timing-role'), get('timing-farm'), get('timing-armor'), get('timing-resistance'), get('timing-bonus-gpm')]) {
      const desired = query.get(input.name) ?? defaults[input.name];
      if (desired == null) continue;
      if (input instanceof HTMLSelectElement && ![...input.options].some(({ value }) => value === String(desired))) continue;
      input.value = desired;
      if (!input.checkValidity() && defaults[input.name] != null) input.value = defaults[input.name];
    }
    state.steps = [...new Set(query.getAll('item'))].filter((key) => state.items.has(key)).slice(0, maxSteps);
    get('timing-custom').open = state.steps.length > 0;
    get('timing-advanced').open = ['targetArmor', 'targetMagicResistance', 'bonusGpm'].some((key) =>
      query.has(key) && Number(query.get(key)) !== Number(defaults[key]));
    renderSteps();
  }

  function queryFromForm() {
    const query = new URLSearchParams(new FormData(form));
    for (const item of state.steps) query.append('item', item);
    return query;
  }

  function markEdited() {
    state.dirty = true;
    if (state.result && run.disabled === false) setStatus('Compare builds to apply your changes.');
  }

  function color(index) {
    return palette[index % palette.length];
  }

  function drawChart() {
    if (!state.result) return;
    const { paths, checkpoints } = state.result;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height || !checkpoints.length) return;
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(scale, scale);
    const metric = metricSelect.value;
    const first = checkpoints.find(({ minute }) => minute >= 5)?.minute ?? checkpoints[0].minute;
    const last = checkpoints.at(-1).minute;
    const visiblePaths = paths.map((path) => path.points.filter(({ minute }) => minute >= first));
    const peak = Math.max(1, ...visiblePaths.flatMap((points) => points.map((point) => Number(point[metric]) || 0)));
    const stepSize = Math.ceil(peak / 4 / 10) * 10;
    const left = width < 370 ? 33 : 46;
    const right = width - 17;
    const top = 19;
    const bottom = height - 28;
    const x = (minute) => left + ((minute - first) / Math.max(1, last - first)) * (right - left);
    const y = (value) => bottom - (value / (stepSize * 4)) * (bottom - top);

    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let tick = 0; tick <= 4; tick += 1) {
      const value = tick * stepSize;
      const row = y(value);
      ctx.strokeStyle = '#34363d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, row);
      ctx.lineTo(right, row);
      ctx.stroke();
      ctx.fillStyle = '#a4a5ad';
      ctx.textAlign = 'right';
      ctx.fillText(counts.format(value), left - 5, row);
    }
    const interval = width >= 550 ? 5 : 10;
    const labels = new Set([first, last]);
    for (let minute = interval; minute < last; minute += interval) {
      if (minute >= first + (interval === 5 ? 1 : 4) && minute <= last - 3) labels.add(minute);
    }
    ctx.textAlign = 'center';
    for (const minute of labels) ctx.fillText(`${minute}m`, x(minute), bottom + 16);
    const selected = Number(minuteSelect.value);
    if (selected >= first && selected <= last) {
      ctx.strokeStyle = '#777983';
      ctx.beginPath();
      ctx.moveTo(x(selected), top);
      ctx.lineTo(x(selected), bottom);
      ctx.stroke();
    }

    for (const [index, points] of visiblePaths.entries()) {
      const values = points.filter((point) => Number.isFinite(point[metric]));
      if (!values.length) continue;
      ctx.strokeStyle = color(index);
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.setLineDash(dashes[index % dashes.length]);
      ctx.beginPath();
      ctx.moveTo(x(values[0].minute), y(values[0][metric]));
      for (let i = 1; i < values.length; i += 1) {
        ctx.lineTo(x(values[i].minute), y(values[i - 1][metric]));
        ctx.lineTo(x(values[i].minute), y(values[i][metric]));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      const point = values.find(({ minute }) => minute === selected);
      if (point) {
        ctx.fillStyle = color(index);
        ctx.beginPath();
        ctx.arc(x(selected), y(point[metric]), 3.8, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }

  function renderPoints() {
    if (!state.result) return;
    const { paths, checkpoints } = state.result;
    const minute = Number(minuteSelect.value);
    const metric = metricSelect.value;
    const snapshots = paths.map(({ points }) => points.find((point) => point.minute === minute));
    const best = Math.max(...snapshots.map((point) => point?.[metric] ?? -Infinity));
    const leaders = snapshots.filter((point) => Number.isFinite(best) && Math.abs(best - point?.[metric]) < .05).length;
    get('timing-mark-leaders').innerHTML = [15, 20, 30].filter((mark) => checkpoints.some((point) => point.minute === mark)).map((mark) => {
      const ranked = paths.flatMap((path) => {
        const value = path.points.find((point) => point.minute === mark)?.[metric];
        return Number.isFinite(value) ? [{ label: path.label, value }] : [];
      }).sort((a, b) => b.value - a.value);
      if (!ranked.length) return '';
      const tied = ranked.filter(({ value }) => Math.abs(ranked[0].value - value) < .05).length;
      const label = tied > 1 ? `${tied} tied` : ranked[0].label;
      return `<button class="timing-secondary" type="button" data-inspect="${mark}" aria-pressed="${mark === minute}"><strong>${clock(mark)}</strong> ${escape(label)} · ${damage(ranked[0].value)} DPS</button>`;
    }).join('');
    get('timing-leads').innerHTML = paths.map((path, index) => {
      const point = snapshots[index];
      const leads = Number.isFinite(best) && Math.abs(best - point?.[metric]) < .05;
      const label = point?.items?.length ? names.format(point.items.map(({ name }) => name)) : 'No completed items';
      const budget = Number.isFinite(point?.bonusGold) && point.bonusGold > 0 ? ` <span class="subtle">· ${money(point.bonusGold)} extra income</span>` : '';
      const leadLabel = leads && leaders < paths.length ? `<p class="subtle">${leaders === 1 ? 'Leads at this minute' : 'Tied for the lead'}</p>` : '';
      return `<article class="timing-series${leads ? ' timing-leading' : ''}" style="--series:${color(index)}">
        <h3>${escape(path.label)}</h3><strong>${damage(point?.[metric])} DPS</strong>${leadLabel}
        <p class="subtle">${escape(label)}</p><p class="subtle">${money(point?.spent)} spent · ${money(point?.unspent)} spare${budget}</p></article>`;
    }).join('');

    const columns = paths.map(({ label }) => `<th scope="col">${escape(label)}</th>`).join('');
    const purchaseMinutes = new Set(paths.flatMap(({ purchases }) => purchases.map(({ minute }) => minute)));
    const byMinute = paths.map(({ points }) => new Map(points.map((point) => [point.minute, point])));
    const rows = checkpoints.filter((point) => point.minute % 5 === 0 || point.minute === minute || purchaseMinutes.has(point.minute)).map((point) => {
      const cells = byMinute.map((series) => `<td>${damage(series.get(point.minute)?.[metric])}</td>`).join('');
      const samples = Number.isFinite(point.sampleSize) ? counts.format(point.sampleSize) : '—';
      return `<tr${point.minute === minute ? ' class="timing-selected"' : ''}><th scope="row">${clock(point.minute)}</th><td>${point.level}</td><td>${money(point.budget)}</td><td>${samples}</td>${cells}</tr>`;
    }).join('');
    const metricLabel = metricSelect.selectedOptions[0]?.text;
    get('timing-table').innerHTML = `<table><caption class="sr-only">${escape(metricLabel)} at checkpoints and purchase minutes</caption><thead><tr>
      <th scope="col">Minute</th><th scope="col">Level</th><th scope="col">Base budget</th><th scope="col">Farm sample</th>${columns}</tr></thead><tbody>${rows}</tbody></table>`;
    drawChart();
  }

  function renderResults(result) {
    const { hero, paths, checkpoints, farmLabel, roleLabel } = result;
    get('timing-results').hidden = false;
    get('timing-purchases').hidden = false;
    get('timing-method').hidden = false;
    get('timing-context').textContent = `${hero.name} · ${roleLabel} · ${farmLabel}`;
    get('timing-chart-key').innerHTML = paths.map((path, index) => `<li style="--series:${color(index)}">${escape(path.label)}</li>`).join('');
    const portrait = asset('heroes', slug(hero), 'jpg');
    get('timing-portrait').innerHTML = portrait ? `<img src="${portrait}" alt="">` : '';
    get('timing-hero-link').href = `/hero/${encodeURIComponent(slug(hero))}?role=${encodeURIComponent(result.role)}`;
    get('timing-hero-link').textContent = `${hero.name} hero guide`;
    const searchQuery = new URLSearchParams({ hero: slug(hero), role: result.role,
      targetArmor: result.options.targetArmor, targetMagicResistance: result.options.targetMagicResistance });
    get('timing-best-link').href = `/best-builds?${searchQuery}`;
    get('timing-assumptions').innerHTML = (result.assumptions ?? []).map((item) => `<p>${escape(item)}</p>`).join('');

    const previousMinute = Number(minuteSelect.value);
    const available = checkpoints.filter(({ minute }) => minute >= 5);
    options(minuteSelect, available, ({ minute }) => String(minute), ({ minute }) => clock(minute));
    const inspect = available.some(({ minute }) => minute === previousMinute) ? previousMinute
      : available.find(({ minute }) => minute >= 20)?.minute ?? available.at(-1)?.minute;
    if (inspect != null) minuteSelect.value = String(inspect);

    const last = checkpoints.at(-1)?.minute;
    get('timing-paths').innerHTML = paths.map((path, index) => {
      const list = path.purchases.map((item) => {
        const { key, name, cost, incrementalCost, minute, replacedItems } = item;
        const used = replacedItems?.length ? `Uses ${escape(names.format(replacedItems.map(({ name }) => name)))}` : '';
        const price = Number.isFinite(incrementalCost) && incrementalCost !== cost ? `${money(incrementalCost)} upgrade` : money(cost);
        return `<li${minute == null ? ' class="timing-later"' : ''}>${icon(key)}<div><strong>${escape(name)}</strong><p class="subtle">${price}${used ? ` · ${used}` : ''}</p></div>
          <p>${minute == null ? `After ${clock(last)}` : clock(minute)}</p></li>`;
      }).join('');
      return `<article class="surface timing-path" style="--series:${color(index)}"><header><h3>${escape(path.label)}</h3>
        ${path.note ? `<p class="subtle">${escape(path.note)}</p>` : ''}</header>
        <ol class="timing-purchase-list" role="list">${list}</ol></article>`;
    }).join('');
    renderPoints();
  }

  async function compare({ updateUrl = true } = {}) {
    const query = queryFromForm();
    state.request?.abort();
    const request = new AbortController();
    state.request = request;
    state.dirty = false;
    run.disabled = true;
    copy.disabled = true;
    get('timing-results').setAttribute('aria-busy', 'true');
    get('timing-share-status').textContent = '';
    setStatus('Calculating purchase times…');
    try {
      const result = await fetchJson(`/api/build-timings?${query}`, request.signal);
      if (request.signal.aborted) return;
      state.result = result;
      state.query = query;
      renderResults(result);
      if (updateUrl) history.replaceState(null, '', `/build-timings?${query}${location.hash}`);
      setStatus(state.dirty ? 'Compare builds to apply your changes.' : '');
    } catch (error) {
      if (request.signal.aborted) return;
      setStatus(error.message || 'The comparison could not load.', true);
    } finally {
      if (!request.signal.aborted) {
        run.disabled = false;
        copy.disabled = !state.query;
        get('timing-results').removeAttribute('aria-busy');
      }
    }
  }

  async function start() {
    setStatus('Loading comparison settings…');
    try {
      const meta = await fetchJson('/api/build-timings/meta');
      state.meta = meta;
      state.items = new Map(meta.items.slice().sort((a, b) => a.name.localeCompare(b.name)).map((item) => [item.key, item]));
      const heroSelect = get('timing-hero');
      const roleSelect = get('timing-role');
      options(heroSelect, meta.heroes.slice().sort((a, b) => a.name.localeCompare(b.name)), slug, ({ name }) => name);
      options(roleSelect, meta.roles, ({ key }) => key, ({ label }) => label);
      if (meta.farms?.length) options(get('timing-farm'), meta.farms, ({ key }) => key, ({ label }) => label);
      heroSelect.disabled = false;
      roleSelect.disabled = false;
      get('timing-patch').textContent = `Patch ${meta.patch}`;
      readSharedSettings();
      await compare();
    } catch (error) {
      setStatus(error.message || 'Comparison settings could not load.', true);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.meta) void compare();
  });
  form.addEventListener('input', (event) => {
    if (event.target.name) markEdited();
  });
  itemSelect.addEventListener('change', updateStepControls);
  addItem.addEventListener('click', () => {
    if (!itemSelect.value || state.steps.includes(itemSelect.value) || state.steps.length >= maxSteps) return;
    state.steps.push(itemSelect.value);
    itemSelect.value = '';
    renderSteps();
    if (!itemSelect.disabled) itemSelect.focus();
    else run.focus();
    markEdited();
  });
  get('timing-custom-steps').addEventListener('click', (event) => {
    const button = event.target.closest('[data-step]');
    if (!button) return;
    const index = Number(button.dataset.step);
    const direction = button.dataset.action;
    const [item] = state.steps.splice(index, 1);
    if (direction !== 'remove') state.steps.splice(index + (direction === 'up' ? -1 : 1), 0, item);
    renderSteps();
    if (direction === 'remove') itemSelect.focus();
    else {
      const newIndex = state.steps.indexOf(item);
      const same = document.querySelector(`[data-step="${newIndex}"][data-action="${direction}"]:enabled`);
      (same ?? document.querySelector(`[data-step="${newIndex}"][data-action="${direction === 'up' ? 'down' : 'up'}"]`))?.focus();
    }
    markEdited();
  });
  retry.addEventListener('click', () => void (state.meta ? compare() : start()));
  metricSelect.addEventListener('change', renderPoints);
  minuteSelect.addEventListener('change', renderPoints);
  get('timing-mark-leaders').addEventListener('click', (event) => {
    const button = event.target.closest('[data-inspect]');
    if (!button) return;
    const mark = button.dataset.inspect;
    minuteSelect.value = mark;
    renderPoints();
    get('timing-mark-leaders').querySelector(`[data-inspect="${mark}"]`)?.focus();
  });
  new ResizeObserver(drawChart).observe(get('timing-chart'));
  copy.addEventListener('click', async () => {
    if (!state.query) return;
    const url = new URL(`/build-timings?${state.query}`, location.origin);
    try {
      await navigator.clipboard.writeText(url.href);
      get('timing-share-status').textContent = 'Comparison link copied.';
    } catch {
      get('timing-share-status').textContent = 'Copy the displayed address to share these results.';
    }
  });
  window.addEventListener('popstate', () => {
    if (!state.meta) return;
    readSharedSettings();
    void compare({ updateUrl: false });
  });
  void start();
})();
