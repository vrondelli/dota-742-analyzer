const $ = (id) => document.getElementById(id)
const form = $('draft-form')
const heroInput = $('draft-hero-input')
const roster = $('draft-roster')
const pickGroups = { enemy: 'Enemy', ally: 'Ally', blocked: 'Banned' }
const pickLimits = { enemy: 5, ally: 4 }
const state = { meta: null, result: null, selected: null, pending: null, suggestions: [], activeSuggestion: -1, picks: { enemy: [], ally: [], blocked: [] } }
const numbers = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
  ))
}

function number(value) { return Number.isFinite(value) ? numbers.format(value) : '—' }
function gold(value) { return `${number(value)}g` }
function percent(value) { return value === null ? '—' : `${number(value * 100)}%` }
function lift(value) { return value === null ? '—' : `${value > 0 ? '+' : ''}${number(value * 100)} pp` }

function thumbnail(kind, key) {
  const slug = key.replace(/^npc_dota_hero_/, '')
  if (!/^[a-z0-9_]+$/.test(slug)) return ''
  const [className, ext] = kind === 'heroes' ? ['portrait', 'jpg'] : ['item-icon', 'png']
  return `<span class="${className}" aria-hidden="true"><img src="/assets/${kind}/${slug}.${ext}" alt="" loading="lazy" decoding="async"></span>`
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal })
  if (response.ok) return response.json()
  const problem = await response.json().catch(() => null)
  throw new Error(problem?.error ?? 'The guide could not be loaded.')
}

function renderPicks() {
  $('draft-picks').innerHTML = Object.entries(state.picks).map(([group, ids]) => ids.length ? `<section>
    <span>${pickGroups[group]}</span>${ids.map((id) => {
      const name = state.heroes.get(id).name
      return `<button type="button" class="draft-chip" data-group="${group}" data-hero="${id}" aria-label="Remove ${escape(name)} from ${pickGroups[group].toLowerCase()} picks">${escape(name)} <span aria-hidden="true">×</span></button>`
    }).join('')}</section>` : '').join('')
  $('draft-clear').hidden = !Object.values(state.picks).some((ids) => ids.length)
}

