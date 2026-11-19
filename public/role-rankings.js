const roleLabels = {
  carry: 'Carry',
  mid: 'Mid',
  offlane: 'Offlane',
  'soft-support': 'Soft support',
  'hard-support': 'Hard support',
};
const criterionLabels = {
  benchmarkDps: 'Modeled right-click DPS',
  benchmarkCast: 'Single-cast damage',
  scaling: 'Kit scaling',
  farm: 'Farming',
  access: 'Target access and survival',
  wave: 'Wave clear',
  rotation: 'Rotations and control',
  reliability: 'Reliability',
  initiation: 'Initiation and lockdown',
  frontline: 'Frontline and space',
  protection: 'Ally protection',
  pressure: 'Wave and objective pressure',
  catch: 'Catch',
  tempo: 'Map tempo',
  lane: 'Laning',
  counterplay: 'Counterplay',
  control: 'Fight control',
  lowGold: 'Low-gold impact',
  pooledWins: 'Match wins across positions',
};
const farmLabels = { bad: 'Bad', good: 'Good', easy: 'Easy' };
const decimals = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const counts = new Intl.NumberFormat('en-US');
const points = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const list = new Intl.ListFormat('en-US');
const state = { report: null, role: null, builds: new Map(), pendingBuilds: new Set(), failedBuilds: new Set() };
const get = (id) => document.getElementById(id);
const statusLabel = get('ranking-status');

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function criterionLabel(role, key) {
  if (role === 'hard-support' && key === 'wave') return 'Wave defense';
  if (role === 'offlane' && key === 'protection') return 'Team protection';
  return criterionLabels[key];
}

function activeRole() {
  const role = new URLSearchParams(window.location.search).get('role');
  return Object.hasOwn(roleLabels, role) ? role : 'carry';
}

function activeFarm() {
  const farm = new URLSearchParams(window.location.search).get('farm');
  return Object.hasOwn(farmLabels, farm) ? farm : 'good';
}

function boardUrl(role, farm = activeFarm()) {
  const query = new URLSearchParams({ role });
  if (farm !== 'good') query.set('farm', farm);
  return `/role-rankings?${query}`;
}

function gold(value) {
  return `${counts.format(value)}g`;
}

function itemIcon(key) {
  if (!/^[a-z0-9_]+$/.test(key ?? '')) return '';
  return `<span class="item-icon" aria-hidden="true"><img src="/assets/items/${key}.png" alt="" loading="lazy" decoding="async"></span>`;
}

function itemList(items, { ordered = false, showCost = false } = {}) {
  const tag = ordered ? 'ol' : 'ul';
  const entries = items.map(({ key, name, cost }) => `<li><span class="ranking-item">${itemIcon(key)}<span>${escape(name)}${showCost && Number.isFinite(cost) ? `<small>${gold(cost)}</small>` : ''}</span></span></li>`).join('');
  return `<${tag} class="ranking-item-list" role="list">${entries}</${tag}>`;
}

function previewMarkup(farm, level) {
  const scenario = farm?.scenarios.find(({ key }) => key === level);
  if (!scenario) return '<span class="subtle">—</span>';
  const fits = scenario.items.filter(({ affordable }) => affordable !== false);
  if (!fits.length) return '<span class="subtle">No items fit</span>';
  const modeled = farm.type === 'right-click-model';
  return `${modeled ? '<p class="subtle ranking-preview-basis">Modeled damage set</p>' : ''}
    ${itemList(fits.slice(0, 3), { ordered: !modeled })}${fits.length > 3 ? `<span class="subtle ranking-preview-extra">+${fits.length - 3} more</span>` : ''}`;
}

function farmBreakdownMarkup(farm, unavailable) {
  if (!farm) return `<h4>Farm builds</h4><p>${unavailable ? 'Build previews unavailable.' : 'Loading builds…'}</p>`;
  const ordered = farm.type !== 'right-click-model';
  return `<h4>Farm builds</h4><p>${escape(farm.label)}</p>
    <div class="ranking-farm-grid">${farm.scenarios.map((scenario) => {
      const fits = scenario.items.filter(({ affordable }) => affordable !== false);
      const later = scenario.items.filter(({ affordable }) => affordable === false);
      const budget = Number.isFinite(scenario.budget) ? `${gold(scenario.budget)} budget` : 'Budget unavailable';
      return `<section class="ranking-farm-case"><h5>${escape(farmLabels[scenario.key] ?? scenario.label)} farm</h5>
        <p class="ranking-farm-budget">${budget}</p>
        ${fits.length ? itemList(fits, { ordered, showCost: true }) : '<p>No items fit.</p>'}
        ${later.length ? `<p class="ranking-later-label">Later purchases</p>${itemList(later, { showCost: true })}` : ''}</section>`;
    }).join('')}</div>`;
}

