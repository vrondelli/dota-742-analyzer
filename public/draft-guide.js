const $ = (id) => document.getElementById(id)
const form = $('draft-form')
const pickGroups = { enemy: 'Enemy', ally: 'Ally', blocked: 'Banned' }
const pickLimits = { enemy: 5, ally: 4 }
const state = { meta: null, result: null, selected: null, pending: null, picks: { enemy: [], ally: [], blocked: [] } }
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
  const seen = new Set(Object.values(state.picks).flat())
  $('draft-roster').replaceChildren(...state.meta.heroes.filter(({ id }) => !seen.has(id)).map(({ name }) => new Option(name)))
}

function addPick() {
  if (!state.meta) return
  const input = $('draft-hero-input')
  const status = $('draft-pick-status')
  const group = $('draft-side').value
  const label = input.value.trim().toLowerCase()
  const hero = state.meta.heroes.find(({ name }) => name.toLowerCase() === label)
  if (!hero) { status.textContent = 'Choose a hero from the roster.'; return }
  if (Object.values(state.picks).some((ids) => ids.includes(hero.id))) {
    status.textContent = `${hero.name} is already marked.`
    return
  }
  if (state.picks[group].length >= (pickLimits[group] ?? Infinity)) {
    status.textContent = `Add up to ${pickLimits[group]} ${pickGroups[group].toLowerCase()} picks.`
    return
  }
  state.picks[group].push(hero.id)
  input.value = ''
  status.textContent = ''
  renderPicks()
  void loadGuide()
}

function renderShortlist() {
  const { rows, options } = state.result
  $('draft-heroes').innerHTML = rows.map((row) => {
    const { hero, plan, rolePicks, matchupDelta } = row
    const evidence = rolePicks ? `${number(rolePicks)} role ${rolePicks === 1 ? 'pick' : 'picks'}` : 'Role hypothesis'
    const signal = options.enemyIds.length && row.matchups.some(({ games }) => games) ? ` · ${lift(matchupDelta)}` : ''
    const profile = row.impact ? `${number(row.impact.score)}/100 role fit` : plan.profile === 'blind' ? 'Opening option' : 'Matchup pick'
    return `<button type="button" class="draft-hero" data-hero="${hero.id}" aria-pressed="${hero.id === state.selected}">
      ${thumbnail('heroes', hero.key)}<span><strong>${escape(hero.name)}</strong><small>${evidence}${signal}</small><small>${profile}</small></span>
    </button>`
  }).join('')
}

function milestoneMarkup(milestone) {
  if (!milestone?.name) return ''
  const { name, replaced, cumulativeCost, affordable, shortfall, reason } = milestone
  const result = replaced ? `Replaced by ${replaced} in this path.` : affordable === null
    ? `${gold(cumulativeCost)} through this item · budget unavailable.` : affordable
      ? `${gold(cumulativeCost)} through this item · fits budget.` : `${gold(cumulativeCost)} through this item · ${gold(shortfall)} short.`
  return `<p class="draft-milestone${affordable === false || replaced ? ' is-short' : ''}"><strong>Role milestone · ${escape(name)}</strong>
    <small>${escape(result)}${!replaced && reason ? ` ${escape(reason)}` : ''}</small></p>`
}

function buildCard(build, minute, milestone) {
  const next = build.steps.find(({ affordable }) => affordable === false)
  const budget = build.budget === null ? 'Budget unavailable' : `${gold(build.budget)} budget · ${number(build.gpm)} GPM`
  const { change } = build
  const changed = change && ({
    kept: `Keep ${change.item.name} in place.`,
    advanced: `Buy ${change.item.name} earlier.`,
    replaced: `${change.item.name} replaces ${change.replaces?.name}.`,
    inserted: `Prioritize ${change.item.name} after the opening purchases.`,
  })[change.action]
  const pathway = build.steps.map((step) => `<li class="${step.affordable === false ? 'draft-step-later' : ''}${step.conditionItem ? ' draft-step-condition' : ''}">
    <span class="draft-step-line">${thumbnail('items', step.key)}<span>${escape(step.name)}</span></span>
    <small>${gold(step.cost)} · ${gold(step.cumulativeCost)} total${step.affordable === false ? ' · later' : ''}</small></li>`).join('')
  return `<article class="draft-build"><h3>${build.label}</h3><p class="draft-budget">${budget}</p>
    ${change ? `<p class="draft-build-note draft-change"><strong>${escape(changed)}</strong> ${escape(change.note)}</p>` : `<p class="draft-build-note">${escape(build.note)}</p>`}
    ${milestoneMarkup(milestone)}
    <ol>${pathway}</ol>${next ? `<p class="draft-next">At minute ${number(minute)}, ${gold(next.cumulativeCost - build.budget)} short of ${escape(next.name)}.</p>` : ''}</article>`
}

