const get = (id) => document.getElementById(id);
const slugPattern = /^[a-z0-9_-]+$/;
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const score = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = new Intl.NumberFormat('en-US', { signDisplay: 'exceptZero', maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
const farmLabels = { bad: 'Bad farm', good: 'Good farm', easy: 'Easy farm' };
const farmTypes = { curated: 'Hero-specific purchase plan', 'right-click-model': 'Modeled right-click build', 'role-template': 'General role purchase plan' };
const sampleBases = { 'gold-timeline': 'Gold earned by the target minute', 'full-match-gpm': 'Full-match gold per minute' };
const currentSlug = /^\/hero\/([a-z0-9_-]+)\/?$/i.exec(location.pathname)?.[1].toLowerCase();
const isDirectory = /^\/heroes?\/?$/.test(location.pathname);
const enemyLimit = 5;
const state = { heroes: null, conditions: [], profile: null, selection: null, request: null, activeEnemy: -1 };
const enemyInput = get('profile-enemy-search');
const enemyResults = get('profile-enemy-results');
const conditionSelect = get('profile-condition');

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function heroPath(slug) {
  return slugPattern.test(slug ?? '') ? `/hero/${slug}` : '/heroes';
}

function imagePath(collection, key) {
  return slugPattern.test(key ?? '') ? `/assets/${collection}/${key}.${collection === 'heroes' ? 'jpg' : 'png'}` : '';
}

function thumbnail(collection, key, className) {
  const src = imagePath(collection, key);
  return src ? `<span class="${className}" aria-hidden="true"><img src="${src}" alt="" loading="lazy" decoding="async"></span>` : '';
}

function count(value) {
  return Number.isFinite(value) ? number.format(value) : '—';
}

function gold(value) {
  return Number.isFinite(value) ? `${number.format(value)} gold` : 'Budget unavailable';
}

function rate(value) {
  return Number.isFinite(value) ? percent.format(value) : '—';
}

function noun(value, one, many = `${one}s`) {
  return value === 1 ? one : many;
}

async function fetchJson(path, signal) {
  const response = await fetch(path, { signal });
  if (!response.ok) {
    const error = new Error('Could not load hero data.');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function normalized(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function searchHeroes() {
  if (!state.heroes) return;
  const query = normalized(get('profile-search').value);
  const candidates = state.heroes.filter(({ name, slug }) =>
    normalized(name).includes(query) || normalized(slug).includes(query));
  const status = get('search-status');
  if (isDirectory) {
    get('hero-directory-list').innerHTML = candidates.map(({ slug, name }) => `<li><a href="${heroPath(slug)}">
      ${thumbnail('heroes', slug, 'directory-portrait')}<span class="directory-name">${escape(name)}</span></a></li>`).join('');
    get('directory-empty').hidden = candidates.length > 0;
    status.textContent = query ? `${candidates.length} matching ${noun(candidates.length, 'hero', 'heroes')}.` : '';
    return;
  }
  const results = get('hero-search-results');
  results.hidden = !query;
  results.innerHTML = !query ? '' : candidates.slice(0, 8).map(({ slug, name }) =>
    `<li><a href="${heroPath(slug)}">${escape(name)}</a></li>`).join('') || '<li class="profile-empty">No matching heroes.</li>';
  const visible = Math.min(candidates.length, 8);
  status.textContent = query ? `${visible} matching ${noun(visible, 'hero', 'heroes')} shown.` : '';
}

async function loadDirectory() {
  const meta = await fetchJson('/api/hero-profiles/meta');
  state.heroes = [...meta.heroes].sort((a, b) => a.name.localeCompare(b.name));
  state.conditions = meta.conditions ?? [];
  get('profile-patch').textContent = `Patch ${meta.patch}`;
  get('profile-search').disabled = false;
  searchHeroes();
  if (isDirectory) {
    get('hero-directory').hidden = false;
    get('profile-status').textContent = '';
  } else {
    conditionSelect.replaceChildren(new Option('Automatic from enemy picks', 'auto'), new Option('Default builds', 'none'),
      ...state.conditions.map(({ key, label }) => new Option(label, key)));
    if (state.profile) renderDraftSelection(state.profile);
  }
}

function profileQuery() {
  const params = new URLSearchParams(location.search);
  return { role: params.get('role'), enemyIds: params.getAll('enemy').map(Number), condition: params.get('condition') || 'auto' };
}

function profileParams({ role, enemyIds, condition }) {
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  for (const id of enemyIds) params.append('enemy', id);
  if (condition !== 'auto') params.set('condition', condition);
  return params;
}

function profileSelection(profile) {
  return { role: profile.role, enemyIds: profile.enemyIds ?? [], condition: profile.condition || 'auto' };
}

function renderConditionHints(profile) {
  const target = get('profile-condition-hints');
  if (!profile) {
    target.replaceChildren();
    return;
  }
  const { activeCondition, condition, conditionHints = [], enemyIds = [] } = profile;
  const activeLabel = (state.conditions.find(({ key }) => key === activeCondition)
    ?? conditionHints.find(({ key }) => key === activeCondition))?.label;
  const priority = condition === 'auto' && activeLabel
    ? `<p class="subtle">Automatic priority <strong>${escape(activeLabel)}</strong></p>`
    : condition === 'auto' && enemyIds.length
      ? '<p class="subtle">No condition suggested for these picks. You can choose one above.</p>' : '';
  const suggestions = conditionHints.map(({ key, label, enemies }) => `<button type="button" data-condition-hint="${escape(key)}"
    aria-pressed="${key === activeCondition}"><span>${escape(label)}</span><span>${escape(enemies.join(', '))}</span></button>`).join('');
  target.innerHTML = `${priority}${suggestions ? `<div class="profile-condition-links" role="group" aria-label="Suggested conditions">${suggestions}</div>` : ''}`;
}

function renderDraftSelection(profile) {
  if (!state.heroes || !state.selection) return;
  const { condition, enemyIds } = state.selection;
  const picks = state.heroes.filter(({ id }) => enemyIds.includes(id));
  get('profile-build-setup').hidden = false;
  get('profile-enemy-selection').hidden = !picks.length;
  get('profile-enemy-picks').innerHTML = picks.map(({ id, name, slug }) => `<li><button class="profile-enemy-pick" type="button" data-remove-enemy="${id}" aria-label="Remove ${escape(name)}">
    ${thumbnail('heroes', slug, 'portrait')}<span>${escape(name)}</span><span aria-hidden="true">×</span></button></li>`).join('');
  get('profile-enemy-help').textContent = picks.length ? `${picks.length} of ${enemyLimit} enemies selected.` : 'Choose up to five enemy heroes.';
  conditionSelect.disabled = false;
  conditionSelect.value = condition;
  enemyInput.disabled = enemyIds.length >= enemyLimit;
  renderConditionHints(profile);
}

function closeEnemySearch() {
  enemyResults.hidden = true;
  enemyInput.setAttribute('aria-expanded', 'false');
  enemyInput.removeAttribute('aria-activedescendant');
  state.activeEnemy = -1;
}

function searchEnemies() {
  const query = normalized(enemyInput.value);
  closeEnemySearch();
  if (!query || !state.heroes || enemyInput.disabled) return;
  const excluded = new Set([...state.selection.enemyIds, state.profile?.hero.id]);
  const matches = state.heroes.filter(({ id, name, slug }) => !excluded.has(id)
    && (normalized(name).includes(query) || normalized(slug).includes(query)));
  const suggestions = [...new Set([...matches.filter(({ name }) => normalized(name).startsWith(query)), ...matches])].slice(0, 8);
  enemyResults.innerHTML = suggestions.map(({ id, name, slug }) => `<li id="profile-enemy-option-${id}" role="option" aria-selected="false" data-enemy-id="${id}">
    ${thumbnail('heroes', slug, 'portrait')}<span>${escape(name)}</span></li>`).join('')
    || '<li role="option" aria-disabled="true">No matching enemies.</li>';
  enemyResults.hidden = false;
  enemyInput.setAttribute('aria-expanded', 'true');
}

function updateSelection(changes) {
  void loadProfile({ ...state.selection, ...changes }, 'pushState');
}

function addEnemy(option) {
  if (!option || enemyInput.disabled) return;
  const id = Number(option.dataset.enemyId);
  if (id === state.profile?.hero.id || state.selection.enemyIds.includes(id)) return;
  enemyInput.value = '';
  closeEnemySearch();
  updateSelection({ enemyIds: [...state.selection.enemyIds, id] });
  if (enemyInput.disabled) conditionSelect.focus({ preventScroll: true });
  else enemyInput.focus({ preventScroll: true });
}

function renderRoleList(roles) {
  get('profile-roles').innerHTML = roles.map((role) => `<button type="button" class="profile-role" data-role="${escape(role.key)}" aria-controls="profile-farm" aria-pressed="false">
    <span class="profile-role-name">${escape(role.label)}</span><span class="profile-role-rank${role.rank === null ? ' profile-role-unranked' : ''}">${role.rank === null ? 'Unranked' : `#${count(role.rank)}`}</span></button>`).join('');
}

function renderRole(profile) {
  const active = profile.roles.find(({ key }) => key === profile.role);
  if (!active) return;
  for (const button of get('profile-roles').querySelectorAll('[data-role]')) {
    button.setAttribute('aria-pressed', String(button.dataset.role === active.key));
  }
  const sample = profile.roleReplayMatches;
  const replays = Number.isFinite(active.replayPicks) && Number.isFinite(sample)
    ? ` ${count(active.replayPicks)} ${noun(active.replayPicks, 'pick')} in this position across ${count(sample)} replays with inferred roles.` : '';
  const positionScore = active.rank === null ? 'No top-20 rank.' : `Role score ${score.format(active.score)} / 100.`;
  const example = profile.roleBasis === 'example' ? ' This is an example role.' : '';
  get('profile-role-detail').innerHTML = `<p class="subtle"><strong>${escape(active.label)}</strong>. ${positionScore}${replays}${example}</p>
    ${active.summary ? `<p class="subtle">${escape(active.summary)}</p>` : ''}
    <div class="profile-role-actions"><a href="#profile-farm">View items for this role</a>
    <a href="/role-rankings?role=${encodeURIComponent(active.key)}">See all ${escape(active.label.toLowerCase())} rankings</a></div>`;
}

function matchupTable(rows, label) {
  if (!rows.length) return '';
  return `<table class="profile-matchup-table" aria-label="${label}">
    <thead><tr><th scope="col">Opponent</th><th scope="col">Adjusted lift</th><th scope="col">Games</th></tr></thead>
    <tbody>${rows.map((row) => `<tr><th class="profile-matchup-hero" scope="row"><a class="profile-opponent" href="${heroPath(row.enemySlug)}">
      ${thumbnail('heroes', row.enemySlug, 'portrait')}<span>${escape(row.enemyName)}</span></a></th>
      <td class="${row.delta > 0 ? 'positive' : 'negative'}">${signed.format(row.delta * 100)} pp</td>
      <td>${count(row.games)}<p class="subtle">${rate(row.winRate)} won</p></td></tr>`).join('')}</tbody></table>`;
}

function renderMatchups({ favorable, difficult, coverage, minGames, minComparisonGames }) {
  const heroGames = coverage?.heroGames ?? 0;
  const baseline = Number.isFinite(coverage?.heroWinRate) ? `, ${rate(coverage.heroWinRate)} won` : '';
  get('profile-matchup-context').textContent = `${count(heroGames)} Legend ${noun(heroGames, 'match', 'matches')} across all positions${baseline}.`;
  const fallback = heroGames
    ? `No favorable opponents met the evidence threshold of ${count(minGames)} games against and ${count(minComparisonGames)} comparison games.`
    : 'No Legend matches with usable team data were recorded for this hero.';
  get('profile-matchups').innerHTML = matchupTable(favorable, 'Favorable opponents')
    || `<p class="profile-empty">${fallback}</p>`;
  const harder = difficult.length ? `<details class="reading-note profile-method"><summary>Tougher matchups <span aria-hidden="true">+</span></summary>
    ${matchupTable(difficult, 'Tougher opponents')}</details>` : '';
  get('profile-matchups').insertAdjacentHTML('beforeend', harder);
  get('profile-matchup-method').hidden = false;
  get('profile-matchup-notes').innerHTML = `<p>Lift compares adjusted win rates against that opponent and in the hero’s other matches. Smaller samples have less influence on the estimate. Lift is in percentage points (pp). Drafts, lanes, and player choices can affect these results.</p>
    <p>Minimum of ${count(minGames)} games against each opponent and ${count(minComparisonGames)} comparison games. The Legend match snapshot contains ${count(coverage?.teamMatches)} matches with usable team data.</p>`;
}

function planItems(items, { later = false, ordered = true } = {}) {
  const element = ordered ? 'ol' : 'ul';
  return `<${element} class="profile-scenario-items">${items.map((item) => `<li${item.conditionItem ? ' class="profile-counter-item"' : ''}>${thumbnail('items', item.key, 'item-icon')}<div><strong>${escape(item.name)}</strong>
    <p class="subtle">${gold(item.cost)}${later && Number.isFinite(item.cumulativeCost) ? ` (${gold(item.cumulativeCost)} total)` : ''}</p></div></li>`).join('')}</${element}>`;
}

function conditionChange(change) {
  if (!change?.item) return '';
  const item = escape(change.item.name);
  const action = change.replaces ? `Swap ${escape(change.replaces.name)} for ${item}.`
    : change.action === 'advanced' ? `Buy ${item} earlier.`
      : change.action === 'kept' ? `Keep ${item} in the plan.` : `Add ${item}.`;
  const upgrade = change.deferredItem && !change.note?.includes(change.deferredItem.name)
    ? ` Save for ${escape(change.deferredItem.name)} when you have more gold.` : '';
  return `<p class="subtle profile-scenario-value profile-condition-change"><b>${action}</b>${change.note ? ` ${escape(change.note)}` : ''}${upgrade}</p>`;
}

function scenarioMarkup(scenario, type) {
  const items = scenario.items ?? [];
  const hasBudget = Number.isFinite(scenario.budget);
  const isModel = type === 'right-click-model';
  const now = items.filter(({ affordable }) => affordable !== false);
  const later = items.filter(({ affordable }) => affordable === false);
  const empty = hasBudget ? 'No suggested purchases fit this budget.' : 'No modeled item budget for this role.';
  const nextPurchases = later.length ? `<details class="profile-next-purchases">
    <summary>Next purchases (${later.length})</summary>${planItems(later, { later: true })}</details>` : '';
  const dps = isModel && Number.isFinite(scenario.dps)
    ? `<p class="subtle profile-scenario-value"><strong>${count(scenario.dps)} DPS</strong> with this build</p>` : '';
  return `<article class="profile-scenario">
    <h3>${escape(farmLabels[scenario.key] ?? scenario.label)}</h3><p class="profile-scenario-budget">${gold(scenario.budget)}</p>
    ${Number.isFinite(scenario.gpm) ? `<p class="subtle">${count(scenario.gpm)} gold per minute</p>` : ''}
    ${now.length ? planItems(now, { ordered: !isModel }) : `<p class="subtle">${empty}</p>`}${nextPurchases}
    ${conditionChange(scenario.change)}
    ${!scenario.change && scenario.note ? `<p class="subtle profile-scenario-value">${escape(scenario.note)}</p>` : ''}${dps}
  </article>`;
}

function observedPurchases(observed) {
  if (!observed?.items?.length) return '';
  return `<details class="profile-observed"><summary>Items bought in Legend replays</summary>
    <p class="subtle">By minute ${count(observed.targetMinute)} in ${count(observed.sampleSize)} replays for this hero and role, across all farm levels.</p>
    <ul class="profile-scenario-items">${observed.items.map((item) => `<li>${thumbnail('items', item.key, 'item-icon')}<div>
      <strong>${escape(item.name)}</strong><p class="subtle">${count(item.games)} of ${count(observed.sampleSize)} games</p></div></li>`).join('')}</ul>
  </details>`;
}

function renderFarm(profile) {
  const { farm, hero } = profile;
  const active = profile.roles.find(({ key }) => key === profile.role);
  const content = get('profile-farm-content');
  const method = get('profile-farm-method');
  const context = get('profile-farm-context');
  context.textContent = active?.label ?? '';
  method.hidden = !farm;
  if (!farm) {
    content.innerHTML = '<p class="profile-empty">No farm plan is available for this hero and role.</p>';
    return;
  }
  if (Number.isFinite(farm.targetMinute)) context.textContent += ` at minute ${farm.targetMinute}`;
  const typeLabel = farmTypes[farm.type] ?? farm.label;
  const projection = farm.scenarios?.find(({ budget }) => Number.isFinite(budget));
  const caveat = projection ? sampleBases[projection.basis] : null;
  const sample = caveat ? `${caveat}, based on ${count(projection.sampleSize)} role ${noun(projection.sampleSize, 'sample')}.` : '';
  const role = encodeURIComponent(profile.role);
  const details = `/gpm-builds?role=${role}&targetMinute=${encodeURIComponent(farm.targetMinute)}&reserveGold=${encodeURIComponent(farm.reserveGold)}`;
  const isImpact = ['offlane', 'soft-support', 'hard-support'].includes(profile.role);
  const draft = new URLSearchParams({ role: profile.role, hero: hero.id });
  if (isImpact) draft.set('arm', 'impact');
  if (profile.activeCondition) draft.set('condition', profile.activeCondition);
  for (const enemy of profile.enemyIds ?? []) draft.append('enemy', enemy);
  const action = farm.type === 'curated'
    ? `<a href="/draft-guide?${escape(draft)}">Open in Draft guide</a>`
    : `<a href="/efficiency?heroId=${encodeURIComponent(hero.id)}">Test your own item build</a>`;
  const adjustment = farm.conditionSource === 'hero-specific' ? 'Hero-specific adjustment'
    : farm.conditionSource === 'role-based' ? 'General role adjustment' : '';
  content.innerHTML = `<p class="subtle profile-farm-source"><strong>${escape(typeLabel)}</strong>${farm.note ? ` <span>${escape(farm.note)}</span>` : ''}</p>
    ${adjustment ? `<p class="subtle profile-farm-source">${adjustment}</p>` : ''}
    <div class="profile-farm-grid">${(farm.scenarios ?? []).map((scenario) => scenarioMarkup(scenario, farm.type)).join('')}</div>
    ${observedPurchases(farm.observedPurchases)}
    <div class="profile-farm-links">${action}<a href="${details}">Change the farm budget</a></div>`;
  const model = farm.type === 'right-click-model'
    ? `<p>Damage per second uses sustained right-clicks at hero level ${count(farm.level)} against ${count(farm.targetArmor)} armor.</p>`
    : '';
  get('profile-farm-notes').innerHTML = `<p>Bad, good, and easy farm use the 25th, 50th, and 85th percentiles of Legend gold earnings for the role. Item budgets set aside ${gold(farm.reserveGold)} for other purchases.</p>
    ${sample ? `<p>${escape(sample)}</p>` : ''}${model}`;
}

function renderProfile(profile) {
  const { hero } = profile;
  if (!state.profile) {
    document.title = `${hero.name} | Dota 2 Analyzer`;
    get('profile-title').textContent = hero.name;
    get('profile-patch').textContent = `Patch ${profile.patch}`;
    const src = imagePath('heroes', hero.slug);
    if (src) {
      const image = get('profile-image');
      image.src = src;
      image.hidden = false;
    }
    get('hero-profile').hidden = false;
    renderRoleList(profile.roles);
    renderMatchups(profile.matchups);
  }
  renderRole(profile);
  renderFarm(profile);
}

async function loadProfile(selection = profileQuery(), historyAction = 'replaceState') {
  state.request?.abort();
  const request = new AbortController();
  state.request = request;
  const previous = state.profile;
  state.selection = selection;
  const status = get(previous ? 'profile-role-status' : 'profile-status');
  status.textContent = previous ? 'Updating item builds…' : 'Loading hero profile…';
  get('profile-farm-content').setAttribute('aria-busy', 'true');
  get('profile-retry').hidden = true;
  get('profile-share').disabled = true;
  get('share-status').textContent = '';
  if (previous) renderDraftSelection();
  try {
    if (!currentSlug) throw Object.assign(new Error(), { status: 404 });
    const profile = await fetchJson(`/api/hero-profiles/${currentSlug}?${profileParams(selection)}`, request.signal);
    if (request.signal.aborted) return;
    renderProfile(profile);
    state.profile = profile;
    state.selection = profileSelection(profile);
    renderDraftSelection(profile);
    status.textContent = '';
    if (historyAction) history[historyAction](null, '', `${heroPath(profile.hero.slug)}?${profileParams(state.selection)}${location.hash}`);
  } catch (error) {
    if (request.signal.aborted) return;
    if (previous) {
      state.selection = profileSelection(previous);
      renderDraftSelection(previous);
      if (!historyAction) history.replaceState(null, '', `${heroPath(previous.hero.slug)}?${profileParams(state.selection)}${location.hash}`);
      status.textContent = 'Could not update the item builds. Try that selection again.';
    } else if (error.status === 404) {
      status.textContent = 'This hero was not found. Find a hero above or browse all heroes.';
    } else {
      status.textContent = 'Could not load this hero. Try again.';
      get('profile-retry').hidden = false;
    }
  } finally {
    if (!request.signal.aborted) {
      get('profile-farm-content').setAttribute('aria-busy', 'false');
      get('profile-share').disabled = !state.profile;
    }
  }
}

const search = get('profile-search');
search.addEventListener('input', searchHeroes);
search.addEventListener('focus', searchHeroes);
get('hero-search-panel').addEventListener('keydown', (event) => {
  const results = get('hero-search-results');
  if (results.hidden) return;
  if (event.key === 'Escape' && event.target !== search) {
    search.focus();
  }
  if (event.key === 'Escape') results.hidden = true;
  if (event.key === 'ArrowDown' && event.target === search && results.querySelector('a')) {
    event.preventDefault();
    results.querySelector('a').focus();
  }
});
get('hero-search-panel').addEventListener('focusout', (event) => {
  if (!event.currentTarget.contains(event.relatedTarget)) get('hero-search-results').hidden = true;
});

get('profile-roles').addEventListener('click', (event) => {
  const button = event.target.closest('[data-role]');
  if (button && button.dataset.role !== state.selection?.role) updateSelection({ role: button.dataset.role });
});

window.addEventListener('popstate', () => {
  const selection = profileQuery();
  if (!isDirectory && (!state.selection || String(profileParams(selection)) !== String(profileParams(state.selection)))) {
    void loadProfile(selection, null);
  }
});

enemyInput.addEventListener('input', searchEnemies);
enemyInput.addEventListener('focus', searchEnemies);
enemyInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !enemyResults.hidden) {
    event.preventDefault();
    closeEnemySearch();
  }
  if (event.key === 'Enter' && !enemyResults.hidden) {
    event.preventDefault();
    const choices = enemyResults.querySelectorAll('[data-enemy-id]');
    const choice = state.activeEnemy >= 0 ? choices[state.activeEnemy] : choices.length === 1 ? choices[0] : null;
    addEnemy(choice);
  }
  if (enemyInput.value && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    if (enemyResults.hidden) searchEnemies();
    const choices = enemyResults.querySelectorAll('[data-enemy-id]');
    if (!choices.length) return;
    event.preventDefault();
    const next = event.key === 'ArrowDown' ? 1 : -1;
    state.activeEnemy = state.activeEnemy < 0 ? (next > 0 ? 0 : choices.length - 1)
      : (state.activeEnemy + next + choices.length) % choices.length;
    const choice = choices[state.activeEnemy];
    for (const option of choices) option.setAttribute('aria-selected', String(option === choice));
    enemyInput.setAttribute('aria-activedescendant', choice.id);
    choice.scrollIntoView({ block: 'nearest' });
  }
});
enemyResults.addEventListener('pointerdown', (event) => {
  if (event.target.closest('[data-enemy-id]')) event.preventDefault();
});
enemyResults.addEventListener('click', (event) => addEnemy(event.target.closest('[data-enemy-id]')));
for (const eventName of ['focusin', 'pointerdown']) {
  document.addEventListener(eventName, (event) => {
    if (!get('profile-enemy-panel').contains(event.target)) closeEnemySearch();
  });
}

get('profile-enemy-picks').addEventListener('click', (event) => {
  const pick = event.target.closest('[data-remove-enemy]');
  if (!pick) return;
  updateSelection({ enemyIds: state.selection.enemyIds.filter((id) => id !== Number(pick.dataset.removeEnemy)) });
  enemyInput.focus({ preventScroll: true });
});
get('profile-enemy-clear').addEventListener('click', () => {
  updateSelection({ enemyIds: [] });
  enemyInput.focus({ preventScroll: true });
});
conditionSelect.addEventListener('change', () => updateSelection({ condition: conditionSelect.value }));
get('profile-condition-hints').addEventListener('click', (event) => {
  const hint = event.target.closest('[data-condition-hint]');
  if (!hint || hint.dataset.conditionHint === state.selection.condition) return;
  conditionSelect.focus({ preventScroll: true });
  updateSelection({ condition: hint.dataset.conditionHint });
});

get('profile-share').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    get('share-status').textContent = 'Hero link copied.';
  } catch {
    get('share-status').textContent = 'Copy the link from your address bar.';
  }
});

document.addEventListener('error', (event) => {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true;
}, true);

function start() {
  get('profile-retry').hidden = true;
  get('profile-status').textContent = isDirectory ? 'Loading heroes…' : 'Loading hero profile…';
  get('profile-back').hidden = isDirectory;
  get('profile-directory-heading').hidden = !isDirectory;
  get('hero-search-panel').hidden = false;
  void loadDirectory().catch(() => {
    if (isDirectory) {
      get('profile-status').textContent = 'Could not load the hero list. Try again.';
      get('profile-retry').hidden = false;
    } else {
      get('hero-search-panel').hidden = true;
    }
  });
  if (!isDirectory) void loadProfile();
}

get('profile-retry').addEventListener('click', start);
start();