function renderBuildPreviews(role) {
  const level = activeFarm();
  const builds = state.builds.get(role);
  const failed = state.failedBuilds.has(role);
  const status = get('ranking-build-status');
  for (const button of get('ranking-farm-picker').querySelectorAll('[data-farm]')) {
    button.setAttribute('aria-pressed', String(button.dataset.farm === level));
  }
  for (const link of get('ranking-role-tabs').querySelectorAll('[data-role]')) link.href = boardUrl(link.dataset.role, level);
  for (const cell of get('ranking-rows').querySelectorAll('[data-build-preview]')) {
    cell.innerHTML = previewMarkup(builds?.byHero.get(Number(cell.dataset.buildPreview)), level);
  }
  for (const link of get('ranking-rows').querySelectorAll('[data-timing-hero]')) {
    link.href = `/build-timings?${new URLSearchParams({ hero: link.dataset.timingHero, role, farm: level })}`;
  }
  get('ranking-build-retry').hidden = !failed;
  if (!builds) {
    status.textContent = failed ? 'Build previews could not load.' : 'Loading build previews…';
    return;
  }
  const budget = builds.byHero.values().next().value?.scenarios.find(({ key }) => key === level)?.budget;
  const { targetMinute, reserveGold } = builds.defaults;
  status.textContent = Number.isFinite(budget)
    ? `${gold(budget)} for items by minute ${targetMinute} after setting aside ${gold(reserveGold)}.`
    : `Minute ${targetMinute} builds. Gold budget unavailable.`;
}

async function loadBuilds(role) {
  if (state.builds.has(role) || state.pendingBuilds.has(role)) return;
  state.pendingBuilds.add(role);
  state.failedBuilds.delete(role);
  renderBuildPreviews(role);
  try {
    const response = await fetch(`/api/role-rankings/builds?role=${encodeURIComponent(role)}`);
    if (!response.ok) throw new Error(`Role builds API returned ${response.status}`);
    const builds = await response.json();
    const byHero = new Map(builds.rows.map(({ heroId, farm }) => [heroId, farm]));
    state.builds.set(role, { defaults: builds.defaults, byHero });
  } catch (error) {
    state.failedBuilds.add(role);
    console.error(error);
  } finally {
    state.pendingBuilds.delete(role);
  }
  if (role !== activeRole()) return;
  const byHero = state.builds.get(role)?.byHero;
  for (const section of get('ranking-rows').querySelectorAll('[data-farm-builds]')) {
    section.innerHTML = farmBreakdownMarkup(byHero?.get(Number(section.dataset.farmBuilds)), true);
  }
  renderBuildPreviews(role);
}

function benchmarkMarkup(role, hero, scoring) {
  if (role === 'carry') {
    const estimates = scoring.goldBudgets.carry.map(({ key, budget }, index) =>
      `<div><dt>${farmLabels[key]} farm (${counts.format(budget)}g)</dt><dd>${points.format(hero.dpsByFarmScenario[index])} DPS</dd></div>`);
    return `<section><h4>Modeled right-click damage</h4><dl class="ranking-detail-stats">${estimates.join('')}</dl>
      <p>${points.format(hero.dpsMean)} damage per second on average across the three budgets.</p></section>`;
  }
  if (role === 'mid') {
    const benchmark = hero.spellBenchmark;
    return benchmark
      ? `<section><h4>Modeled single cast</h4><p>${escape(benchmark.label)} deals ${decimals.format(benchmark.damage)} damage per cast.</p></section>`
      : `<section><h4>Estimated single cast</h4><p>The score uses the median of modeled casts (${decimals.format(hero.imputedSpellDamage)} damage) because this hero lacks a cast benchmark.</p></section>`;
  }
  return '';
}