function renderImpactRubric() {
  const panel = $('draft-impact-rubric')
  const { impact, role } = state.result
  panel.hidden = !impact
  if (!impact) return
  const scales = impact.ratingLabels.map((label, index) => `${index} ${escape(label.toLowerCase())}`).join(' · ')
  panel.innerHTML = `<div class="draft-section-head"><h2 id="impact-rubric-title">${escape(role.label)} scoring criteria</h2>
    <p>${escape(impact.headline)}</p></div>
    <ul class="draft-rubric-criteria">${impact.criteria.map(({ label, weight, defaultWeight, description }) => `<li>
      <strong>${escape(label)}</strong><small>${number(weight)}% weight${impact.priority ? ` · ${number(defaultWeight)}% default` : ''}</small>
      <p>${escape(description)}</p></li>`).join('')}</ul>
    <p class="draft-rubric-rating">Each rating applies to the hero’s abilities. ${scales}.</p>`
}

function impactRatings(impact) {
  if (!impact) return ''
  const rows = impact.ratings.map(({ label, value, reason }) => `<tr><th scope="row">${escape(label)}</th>
    <td>${number(value)} / 3</td><td>${escape(reason)}</td></tr>`).join('')
  const info = impact.sources.map((source) => typeof source === 'string' ? { label: 'Valve hero data', url: source } : source)
    .filter(({ url }) => typeof url === 'string' && url.startsWith('https://www.dota2.com/'))
    .map(({ url, label }) => `<a class="text-link" href="${escape(url)}" target="_blank" rel="noreferrer">${escape(label)}</a>`).join(' · ')
  return `<section class="draft-ratings" aria-labelledby="draft-ratings-title">
    <h3 id="draft-ratings-title">Role fit · ${number(impact.score)}/100</h3>
    <div class="scroll-table" tabindex="0" role="region" aria-labelledby="draft-ratings-title"><table>
    <thead><tr><th scope="col">Criterion</th><th scope="col">Rating</th><th scope="col">Ability evidence</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${info ? `<p>${info}</p>` : ''}</section>`
}

function matchupSection(row) {
  const { allRole, matchups } = row
  const baseline = allRole.games ? `${number(allRole.wins)}/${number(allRole.games)} wins (${percent(allRole.winRate)}) across all roles.` : 'No all-role matches for this hero.'
  const pairs = matchups.map((m) => `<tr><th scope="row">${escape(m.enemyName)}</th><td>${m.games ? `${number(m.wins)}/${number(m.games)}` : '—'}</td><td>${lift(m.delta)}</td></tr>`).join('')
  return `<section aria-labelledby="draft-matchups-title"><h3 id="draft-matchups-title">Legend matchup evidence</h3><p>${baseline}</p>
    ${pairs ? `<div class="scroll-table" tabindex="0" role="region" aria-labelledby="draft-matchups-title"><table>
    <thead><tr><th scope="col">Enemy</th><th scope="col">Wins/games</th><th scope="col">Adjusted lift</th></tr></thead><tbody>${pairs}</tbody></table></div>` : ''}</section>`
}

function tacticalNotes({ plan }) {
  const enemies = new Set(state.result.options.enemyIds)
  const relations = [...(plan.goodAgainst ?? []).map((entry) => ({ ...entry, label: 'Opportunity' })),
    ...(plan.avoidAgainst ?? []).map((entry) => ({ ...entry, label: 'Risk' }))].filter(({ heroId }) => enemies.has(heroId))
  const examples = relations.map(({ heroId, label, note }) => `<li><strong>${escape(label)} vs ${escape(state.heroes.get(heroId).name)}</strong> · ${escape(note)}</li>`)
  const practical = [...examples, ...(plan.watchFor ?? []).map((line) => `<li>${escape(line)}</li>`)]
  return `<section><h3>Matchup and team fit</h3>
    ${plan.strengths?.length ? `<p>${plan.strengths.map(escape).join(' · ')}</p>` : ''}
    ${practical.length ? `<ul>${practical.join('')}</ul>` : ''}</section>`
}

