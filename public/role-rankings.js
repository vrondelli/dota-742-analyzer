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
const farmLabels = { bad: 'Slow', good: 'Steady', easy: 'Fast' };
const decimals = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const counts = new Intl.NumberFormat('en-US');
const points = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const list = new Intl.ListFormat('en-US');
const state = { report: null };
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
  return `<tr data-ranked-hero>
    <td class="ranking-index">${hero.rank}</td>
    <th class="ranking-hero" scope="row">
      <button type="button" class="ranking-hero-toggle" data-breakdown="${breakdownId}" aria-controls="${breakdownId}" aria-expanded="false">${escape(hero.name)} <span aria-hidden="true">+</span></button>
      <p class="ranking-note-mobile">${escape(hero.mechanic)}</p>
    </th>
    <td class="ranking-score-cell"><strong>${points.format(hero.score)}</strong></td>
    <td class="ranking-note">${escape(hero.mechanic)}</td>
  </tr><tr class="ranking-breakdown-row" id="${breakdownId}" hidden>
    <td class="ranking-breakdown-cell" colspan="4">
      <div class="ranking-breakdown">
        <div>
          <h3>${escape(hero.name)}'s score</h3>
          <p>${decimals.format(hero.mechanicsPoints)} mechanics points + ${decimals.format(hero.winPoints)} match win points</p>
          <dl class="ranking-detail-stats">${ratings}</dl>
        </div>
        <div>
          ${benchmarkMarkup(role, hero, scoring)}
          <section><h4>Recorded match evidence</h4><p>${counts.format(hero.observedPicksInRole)} picks in this position among reviewed replays.</p>
          <p>${counts.format(hero.pooledWins)} wins in ${counts.format(hero.pooledMatchCount)} matches across all positions.</p></section>
        </div>
        <div class="ranking-breakdown-actions">
          ${slug ? `<a class="text-link" href="/hero/${encodeURIComponent(slug)}?role=${role}">${escape(hero.name)} hero guide</a>` : ''}
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
    : `<tr><td colspan="4" class="loading-cell">${message}</td></tr>`;
  get('ranking-result-count').textContent = search ? `Showing ${matches.length} of ${rankings.length}` : '';
}

function renderRole() {
  if (!state.report) return;
  const role = activeRole();
  const { roles, scoring } = state.report;
  const { diagnostics, rankings } = roles[role];
  const roleName = roleLabels[role];
  get('ranking-table-title').textContent = `Top ${rankings.length} ${roleName.toLowerCase()} heroes`;
  renderRows(role, rankings, scoring);
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
  get('ranking-search').value = '';
  renderRole();
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
  const shareUrl = new URL(`/role-rankings?role=${role}`, window.location.origin);
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
void load();