function renderRow(role, hero, scoring) {
  const ratings = Object.entries(hero.ratings).map(([key, rating]) =>
    `<div><dt>${criterionLabel(role, key)}</dt><dd>${rating} / 3</dd></div>`).join('');
  const source = hero.heroData?.startsWith('https://www.dota2.com/datafeed/herodata?hero_id=')
    ? `<a class="text-link" href="${escape(hero.heroData)}">Valve ability data</a>`
    : '';
  const breakdownId = `rank-breakdown-${hero.heroId}`;
  const slug = state.report.heroSlugs?.[hero.heroId];
  const farm = state.builds.get(role)?.byHero.get(hero.heroId);
  return `<tr data-ranked-hero>
    <td class="ranking-index">${hero.rank}</td>
    <th class="ranking-hero" scope="row">
      <button type="button" class="ranking-hero-toggle" data-breakdown="${breakdownId}" aria-controls="${breakdownId}" aria-expanded="false">${escape(hero.name)} <span aria-hidden="true">+</span></button>
    </th>
    <td class="ranking-score-cell"><strong>${points.format(hero.score)}</strong></td>
    <td class="ranking-build-preview" data-build-preview="${hero.heroId}">${previewMarkup(farm, activeFarm())}</td>
    <td class="ranking-note">${escape(hero.mechanic)}</td>
  </tr><tr class="ranking-breakdown-row" id="${breakdownId}" hidden>
    <td class="ranking-breakdown-cell" colspan="5">
      <div class="ranking-breakdown">
        <div>
          <h3>${escape(hero.name)}'s score</h3>
          <p class="ranking-note-mobile">${escape(hero.mechanic)}</p>
          <p>${decimals.format(hero.mechanicsPoints)} mechanics points + ${decimals.format(hero.winPoints)} match win points</p>
          <dl class="ranking-detail-stats">${ratings}</dl>
        </div>
        <div>
          ${benchmarkMarkup(role, hero, scoring)}
          <section><h4>Recorded match evidence</h4><p>${counts.format(hero.observedPicksInRole)} picks in this position among reviewed replays.</p>
          <p>${counts.format(hero.pooledWins)} wins in ${counts.format(hero.pooledMatchCount)} matches across all positions.</p></section>
        </div>
        <section class="ranking-farm-breakdown" data-farm-builds="${hero.heroId}">${farmBreakdownMarkup(farm, state.failedBuilds.has(role))}</section>
        <div class="ranking-breakdown-actions">
          ${slug ? `<a class="text-link" href="/hero/${encodeURIComponent(slug)}?role=${role}">${escape(hero.name)} hero guide</a>` : ''}
          ${slug ? `<a class="text-link" data-timing-hero="${escape(slug)}" href="/build-timings?hero=${encodeURIComponent(slug)}&amp;role=${role}&amp;farm=${activeFarm()}">Compare purchase timings</a>` : ''}
          <a class="text-link" href="/efficiency?heroId=${hero.heroId}">Test a build</a>
          ${source}
        </div>
      </div>
    </td>
  </tr>`;
}

function renderRows(role, rankings, scoring) {
  const search = get('ranking-search').value.trim().toLowerCase();
  const matches = rankings.filter((hero) => hero.name.toLowerCase().includes(search));
  const message = 'No ranked heroes match your search.';
  get('ranking-rows').innerHTML = matches.length
    ? matches.map((hero) => renderRow(role, hero, scoring)).join('')
    : `<tr><td colspan="5" class="loading-cell">${message}</td></tr>`;
  get('ranking-result-count').textContent = search ? `Showing ${matches.length} of ${rankings.length}` : '';
}