function renderDetail() {
  const row = state.result.rows.find(({ hero }) => hero.id === state.selected)
  $('draft-detail').hidden = !row
  if (!row) return
  const { plan, hero } = row
  const { farm, economy, condition } = state.result
  const profiles = row.impact ? `${number(row.impact.score)}/100 role fit` : plan.profile === 'blind' ? 'Opening option' : 'Matchup pick'
  const uncovered = condition && !plan.conditionSupported
    ? '<p>No tailored purchase change for this condition on this hero.</p>' : ''
  const source = economy.basis === 'gold-timeline' ? 'earned-gold timelines' : economy.basis === 'full-match-gpm' ? 'whole-match GPM extrapolation' : 'no economy observations'
  const n = economy.scenarios[0]?.sampleSize
  const tactics = plan.swaps.filter(({ trigger }) => trigger !== condition).map(({ trigger, label, item }) =>
    `<button class="draft-hint" type="button" data-condition="${escape(trigger)}">${escape(label)} · ${escape(item.name)}</button>`).join('')
  $('draft-builds').innerHTML = `<div class="draft-detail-head"><div>
    <h2 id="draft-detail-title">${escape(hero.name)} purchase order</h2><p>${escape(plan.pickNote)}</p>
    <p>Minute ${number(farm.targetMinute)} · ${gold(farm.reserveGold)} reserved · ${source}${n ? ` · ${number(n)} observations` : ''}</p>${uncovered}</div>
    <span class="draft-tag">${profiles}</span></div>
    <div class="draft-builds">${plan.builds.map((build) => buildCard(build, farm.targetMinute, row.impact?.milestones[build.key])).join('')}</div>
    ${impactRatings(row.impact)}
    <div class="draft-evidence">${tacticalNotes(row)}${matchupSection(row)}</div>
    ${tactics ? `<div class="draft-evidence"><section><h3>Try another condition</h3><div class="draft-hints">${tactics}</div></section></div>` : ''}`
}

function renderGuide() {
  const { stage, rows, coverage, conditionHints, assumptions, provenance, fetchedAt, impact } = state.result
  $('draft-matches').textContent = number(coverage.teamMatches)
  $('draft-replays').textContent = number(coverage.roleMatches)
  for (const phase of document.querySelectorAll('[data-phase]')) {
    if (phase.dataset.phase === stage.key) phase.setAttribute('aria-current', 'step')
    else phase.removeAttribute('aria-current')
  }
  $('draft-stage-note').textContent = `${stage.label} · ${stage.advice}`
  $('draft-hints').innerHTML = conditionHints.length ? `<p>Conditions to consider from the revealed draft</p>${conditionHints.map(({ key, label, enemies }) => `
    <button class="draft-hint" type="button" data-condition="${escape(key)}" title="${escape(enemies.join(', '))}">${escape(label)}</button>`).join('')}` : ''
  if (!rows.some(({ hero }) => hero.id === state.selected)) {
    const opening = !impact && stage.key === 'blind' && rows.find(({ plan, rolePicks }) => plan.profile === 'blind' && rolePicks > 0)
    state.selected = (opening || rows[0])?.hero.id ?? null
  }
  $('draft-status').textContent = rows.length ? '' : 'No available guided heroes for this role. Remove a pick or choose another role.'
  $('draft-method').innerHTML = `<ul>${[...assumptions, provenance.method, provenance.reportBaseline,
    ...(impact ? ['The role fit score is a curated weighted average of the 0–3 ability ratings on a 0–100 scale. Giving a team need priority doubles its weight, then rescales all weights to total 100%. The draft score breaks ties.'] : []),
    'Farm budgets use the 25th, 50th and 85th percentiles of this role’s gold through the chosen minute. Costs start from an empty inventory after the reserve. Each row prices a completed purchase.',
    'A game condition applies one curated purchase change. Enemy hero hints suggest what to check in the match. Patch membership is inferred from match start time in the current snapshot.',
  ].map((line) => `<li>${escape(line)}</li>`).join('')}</ul>
  <p><a class="text-link" href="https://www.dota2.com/patches/7.27">Valve All Pick rules</a> · <a class="text-link" href="${escape(provenance.patchUrl)}">Valve 7.42 patch notes</a></p>`
  if (fetchedAt) $('draft-snapshot').textContent = `OpenDota snapshot · ${new Date(fetchedAt).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })} São Paulo`
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
  try {
    const result = await fetchJson(`/api/draft-guide?${query}`, request.signal)
    if (request.signal.aborted) return
    state.result = result
    renderGuide()
    syncGuideLink(query)
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
      document.title = 'Legend role impact | Dota 2 Analyzer'
      $('draft-title').textContent = 'Offlane and support impact'
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
$('draft-add').addEventListener('click', addPick)
$('draft-hero-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); addPick() }
})
$('draft-picks').addEventListener('click', (event) => {
  const chip = event.target.closest('button[data-group]')
  if (!chip) return
  state.picks[chip.dataset.group] = state.picks[chip.dataset.group].filter((id) => id !== Number(chip.dataset.hero))
  $('draft-pick-status').textContent = ''
  renderPicks()
  $('draft-hero-input').focus()
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