function heroQuery(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function closeSuggestions() {
  roster.hidden = true
  heroInput.setAttribute('aria-expanded', 'false')
  heroInput.removeAttribute('aria-activedescendant')
  state.activeSuggestion = -1
}

function renderSuggestions() {
  const query = heroQuery(heroInput.value)
  if (!state.meta || !query) { closeSuggestions(); return }
  const unavailable = new Set(Object.values(state.picks).flat())
  const available = state.meta.heroes.filter(({ id }) => !unavailable.has(id))
  const matches = available.filter(({ name }) => heroQuery(name).includes(query))
  const prefixes = matches.filter(({ name }) => heroQuery(name).startsWith(query))
  state.suggestions = [...new Set([...prefixes, ...matches])].slice(0, 8)
  state.activeSuggestion = -1
  heroInput.removeAttribute('aria-activedescendant')
  heroInput.setAttribute('aria-expanded', 'true')
  roster.hidden = false
  roster.innerHTML = state.suggestions.map((hero) => `<li id="draft-option-${hero.id}" role="option" data-hero="${hero.id}" aria-selected="false">
    ${thumbnail('heroes', hero.key)}<span>${escape(hero.name)}</span></li>`).join('') ||
    '<li class="draft-no-match" role="option" aria-disabled="true">No available heroes match.</li>'
}

function moveSuggestion(direction) {
  if (roster.hidden) renderSuggestions()
  const count = state.suggestions.length
  if (roster.hidden || !count) return
  state.activeSuggestion = state.activeSuggestion === -1 ? (direction > 0 ? 0 : count - 1)
    : (state.activeSuggestion + direction + count) % count
  const option = $(`draft-option-${state.suggestions[state.activeSuggestion].id}`)
  heroInput.setAttribute('aria-activedescendant', option.id)
  for (const item of roster.querySelectorAll('[data-hero]')) item.setAttribute('aria-selected', String(item === option))
  option.scrollIntoView({ block: 'nearest' })
}

function addPick(id) {
  if (!state.meta) return
  const status = $('draft-pick-status')
  const group = $('draft-side').value
  const query = heroQuery(heroInput.value)
  const hero = state.heroes.get(id) ?? state.meta.heroes.find(({ name }) => heroQuery(name) === query)
    ?? (query && state.suggestions.length === 1 ? state.suggestions[0] : null)
  if (!hero) { status.textContent = 'Type a hero name and choose a match.'; return }
  if (Object.values(state.picks).some((ids) => ids.includes(hero.id))) {
    status.textContent = `${hero.name} is already marked.`
    return
  }
  if (state.picks[group].length >= (pickLimits[group] ?? Infinity)) {
    status.textContent = `Add up to ${pickLimits[group]} ${pickGroups[group].toLowerCase()} picks.`
    return
  }
  state.picks[group].push(hero.id)
  heroInput.value = ''
  closeSuggestions()
  status.textContent = `${hero.name} added as ${group === 'blocked' ? 'banned' : pickGroups[group].toLowerCase()}.`
  renderPicks()
  void loadGuide()
}

function renderShortlist() {
  const { rows, options } = state.result
  $('draft-heroes').innerHTML = rows.map((row) => {
    const { hero, plan, rolePicks, matchupDelta } = row
    const evidence = rolePicks ? `${number(rolePicks)} ${rolePicks === 1 ? 'replay pick' : 'replay picks'} in role` : 'No replay picks in role'
    const pairCount = row.matchups.filter(({ games }) => games).length
    const signal = options.enemyIds.length
      ? pairCount ? `<small>${lift(matchupDelta)} vs. usual (${pairCount}/${options.enemyIds.length} enemies sampled)</small>`
        : '<small>No enemy matchup results</small>' : ''
    const profile = row.impact ? `${number(row.impact.score)}/100 role fit` : plan.profile === 'blind' ? 'Opening option' : 'Matchup pick'
    return `<button type="button" class="draft-hero" data-hero="${hero.id}" aria-pressed="${hero.id === state.selected}" aria-controls="draft-detail">
      ${thumbnail('heroes', hero.key)}<span><strong>${escape(hero.name)}</strong><small>${profile}</small><small>${evidence}</small>${signal}</span>
    </button>`
  }).join('')
}

function milestoneMarkup(milestone) {
  if (!milestone?.name) return ''
  const { name, replaced, cumulativeCost, affordable, shortfall, reason } = milestone
  const result = replaced ? `Replaced by ${replaced} in this path.` : affordable === null
    ? `${gold(cumulativeCost)} total. Budget unavailable.` : affordable
      ? `${gold(cumulativeCost)} total, within budget.` : `${gold(shortfall)} short of the ${gold(cumulativeCost)} total.`
  return `<p class="draft-milestone${affordable === false || replaced ? ' is-short' : ''}"><strong>Key item</strong> ${escape(name)}
    <small>${escape(result)}${!replaced && reason ? ` ${escape(reason)}` : ''}</small></p>`
}

function buildCard(build, minute, milestone) {
  const firstLater = build.steps.findIndex(({ affordable }) => affordable === false)
  const through = firstLater < 0 ? build.steps : build.steps.slice(0, firstLater)
  const last = through.at(-1)
  const next = build.steps[firstLater]
  const affordable = build.budget !== null
  const budget = affordable ? gold(build.budget) : '—'
  const timing = !affordable ? 'Budget estimate unavailable'
    : last ? `Buy through <strong>${escape(last.name)}</strong> by minute ${number(minute)}`
      : `First item exceeds the minute ${number(minute)} budget`
  const { change } = build
  const changed = change && ({
    kept: `Keep ${change.item.name} in place.`,
    advanced: `Buy ${change.item.name} earlier.`,
    replaced: `${change.item.name} replaces ${change.replaces?.name}.`,
    inserted: `Prioritize ${change.item.name} after the opening purchases.`,
  })[change.action]
  const renderSteps = (steps) => steps.map((step) => `<li class="${step.affordable === false ? 'draft-step-later' : ''}${step.conditionItem ? ' draft-step-condition' : ''}">
    <span class="draft-step-line">${thumbnail('items', step.key)}<span>${escape(step.name)}</span></span>
    <small>${gold(step.cost)}, ${gold(step.cumulativeCost)} total</small></li>`).join('')
  const upcoming = next ? `<details class="draft-later">
    <summary>${escape(next.name)} next <span>${gold(next.cumulativeCost - build.budget)} short</span></summary>
    <ol start="${firstLater + 1}">${renderSteps(build.steps.slice(firstLater))}</ol>
    </details>` : ''
  return `<article class="draft-build">
    <div class="draft-build-head"><h3>${escape(build.label)}</h3><p class="draft-budget">${budget}</p></div>
    ${affordable ? `<p class="draft-farm-rate">${number(build.gpm)} gold per minute</p>` : ''}
    <p class="draft-timing">${timing}</p>
    ${change ? `<p class="draft-build-note draft-change"><strong>${escape(changed)}</strong> ${escape(change.note)}</p>` : `<p class="draft-build-note">${escape(build.note)}</p>`}
    ${milestoneMarkup(milestone)}
    ${through.length ? `<ol>${renderSteps(through)}</ol>` : ''}
    ${upcoming}
    </article>`
}

function renderImpactRubric() {
  const panel = $('draft-impact-rubric')
  const { impact, role } = state.result
  panel.hidden = !impact
  if (!impact) return
  const scales = impact.ratingLabels.map((label, index) => `${index} ${escape(label.toLowerCase())}`).join(', ')
  panel.innerHTML = `<div class="draft-section-head"><h2 id="impact-rubric-title">${escape(role.label)} scoring criteria</h2>
    <p>${escape(impact.headline)}</p></div>
    <ul class="draft-rubric-criteria">${impact.criteria.map(({ label, weight, defaultWeight, description }) => `<li>
      <strong>${escape(label)}</strong><small>${number(weight)}% weight${impact.priority ? ` (default ${number(defaultWeight)}%)` : ''}</small>
      <p>${escape(description)}</p></li>`).join('')}</ul>
    <p class="draft-rubric-rating">Ability ratings are ${scales}.</p>`
}

function impactRatings(impact) {
  if (!impact) return ''
  const rows = impact.ratings.map(({ label, value, reason }) => `<tr><th scope="row">${escape(label)}</th>
    <td>${number(value)} / 3</td><td>${escape(reason)}</td></tr>`).join('')
  const info = impact.sources.map((source) => typeof source === 'string' ? { label: 'Valve hero data', url: source } : source)
    .filter(({ url }) => typeof url === 'string' && url.startsWith('https://www.dota2.com/'))
    .map(({ url, label }) => `<a class="text-link" href="${escape(url)}" target="_blank" rel="noreferrer">${escape(label)}</a>`).join(', ')
  return `<section class="draft-ratings" aria-labelledby="draft-ratings-title">
    <h3 id="draft-ratings-title">Role fit (${number(impact.score)}/100)</h3>
    <div class="scroll-table" tabindex="0" role="region" aria-labelledby="draft-ratings-title"><table>
    <thead><tr><th scope="col">Criterion</th><th scope="col">Rating</th><th scope="col">Ability evidence</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${info ? `<p>${info}</p>` : ''}</section>`
}

function matchupSection(row) {
  const { allRole, matchups } = row
  const baseline = allRole.games ? `${percent(allRole.winRate)} across all positions (${number(allRole.wins)} wins in ${number(allRole.games)} games).` : 'No all-position matches for this hero.'
  const roleEvidence = row.rolePicks ? `${number(row.rolePicks)} replay ${row.rolePicks === 1 ? 'pick' : 'picks'} in this inferred role.`
    : 'No replay picks in this role.'
  const pairs = matchups.map((m) => `<tr><th scope="row">${escape(m.enemyName)}</th>
    <td>${number(m.wins)} / ${number(m.games)}</td><td>${number(m.roleGames)}</td><td>${lift(m.delta)}</td></tr>`).join('')
  return `<section aria-labelledby="draft-matchups-title"><h3 id="draft-matchups-title">Observed match results</h3><p>${baseline}</p><p>${roleEvidence}</p>
    ${pairs ? `<div class="scroll-table" tabindex="0" role="region" aria-labelledby="draft-matchups-title"><table>
    <thead><tr><th scope="col">Enemy</th><th scope="col">Wins / games</th><th scope="col">Games in role</th><th scope="col">Vs. usual</th></tr></thead><tbody>${pairs}</tbody></table></div>
    <p>“Vs. usual” is a percentage-point difference from this hero’s normal results. Pairs with fewer matches move less.</p>`
      : '<p>Add an enemy hero to see the matchup counts.</p>'}</section>`
}

function tacticalNotes({ plan }) {
  const enemies = new Set(state.result.options.enemyIds)
  const relations = [...(plan.goodAgainst ?? []).map((entry) => ({ ...entry, label: 'Opportunity' })),
    ...(plan.avoidAgainst ?? []).map((entry) => ({ ...entry, label: 'Risk' }))].filter(({ heroId }) => enemies.has(heroId))
  const examples = relations.map(({ heroId, label, note }) => `<li><strong>${escape(label)} vs ${escape(state.heroes.get(heroId).name)}</strong>. ${escape(note)}</li>`)
  const practical = [...(plan.strengths ?? []).map((line) => `<li>${escape(line)}</li>`), ...examples,
    ...(plan.watchFor ?? []).map((line) => `<li>${escape(line)}</li>`)]
  return `<section><h3>Draft considerations</h3>
    ${practical.length ? `<ul>${practical.join('')}</ul>` : ''}</section>`
}

function renderDetail() {
  const row = state.result.rows.find(({ hero }) => hero.id === state.selected)
  $('draft-detail').hidden = !row
  if (!row) return
  const { plan, hero } = row
  const { farm, economy, condition } = state.result
  const uncovered = condition && !plan.conditionSupported
    ? '<p>This condition uses the default purchase order.</p>' : ''
  const source = economy.basis === 'gold-timeline' ? 'replay gold timelines' : 'whole-match gold rates'
  const n = economy.scenarios[0]?.sampleSize
  const tactics = plan.swaps.filter(({ trigger }) => trigger !== condition).map(({ trigger, label, item }) =>
    `<button class="draft-hint" type="button" data-condition="${escape(trigger)}">${escape(label)}<small>${escape(item.name)}</small></button>`).join('')
  const slug = hero.key.replace(/^npc_dota_hero_/, '')
  $('draft-builds').innerHTML = `<div class="draft-detail-head">
    <h2 id="draft-detail-title">${escape(hero.name)} purchase order</h2><p>${escape(plan.pickNote)}</p>${uncovered}
    <a class="text-link" href="/hero/${encodeURIComponent(slug)}?role=${escape(state.result.role.key)}">${escape(hero.name)} hero guide</a></div>
    <div class="draft-plan-context">
      <p><strong>Minute ${number(farm.targetMinute)} item budgets</strong> (${gold(farm.reserveGold)} set aside)</p>
      <p>${n ? `Estimated from ${number(n)} observations of ${source}. ` : 'Economy data unavailable. '}<a class="text-link" href="/gpm-builds?role=${escape(state.result.role.key)}">Farm budgets</a></p>
    </div>
    <div class="draft-builds">${plan.builds.map((build) => buildCard(build, farm.targetMinute, row.impact?.milestones[build.key])).join('')}</div>
    ${impactRatings(row.impact)}
    <div class="draft-evidence">${tacticalNotes(row)}${matchupSection(row)}</div>
    ${tactics ? `<div class="draft-evidence"><section><h3>Try another condition</h3><div class="draft-hints">${tactics}</div></section></div>` : ''}`
}

function renderGuide() {
  const { stage, rows, coverage, conditionHints, assumptions, provenance, fetchedAt, impact } = state.result
  $('draft-coverage').hidden = false
  $('draft-matches').textContent = number(coverage.teamMatches)
  $('draft-replays').textContent = number(coverage.roleMatches)
  for (const phase of document.querySelectorAll('[data-phase]')) {
    if (phase.dataset.phase === stage.key) phase.setAttribute('aria-current', 'step')
    else phase.removeAttribute('aria-current')
  }
  $('draft-stage-note').textContent = `${stage.label}. ${stage.advice}`
  $('draft-hints').innerHTML = conditionHints.length ? `<p>Build options against these enemies</p>${conditionHints.map(({ key, label, enemies }) => `
    <button class="draft-hint" type="button" data-condition="${escape(key)}" aria-pressed="${key === state.result.condition}">
      ${escape(label)} <small>${enemies.map(escape).join(', ')}</small></button>`).join('')}` : ''
  if (!rows.some(({ hero }) => hero.id === state.selected)) {
    const opening = !impact && stage.key === 'blind' && rows.find(({ plan, rolePicks }) => plan.profile === 'blind' && rolePicks > 0)
    state.selected = (opening || rows[0])?.hero.id ?? null
  }
  $('draft-status').textContent = rows.length ? '' : 'No available heroes in this role’s guide. Remove a pick or choose another role.'
  $('draft-method').innerHTML = `<ul>${[...assumptions, provenance.method, provenance.reportBaseline,
    ...(impact ? ['The role fit score is a curated weighted average of the 0–3 ability ratings on a 0–100 scale. Giving a team need priority doubles its weight, then rescales all weights to total 100%. The draft score breaks ties.'] : []),
    'Farm budgets use the 25th, 50th and 85th percentiles of this role’s gold through the chosen minute. Costs start from an empty inventory after the reserve. Each row prices a completed purchase.',
    'A game condition applies one curated purchase change. Enemy hero hints suggest what to check in the match. Patch membership is inferred from match start time in the current snapshot.',
  ].map((line) => `<li>${escape(line)}</li>`).join('')}</ul>
  <p><a class="text-link" href="https://www.dota2.com/patches/7.27">Valve All Pick rules</a> and <a class="text-link" href="${escape(provenance.patchUrl)}">Valve 7.42 patch notes</a></p>`
  if (fetchedAt) $('draft-snapshot').textContent = `OpenDota snapshot from ${new Date(fetchedAt).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })} São Paulo`
  renderImpactRubric()
  renderShortlist()
  renderDetail()
}

function syncGuideLink(query = new URLSearchParams(location.search)) {
  if (state.selected === null) query.delete('hero')
  else query.set('hero', state.selected)
  history.replaceState(null, '', `/draft-guide?${query}`)
  const standard = new URLSearchParams(query)
  standard.delete('arm')
  standard.delete('priority')
  $('draft-arm-standard').href = `/draft-guide?${standard}`
  const impact = new URLSearchParams(query)
  impact.set('arm', 'impact')
  if (!['offlane', 'soft-support', 'hard-support'].includes(impact.get('role'))) {
    impact.set('role', 'offlane')
    impact.delete('hero')
  }
  $('draft-arm-impact').href = `/draft-guide?${impact}`
}

function populatePriorities(preferred = '') {
  if (state.meta.arm !== 'impact') return
  const role = state.meta.roles.find(({ key }) => key === $('draft-role').value)
  const priority = $('draft-priority')
  priority.replaceChildren(new Option('Use default role weights', ''), ...role.criteria.map(({ key, label }) => new Option(label, key)))
  if (role.criteria.some(({ key }) => key === preferred)) priority.value = preferred
}

async function loadGuide() {
  if (!state.meta || !form.reportValidity()) return
  state.pending?.abort()
  const request = new AbortController()
  state.pending = request
  const query = new URLSearchParams(new FormData(form))
  for (const [group, ids] of Object.entries(state.picks)) for (const id of ids) query.append(group, id)
  $('draft-output').setAttribute('aria-busy', 'true')
  $('draft-status').textContent = 'Checking matchups and budgets…'
  $('draft-share').disabled = true
  $('draft-share-status').textContent = ''
  try {
    const result = await fetchJson(`/api/draft-guide?${query}`, request.signal)
    if (request.signal.aborted) return
    state.result = result
    renderGuide()
    syncGuideLink(query)
    $('draft-share').disabled = false
  } catch (error) {
    if (!request.signal.aborted) $('draft-status').textContent = error.message
  } finally {
    if (!request.signal.aborted) $('draft-output').setAttribute('aria-busy', 'false')
  }
}

async function start() {
  try {
    const query = new URLSearchParams(location.search)
    const isImpact = query.get('arm') === 'impact'
    state.meta = await fetchJson(`/api/draft-guide/meta${isImpact ? '?arm=impact' : ''}`)
    state.heroes = new Map(state.meta.heroes.map((hero) => [hero.id, hero]))
    $('draft-arm').value = state.meta.arm
    if (isImpact) {
      document.title = 'Offlane and support fit | Dota 2 Analyzer'
      $('draft-title').textContent = 'Offlane and support fit'
      $('draft-arm-standard').removeAttribute('aria-current')
      $('draft-arm-impact').setAttribute('aria-current', 'page')
      $('draft-priority-controls').hidden = false
      $('draft-priority').disabled = false
    }
    $('draft-role').replaceChildren(...state.meta.roles.map(({ key, label }) => new Option(label, key)))
    $('draft-condition').append(...state.meta.conditions.map(({ key, label }) => new Option(label, key)))
    for (const [key, fallback] of Object.entries(state.meta.defaults)) {
      const input = form.elements.namedItem(key)
      input.value = query.get(key) ?? fallback
      if (!input.checkValidity()) input.value = fallback
    }
    populatePriorities(query.get('priority'))
    const condition = query.get('condition')
    if (state.meta.conditions.some(({ key }) => condition === key)) $('draft-condition').value = condition
    const heroId = Number(query.get('hero'))
    if (state.heroes.has(heroId)) state.selected = heroId
    const selected = new Set()
    for (const group of Object.keys(state.picks)) {
      for (const id of query.getAll(group).map(Number)) {
        if (!state.heroes.has(id) || selected.has(id) || state.picks[group].length >= (pickLimits[group] ?? Infinity)) continue
        state.picks[group].push(id)
        selected.add(id)
      }
    }
    renderPicks()
    $('draft-update').disabled = false
    await loadGuide()
  } catch (error) {
    $('draft-status').textContent = error.message
    $('draft-output').setAttribute('aria-busy', 'false')
  }
}

form.addEventListener('submit', (event) => { event.preventDefault(); void loadGuide() })
$('draft-role').addEventListener('change', () => { state.selected = null; populatePriorities(); void loadGuide() })
$('draft-priority').addEventListener('change', () => { state.selected = null; void loadGuide() })
$('draft-condition').addEventListener('change', loadGuide)
$('draft-add').addEventListener('click', () => addPick())
heroInput.addEventListener('input', renderSuggestions)
heroInput.addEventListener('focus', renderSuggestions)
heroInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    addPick(state.suggestions[state.activeSuggestion]?.id)
  }
  if (event.key === 'Escape' && !roster.hidden) {
    event.preventDefault()
    closeSuggestions()
  }
  if (heroInput.value && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault()
    moveSuggestion(event.key === 'ArrowDown' ? 1 : -1)
  }
})
roster.addEventListener('pointerdown', (event) => {
  if (event.target.closest('[data-hero]')) event.preventDefault()
})
roster.addEventListener('click', (event) => {
  const option = event.target.closest('[data-hero]')
  if (option) addPick(Number(option.dataset.hero))
})
document.addEventListener('focusin', (event) => {
  if (!$('draft-search').contains(event.target)) closeSuggestions()
})
document.addEventListener('pointerdown', (event) => {
  if (!$('draft-search').contains(event.target)) closeSuggestions()
})
$('draft-clear').addEventListener('click', () => {
  for (const group of Object.keys(state.picks)) state.picks[group] = []
  $('draft-pick-status').textContent = 'Picks and bans cleared.'
  renderPicks()
  heroInput.focus()
  void loadGuide()
})
$('draft-share').addEventListener('click', async () => {
  const status = $('draft-share-status')
  try {
    await navigator.clipboard.writeText(location.href)
    status.textContent = 'Draft link copied.'
  } catch {
    status.textContent = 'Copy the current address to share this draft.'
  }
})
$('draft-picks').addEventListener('click', (event) => {
  const chip = event.target.closest('button[data-group]')
  if (!chip) return
  state.picks[chip.dataset.group] = state.picks[chip.dataset.group].filter((id) => id !== Number(chip.dataset.hero))
  $('draft-pick-status').textContent = ''
  renderPicks()
  heroInput.focus()
  void loadGuide()
})
$('draft-heroes').addEventListener('click', (event) => {
  const hero = event.target.closest('button[data-hero]')
  if (!hero) return
  state.selected = Number(hero.dataset.hero)
  for (const option of $('draft-heroes').querySelectorAll('button')) option.setAttribute('aria-pressed', String(option === hero))
  renderDetail()
  syncGuideLink()
})
for (const id of ['draft-hints', 'draft-builds']) $(id).addEventListener('click', (event) => {
  const hint = event.target.closest('button[data-condition]')
  if (!hint) return
  $('draft-condition').value = hint.dataset.condition
  $('draft-condition').focus({ preventScroll: true })
  void loadGuide()
})
document.addEventListener('error', (event) => {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true
}, true)

void start()