function renderRole() {
  if (!state.report) return;
  const role = activeRole();
  state.role = role;
  const { roles, scoring } = state.report;
  const { diagnostics, rankings } = roles[role];
  const roleName = roleLabels[role];
  get('ranking-table-title').textContent = `Top ${rankings.length} ${roleName.toLowerCase()} heroes`;
  renderRows(role, rankings, scoring);
  renderBuildPreviews(role);
  void loadBuilds(role);
  get('ranking-draft').href = `/draft-guide?role=${role}`;
  get('ranking-share').textContent = 'Copy role link';
  get('ranking-weights').innerHTML = Object.entries(scoring.criteriaWeights[role]).map(([key, weight]) =>
    `<div><dt>${criterionLabel(role, key)}</dt><dd>${decimals.format(weight)} pts</dd></div>`).join('');
  get('ranking-coverage').textContent = `Replays included ${counts.format(diagnostics.seenInRole)} of ${counts.format(diagnostics.eligible)} eligible heroes in this position.`;

  const benchmark = get('ranking-benchmark');
  benchmark.hidden = role !== 'carry' && role !== 'mid';
  if (role === 'carry') {
    const budgets = scoring.goldBudgets.carry.map(({ key, budget }) =>
      `${counts.format(budget)}g for ${farmLabels[key].toLowerCase()} farm`);
    benchmark.textContent = `Minute 20 budgets are ${list.format(budgets)}.`;
  } else if (role === 'mid') {
    benchmark.textContent = `Direct cast benchmarks cover ${diagnostics.covered} of ${diagnostics.eligible} candidates. Other candidates use the middle mapped value.`;
  }

  const method = [
    scoring.eligibility,
    `Kit ratings run from 0 to 3. ${list.format(scoring.ratingAnchors.map((text, i) => `${i} means ${text.toLowerCase()}`))}.`,
    `Win points use ${scoring.pooledWinPoints}. Hero scores are comparable within one position.`,
    ...(role === 'carry' ? [scoring.carryBenchmark] : role === 'mid' ? [scoring.midBenchmark] : []),
  ];
  get('ranking-method-notes').innerHTML = method.map((text) => `<li>${escape(text)}</li>`).join('');
  for (const tab of get('ranking-role-tabs').querySelectorAll('[data-role]')) {
    if (tab.dataset.role === role) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  window.document.title = `${roleName} rankings | Dota 2 Analyzer`;
  statusLabel.textContent = `Showing ${rankings.length} ${roleName} rankings.`;
  statusLabel.classList.add('sr-only');
}

get('ranking-role-tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('a[data-role]');
  if (!tab || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (tab.dataset.role !== activeRole()) {
    window.history.pushState({}, '', tab.href);
    get('ranking-search').value = '';
  }
  renderRole();
});
window.addEventListener('popstate', () => {
  if (!state.report) return;
  if (activeRole() === state.role) renderBuildPreviews(state.role);
  else {
    get('ranking-search').value = '';
    renderRole();
  }
});
get('ranking-farm-picker').addEventListener('click', (event) => {
  const choice = event.target.closest('[data-farm]');
  if (!choice || choice.dataset.farm === activeFarm()) return;
  const role = activeRole();
  window.history.pushState({}, '', boardUrl(role, choice.dataset.farm));
  get('ranking-share').textContent = 'Copy role link';
  renderBuildPreviews(role);
});
get('ranking-search').addEventListener('input', () => {
  const role = activeRole();
  if (state.report) renderRows(role, state.report.roles[role].rankings, state.report.scoring);
});
get('ranking-rows').addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-breakdown]');
  if (!trigger) return;
  const panel = get(trigger.dataset.breakdown);
  panel.hidden = !panel.hidden;
  trigger.setAttribute('aria-expanded', String(!panel.hidden));
  trigger.querySelector('span').textContent = panel.hidden ? '+' : '−';
});
get('ranking-share').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const role = activeRole();
  const shareUrl = new URL(boardUrl(role), window.location.origin);
  try {
    await navigator.clipboard.writeText(shareUrl.href);
    if (role === activeRole()) button.textContent = 'Role link copied';
    statusLabel.textContent = 'Role link copied.';
  } catch {
    if (role === activeRole()) button.textContent = 'Copy from address bar';
    statusLabel.textContent = 'Use your browser address bar to copy this link.';
  }
});
const desktop = window.matchMedia('(min-width: 851px)');
const setCriteriaDefault = () => { get('ranking-criteria').open = desktop.matches; };
desktop.addEventListener('change', setCriteriaDefault);
setCriteriaDefault();

async function load() {
  get('ranking-retry').hidden = true;
  statusLabel.classList.remove('sr-only');
  statusLabel.textContent = 'Loading role rankings…';
  try {
    const response = await fetch('/api/role-rankings');
    if (!response.ok) throw new Error(`Rankings API returned ${response.status}`);
    const report = await response.json();
    if (!Object.keys(roleLabels).every((role) => report.roles?.[role]?.rankings?.length === 20)) {
      throw new Error('Rankings data does not contain five complete positions');
    }
    state.report = report;
    get('ranking-matches').textContent = counts.format(report.sample.publicMatches);
    get('ranking-replays').textContent = counts.format(report.sample.positionInferredReplayMatches);
    renderRole();
    get('rankings-layout').hidden = false;
  } catch (error) {
    statusLabel.textContent = 'Role rankings could not load.';
    statusLabel.classList.remove('sr-only');
    get('ranking-retry').hidden = false;
    console.error(error);
  }
}

get('ranking-retry').addEventListener('click', () => { void load(); });
get('ranking-build-retry').addEventListener('click', () => { void loadBuilds(activeRole()); });
void load();
