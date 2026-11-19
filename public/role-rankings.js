const roleLabels = {
  carry: 'Carry',
  mid: 'Mid',
  offlane: 'Offlane',
  'soft-support': 'Position 4',
  'hard-support': 'Position 5',
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
  pooledWins: 'Pooled win evidence',
};
const farmLabels = { bad: 'Slow', good: 'Steady', easy: 'Fast' };
const decimals = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const counts = new Intl.NumberFormat('en-US');
const points = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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
    const estimates = scoring.goldBudgets.carry.map(({ key }, index) =>
      `${farmLabels[key]} ${points.format(hero.dpsByFarmScenario[index])}`);
    return `<p>Modeled DPS · ${estimates.join(' · ')} · ${points.format(hero.dpsMean)} mean</p>`;
  }
  if (role === 'mid') {
    const benchmark = hero.spellBenchmark;
    return benchmark
      ? `<p>${escape(benchmark.label)} · ${decimals.format(benchmark.damage)} damage</p>`
      : `<p>Median substituted · ${decimals.format(hero.imputedSpellDamage)} damage</p>`;
  }
  return '';
}

function renderRow(role, hero, scoring) {
  const ratings = Object.entries(hero.ratings).map(([key, rating]) =>
    `${criterionLabel(role, key)} ${rating}/3`).join(' · ');
  const source = hero.heroData?.startsWith('https://www.dota2.com/datafeed/herodata?hero_id=')
    ? `<a class="text-link" href="${escape(hero.heroData)}">Valve hero data <span aria-hidden="true">↗</span></a>`
    : '';
  return `<tr>
    <td class="ranking-index">${hero.rank}</td>
    <th class="ranking-hero" scope="row">
      ${escape(hero.name)}
      <p class="ranking-note-mobile">${escape(hero.mechanic)}</p>
      <details>
        <summary>Breakdown <span class="sr-only">for ${escape(hero.name)}</span></summary>
        <p>${decimals.format(hero.mechanicsPoints)} mechanics points · ${decimals.format(hero.winPoints)} win points</p>
        <p>${escape(ratings)}</p>
        ${benchmarkMarkup(role, hero, scoring)}
        <p>${counts.format(hero.observedPicksInRole)} picks in this role · ${counts.format(hero.pooledWins)}/${counts.format(hero.pooledMatchCount)} pooled wins</p>
        ${source}
      </details>
    </th>
    <td class="ranking-score-cell">
      <strong>${points.format(hero.score)}</strong>
      <progress value="${hero.score}" max="100" aria-hidden="true" tabindex="-1"></progress>
    </td>
    <td class="ranking-note">${escape(hero.mechanic)}</td>
  </tr>`;
}

function renderRole() {
  if (!state.report) return;
  const role = activeRole();
  const { roles, scoring } = state.report;
  const { diagnostics, rankings } = roles[role];
  const roleName = roleLabels[role];
  get('ranking-table-title').textContent = `Top ${rankings.length} · ${roleName}`;
  get('ranking-rows').innerHTML = rankings.map((hero) => renderRow(role, hero, scoring)).join('');
  get('ranking-weights').innerHTML = Object.entries(scoring.criteriaWeights[role]).map(([key, weight]) =>
    `<div><dt>${criterionLabel(role, key)}</dt><dd>${decimals.format(weight)} pts</dd></div>`).join('');
  get('ranking-coverage').textContent = `${counts.format(diagnostics.eligible)} candidates · ${counts.format(diagnostics.seenInRole)} observed in role`;

  const benchmark = get('ranking-benchmark');
  benchmark.hidden = role !== 'carry' && role !== 'mid';
  if (role === 'carry') {
    benchmark.textContent = scoring.goldBudgets.carry.map(({ key, budget }) =>
      `${farmLabels[key]} ${counts.format(budget)}g`).join(' · ');
  } else if (role === 'mid') {
    benchmark.textContent = `${diagnostics.covered} mapped casts of ${diagnostics.eligible} candidates`;
  }

  const method = [
    scoring.eligibility,
    `Kit ratings run from 0 to 3. ${scoring.ratingAnchors.map((text, i) => `${i} ${text.toLowerCase()}`).join(' · ')}.`,
    `Pooled win points use ${scoring.pooledWinPoints}. Scores compare heroes within the selected position.`,
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
  if (tab.dataset.role !== activeRole()) window.history.pushState({}, '', tab.href);
  renderRole();
});
window.addEventListener('popstate', renderRole);

async function load() {
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
    statusLabel.textContent = 'The role rankings could not load. Reload the page to try again.';
    statusLabel.classList.remove('sr-only');
    console.error(error);
  }
}

void load();
