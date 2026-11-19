const $ = (id) => document.getElementById(id)
const settings = $('legend-settings')
const counts = new Intl.NumberFormat('en')
const decimals = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
const coverageLabels = { flat: 'Flat stats', partial: 'Some effects excluded', unmodelled: 'No estimate' }
const metricDescriptions = {
  physicalDps: 'Average physical damage per second from sustained attacks.',
  magicalDamage: 'Magic damage combines one supported spell cast with modeled item damage during the selected time window.',
  abilityDamage: 'Ability damage currently compares Juggernaut’s Omnislash, including changes in the number of hits.',
}
const state = { meta: null, result: null, query: null, scope: 'overview', request: null }

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
  ))
}

function number(value) {
  return Number.isFinite(value) ? decimals.format(value) : '—'
}

function count(value) {
  return Number.isFinite(value) ? counts.format(value) : '—'
}

function gold(value) {
  return Number.isFinite(value) ? `${count(value)}g` : '—'
}

function signed(value) {
  return Number.isFinite(value) && value > 0 ? `+${number(value)}` : number(value)
}

function bandName({ minSpend, maxSpend }) {
  return minSpend <= 1 ? `Up to ${gold(maxSpend)}` : `${count(minSpend)}–${gold(maxSpend)}`
}

function mobileLabel(label) {
  return `<span class="legend-mobile-label" aria-hidden="true">${escape(label)}</span>`
}

function magicMetric() {
  return state.result.options.metric === 'magicalDamage'
}

function abilityMetric() {
  return state.result.options.metric === 'abilityDamage'
}

function unit() {
  if (abilityMetric()) return 'damage/cast'
  return magicMetric() ? 'damage' : 'DPS'
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal })
  if (response.ok) return response.json()
  const problem = await response.json().catch(() => null)
  throw new Error(problem?.error ?? 'The comparison service could not respond.')
}

function detailUrl(row, band) {
  const options = state.result.options
  const query = new URLSearchParams({
    heroId: row.hero.id,
    level: options.level,
    budget: band.maxSpend,
    metric: options.metric,
  })
  for (const field of ['targetArmor', 'targetMagicResistance', 'windowSeconds']) {
    if (Number.isFinite(options[field])) query.set(field, options[field])
  }
  if (magicMetric()) query.set('baseSpellDamage', row.spell?.damage ?? 0)
  query.set('includeOnHit', options.includeOnHit)
  for (const item of row.items) query.append('itemKey', item.key)
  return `/efficiency?${query}`
}

function thumb(kind, key) {
  const slug = (key ?? '').replace(/^npc_dota_hero_/, '')
  const source = /^[a-z0-9_-]+$/i.test(slug) ? `/assets/${kind}/${slug}.${kind === 'heroes' ? 'jpg' : 'png'}` : ''
  const className = kind === 'heroes' ? 'portrait' : 'item-icon'
  return `<span class="${className}" aria-hidden="true">${source ? `<img src="${source}" alt="" loading="lazy" decoding="async">` : ''}</span>`
}

function buildItems(items) {
  return items.map((item) => `<span title="${escape(gold(item.cost))}">${thumb('items', item.key)}${escape(item.name)}</span>`)
    .join('<span aria-hidden="true">+</span>')
}

function heroLink(row, band) {
  if (abilityMetric()) return `${thumb('heroes', row.hero.key)}<span>${escape(row.hero.name)}</span>`
  const label = `Inspect ${row.hero.name} with ${row.items.map((item) => item.name).join(' and ')}`
  return `${thumb('heroes', row.hero.key)}<a href="${escape(detailUrl(row, band))}" aria-label="${escape(label)}">${escape(row.hero.name)}</a>`
}

function spellText(spell) {
  return spell ? `${spell.name} (rank ${spell.rank}, ${number(spell.damage)} raw damage)` : 'Item damage only'
}

function castName(ability) {
  return ability ? `${ability.name} (rank ${ability.rank}, ${number(ability.durationSeconds)}s)` : ''
}

function castHitGain(ability) {
  return ability.build.hits - ability.baseline.hits
}

function castCells(ability) {
  if (!ability) return '<td>—</td><td>—</td>'
  const { baseline, build } = ability
  const gained = castHitGain(ability)
  const next = build.nextAttackSpeedThreshold
  const first = baseline.nextAttackSpeedThreshold
  const crossed = gained > 0 && Number.isFinite(first)
    ? `<span class="legend-cast-note" title="Strict threshold ${escape(first)} pre-cast attack speed">Crossed first breakpoint above ≈${number(first)} AS</span>`
    : ''
  const breakpoint = Number.isFinite(next)
    ? `<span title="Strict threshold ${escape(next)} pre-cast attack speed">Next hit above ≈${number(next)} AS</span>`
    : '<span>At the modeled hit cap</span>'
  const delayed = Number.isFinite(build.hitsWith33msDelay) && build.hitsWith33msDelay !== build.hits
    ? `<span class="legend-cast-note">${count(build.hitsWith33msDelay)} hits if each gap is 33 ms longer</span>`
    : ''
  const margin = Number.isFinite(build.lastHitMarginSeconds)
    ? ` title="Last modeled hit lands ${number(build.lastHitMarginSeconds * 1000)} ms before the cast ends"`
    : ''
  return `<td role="cell" class="legend-cast-hits">${mobileLabel('Estimated hits')}<span class="legend-cast-value"${margin}>${count(baseline.hits)} → ${count(build.hits)}</span>
    <span class="legend-cast-note">${gained ? `<strong>${signed(gained)} hits</strong>` : 'Same hit count'}</span>${delayed}</td>
    <td role="cell" class="legend-cast-speed">${mobileLabel('Pre-cast attack speed')}<span class="legend-cast-value">${number(baseline.preCastAttackSpeed)} → ${number(build.preCastAttackSpeed)}</span>
    ${crossed}
    <span class="legend-cast-note">${breakpoint}</span>
    <span class="legend-cast-note" title="Time between estimated hits after Omnislash bonus attack speed">${number(build.slashInterval)}s between hits</span></td>`
}

function renderTabs() {
  const roles = state.result?.roles ?? state.meta.roles
  const scopes = [{ key: 'overview', label: 'Role overview' }, ...roles]
  if (state.result?.roster || (!state.result && state.meta.defaults.includeRoster !== false)) {
    scopes.push({ key: 'roster', label: 'Full roster' })
  }
  $('legend-tabs').innerHTML = scopes.map(({ key, label }) => (
    `<button class="role-tab" type="button" data-scope="${escape(key)}" aria-controls="legend-results" aria-pressed="${key === state.scope}">${escape(label)}</button>`
  )).join('')
}

function renderOverview(roles) {
  const bands = roles[0]?.bands ?? []
  return `<div class="surface">
    <div class="section-heading"><h3 id="overview-heading">Leaders by role and spend</h3></div>
    <div class="scroll-table legend-table-region" tabindex="0" role="region" aria-labelledby="overview-heading">
    <table class="legend-overview" role="table">
      <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Role</th>${bands.map((band) => `<th scope="col" role="columnheader" class="legend-band-title">${escape(bandName(band))}</th>`).join('')}</tr></thead>
      <tbody role="rowgroup">${roles.map((role) => `<tr role="row">
        <th scope="row" role="rowheader" class="legend-role-cell"><button type="button" class="plain-button" data-scope="${escape(role.key)}">${escape(role.label)}</button>
          <span class="legend-role-subtitle subtle">${count(role.replayPicks)} replay picks</span></th>
        ${role.bands.map((band) => {
          const best = band.rows[0]
          const winner = best ?? band.itemOnlyRows?.[0]
          const label = mobileLabel(bandName(band))
          if (!winner) return `<td role="cell">${label}<span class="subtle">No qualifying improvement</span></td>`
          const spell = magicMetric() ? spellText(winner.spell) : castName(winner.ability)
          const hits = winner.ability
            ? `<span class="legend-cast-note">${count(winner.ability.baseline.hits)} → ${count(winner.ability.build.hits)} hits</span>`
            : ''
          return `<td role="cell">${label}
            <div class="leader-name">${heroLink(winner, band)}</div>
            <div class="leader-items legend-items">${buildItems(winner.items)}</div>
            <div class="leader-output">
              <strong>${signed(winner.gainPer1000)} ${unit()} / 1,000g</strong>
              <span>${gold(winner.cost)}</span>
              <span>${count(winner.replayPicks)} role picks</span>
              ${winner.coverage === 'partial' ? '<span>Some effects excluded</span>' : ''}
            </div>
            ${spell ? `<span class="legend-spell subtle">${escape(spell)}</span>` : ''}
            ${hits}
          </td>`
        }).join('')}
      </tr>`).join('')}</tbody>
    </table></div></div>`
}

function renderTable(rows, band, showPicks, label) {
  const magic = magicMetric()
  const ability = abilityMetric()
  const totalLabel = ability ? 'Damage per cast' : `Total ${unit()}`
  return `<div class="scroll-table legend-table-region" tabindex="0" role="region" aria-label="${escape(label)}">
    <table class="legend-table${ability ? ' legend-ability-table' : ''}" role="table">
      <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader" aria-label="Rank">#</th><th scope="col" role="columnheader">Hero</th><th scope="col" role="columnheader">Items</th><th scope="col" role="columnheader">Cost</th>
        ${ability ? '<th scope="col" role="columnheader">Estimated hits</th><th scope="col" role="columnheader">Pre-cast attack speed</th>' : ''}
        <th scope="col" role="columnheader">${totalLabel}</th><th scope="col" role="columnheader">Gain</th><th scope="col" role="columnheader" aria-sort="descending">Gain per 1,000g</th>
        ${showPicks ? '<th scope="col" role="columnheader">Role picks</th>' : ''}<th scope="col" role="columnheader">Model coverage</th></tr></thead>
      <tbody role="rowgroup">${rows.map((row) => `<tr role="row">
        <td role="cell" class="rank-cell">${mobileLabel('Rank')}${count(row.rank)}</td>
        <th scope="row" role="rowheader" class="legend-hero-cell"><div class="legend-hero-name">${heroLink(row, band)}</div>
          ${magic ? `<span class="legend-spell subtle">${escape(spellText(row.spell))}</span>` : ''}
          ${ability ? `<span class="legend-spell subtle">${escape(castName(row.ability))}</span>` : ''}</th>
        <td role="cell" class="legend-build-cell"><div class="legend-items">${buildItems(row.items)}</div></td>
        <td role="cell" class="legend-gold">${mobileLabel('Cost')}${gold(row.cost)}</td>
        ${ability ? castCells(row.ability) : ''}
        <td role="cell">${mobileLabel(totalLabel)}${number(row.total)} <span class="legend-value-unit">${unit()}</span>
          <span class="legend-cast-note">${number(row.base)} before items</span></td>
        <td role="cell" class="legend-value">${mobileLabel('Total gain')}${signed(row.gain)}</td>
        <td role="cell" class="positive legend-value">${mobileLabel('Gain per 1,000g')}${signed(row.gainPer1000)}</td>
        ${showPicks ? `<td role="cell" class="legend-picks">${mobileLabel('Role picks')}${count(row.replayPicks)}</td>` : ''}
        <td role="cell" class="legend-coverage-cell${row.coverage === 'partial' ? ' is-partial' : ''}">${mobileLabel('Model coverage')}${coverageLabels[row.coverage] ?? '—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`
}

function emptyBand(band, isRoster) {
  if (abilityMetric()) {
    const message = isRoster
      ? 'Change the spend band, hero level, or item coverage to check other builds.'
      : 'See Full roster for mechanics results without the role requirement.'
    return `<div class="legend-empty legend-inner-empty"><strong>No ability casts with positive gain in this band</strong><span>${message}</span></div>`
  }
  const noHeroes = band.eligibleHeroes === 0 && !band.itemOnlyHeroes
  const explanation = noHeroes && !isRoster
    ? 'Lower the minimum role picks or choose another role.'
    : 'Try a different spend band or adjust the item coverage filter.'
  return `<div class="legend-empty legend-inner-empty"><strong>No ${magicMetric() ? 'spell-backed ' : ''}builds with positive gain</strong><span>${explanation}</span></div>`
}

function renderBoard(board) {
  const isRoster = state.scope === 'roster'
  return board.bands.map((band) => {
    const title = bandName(band)
    const magic = magicMetric()
    const summary = abilityMetric()
      ? `${count(band.rows.length)} ranked ${band.rows.length === 1 ? 'build' : 'builds'}`
      : `${count(band.eligibleHeroes)} ${magic ? 'spell-backed' : 'eligible'} heroes`
    const main = band.rows.length ? renderTable(band.rows, band, !isRoster, title) : emptyBand(band, isRoster)
    const itemOnly = magic && band.itemOnlyRows?.length ? `
      <details class="item-disclosure"${band.rows.length ? '' : ' open'}>
        <summary class="item-only-summary">Item-only magic · ${count(band.itemOnlyHeroes)} heroes</summary>
        ${renderTable(band.itemOnlyRows, band, !isRoster, `Item-only magic, ${title}`)}
      </details>` : ''
    return `<section class="surface legend-band">
      <div class="section-heading"><div><h3 class="legend-band-title">${escape(title)}</h3><p class="subtle">${summary}</p></div></div>
      ${main}
      ${itemOnly}
    </section>`
  }).join('')
}

function renderAbilityContext(roles, roster, board) {
  const panel = $('legend-ability-context')
  const active = abilityMetric()
  panel.hidden = !active
  $('legend-interactions').hidden = !active || !state.meta.abilityInteractions?.length
  if (!active) return
  const rosterHasBuilds = roster?.bands.some(({ rows }) => rows.length)
  const roleBoards = board ? [board] : roles
  const rolesHaveBuilds = roleBoards.some(({ bands }) => bands.some(({ rows }) => rows.length))
  const needsRoster = state.scope !== 'roster' && rosterHasBuilds && !rolesHaveBuilds
  const title = state.result.coverage.abilityHeroCount === 0
    ? 'Omnislash unlocks at hero level 6'
    : 'Omnislash hit breakpoints'
  const note = needsRoster
    ? 'Full roster shows Omnislash estimates outside the selected role.'
    : 'Estimated hits start immediately. Each arrow compares the no-item baseline with the build.'
  const rosterLink = needsRoster
    ? '<button class="role-tab" type="button" data-scope="roster" aria-controls="legend-results">View Full roster</button>'
    : ''
  const mappingLink = $('legend-interactions').hidden ? '' : '<a href="#legend-interactions">Mapped abilities <span aria-hidden="true">↓</span></a>'
  const potencyLink = '<a href="/gpm-builds#gpm-context">Item Potency <span aria-hidden="true">↗</span></a>'
  panel.innerHTML = `<div><strong>${title}</strong><p>${note}</p></div><span class="legend-ability-links">${rosterLink}${mappingLink}${potencyLink}</span>`
}

function formatParameter(value) {
  if (Array.isArray(value)) return value.map(formatParameter).join(' / ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return Number.isFinite(value) ? number(value) : String(value ?? '')
}

function renderInteractions(meta) {
  const interactions = meta.abilityInteractions ?? []
  const scored = interactions.filter(({ modelStatus }) => modelStatus === 'implemented').length
  const mapped = interactions.length - scored
  $('interaction-summary').textContent = `${count(scored)} scored, ${count(mapped)} mapped`
  $('interaction-list').innerHTML = interactions.map((entry) => {
    const isScored = entry.modelStatus === 'implemented'
    const examples = (entry.exampleItems ?? []).map(({ name }) => name)
    const roleCounts = meta.roles.filter(({ key }) => Number.isFinite(entry.rolePicks?.[key])).map(({ key, label }) => (
      `${label} ${count(entry.rolePicks[key])}`
    ))
    const parameters = (entry.parameters ?? []).map(({ name, value }) => (
      `<li><strong>${escape(name)}</strong> ${escape(formatParameter(value))}</li>`
    ))
    const limitations = (entry.limitations ?? []).map((note) => `<li>${escape(note)}</li>`)
    const evidence = (entry.sources ?? []).filter(({ url }) => typeof url === 'string' && url.startsWith('https://'))
      .map(({ label, url }) => `<a href="${escape(url)}" target="_blank" rel="noreferrer">${escape(label)} ↗</a>`)
    return `<details class="legend-interaction">
      <summary>
        <span class="interaction-title"><strong>${escape(entry.heroName)}</strong><small>${escape(entry.name)}</small></span>
        <span class="interaction-example">${escape((examples.length ? examples : entry.itemStats ?? []).join(', '))}</span>
        <span class="interaction-status${isScored ? ' is-scored' : ''}">${isScored ? 'Scored' : 'Mapped'}</span>
      </summary>
      <div class="interaction-detail">
        <p>${escape(entry.mechanic)}</p>
        ${(entry.itemStats ?? []).length ? `<p><strong>Item stats</strong> ${escape(entry.itemStats.join(', '))}</p>` : ''}
        ${parameters.length ? `<ul>${parameters.join('')}</ul>` : ''}
        ${entry.rolePicks ? `<p><strong>Inferred Legend role picks</strong> ${escape(roleCounts.join(', ') || '0 across tracked positions')}</p>` : ''}
        ${limitations.length ? `<ul>${limitations.join('')}</ul>` : ''}
        ${entry.demoCheck ? `<p><strong>In-game check</strong> ${escape(entry.demoCheck)}</p>` : ''}
        ${evidence.length ? `<p>${evidence.join(', ')}</p>` : ''}
      </div>
    </details>`
  }).join('')
}

function renderResults() {
  if (!state.result) return
  const { options, coverage, roles, roster } = state.result
  const board = state.scope === 'roster' ? roster : roles.find(({ key }) => key === state.scope)
  $('legend-matches').textContent = count(coverage.legendMatches)
  $('legend-replays').textContent = count(coverage.replayMatches)
  $('legend-roster-label').textContent = abilityMetric() ? 'Heroes with scored abilities' : 'Modeled heroes'
  $('legend-roster-count').textContent = count(abilityMetric() ? coverage.abilityHeroCount : coverage.heroCount)
  $('legend-results-title').textContent = state.scope === 'overview' ? 'Role leaderboard'
    : state.scope === 'roster' ? 'Full roster' : `${board?.label ?? ''} leaderboard`
  const scenario = magicMetric()
    ? `Level ${options.level} against ${number(options.targetMagicResistance)}% magic resistance over ${number(options.windowSeconds)}s. ${options.includeOnHit ? 'Includes attack procs.' : 'Casts only.'}`
    : `Level ${options.level} against ${number(options.targetArmor)} armor.`
  $('legend-scenario').textContent = scenario
  let evidence = `Minimum ${count(options.minReplayPicks)} replay ${options.minReplayPicks === 1 ? 'pick' : 'picks'} per position.`
  if (state.scope === 'roster') evidence = 'Includes every modeled hero.'
  else if (!coverage.replayMatches) evidence = 'Role replays unavailable. Full roster shows damage estimates.'
  else if (board) evidence = `${count(board.replayPicks)} inferred role picks across ${count(board.replayMatches)} replays.`
  $('legend-note').textContent = evidence
  const role = board && state.scope !== 'roster' ? state.scope : ''
  const farm = new URLSearchParams({ level: options.level, targetArmor: options.targetArmor, maxItems: options.maxItems })
  if (role) farm.set('role', role)
  $('legend-gpm-link').href = `/gpm-builds?${farm}`
  $('legend-role-link').href = role ? `/role-rankings?role=${encodeURIComponent(role)}` : '/role-rankings'
  renderAbilityContext(roles, roster, board)
  $('legend-results').innerHTML = state.scope === 'overview' ? renderOverview(roles)
    : board ? renderBoard(board)
      : '<div class="surface legend-empty">This scope is unavailable for the current settings.</div>'
}

function showScope(scope, control) {
  if (state.scope === scope) return
  const focusTitle = control.closest('#legend-results, #legend-ability-context')
  state.scope = scope
  syncUrl()
  for (const button of $('legend-tabs').querySelectorAll('[data-scope]')) {
    button.setAttribute('aria-pressed', String(button.dataset.scope === scope))
  }
  renderResults()
  if (focusTitle) {
    $('legend-results-title').tabIndex = -1
    $('legend-results-title').focus()
  }
}

function renderSnapshot({ fetchedAt }) {
  if (!fetchedAt) return
  const date = new Date(fetchedAt)
  if (!Number.isFinite(date.getTime())) return
  const timestamp = new Intl.DateTimeFormat('en', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo', timeZoneName: 'short',
  }).format(date)
  $('legend-snapshot').textContent = `OpenDota role snapshot · ${timestamp}`
}

function populateSettings(meta) {
  $('legend-level').replaceChildren(...Array.from({ length: 30 }, (_, index) => new Option(index + 1, index + 1)))
  const query = new URLSearchParams(window.location.search)
  for (const [key, value] of Object.entries(meta.defaults)) {
    const control = settings.elements.namedItem(key)
    if (!control || value == null) continue
    const fallback = Array.isArray(value) ? value.join(', ') : String(value)
    const input = query.get(key)
    control.value = input?.trim() ? input : fallback
    if (!control.value || (key === 'budgets' ? !parseBudgets(control.value) : control.validity && !control.validity.valid)) {
      control.value = fallback
    }
  }
  const role = query.get('role')
  if (meta.roles.some(({ key }) => key === role) || role === 'roster') state.scope = role
  $('legend-run').disabled = false
  renderMetricHelp()
  renderTabs()
  renderInteractions(meta)
  renderSnapshot(meta)
}

function parseBudgets(value) {
  const parts = value.split(',').map((part) => part.trim())
  const values = parts.map(Number)
  const valid = parts.length <= 5 && values.every((value, index) => (
    /^\d+$/.test(parts[index]) && Number.isInteger(value) && value >= 1 && value <= 100000
      && (index === 0 || value > values[index - 1])
  ))
  return valid ? values : null
}

function buildQuery() {
  const input = $('legend-budgets')
  const values = parseBudgets(input.value)
  input.setCustomValidity(values ? '' : 'Enter up to five increasing gold limits from 1 to 100,000, separated by commas.')
  if (!settings.reportValidity()) return null
  const query = new URLSearchParams(new FormData(settings))
  query.set('budgets', values.join(','))
  return query
}

function syncUrl() {
  if (!state.query) return
  const query = new URLSearchParams(state.query)
  if (state.scope !== 'overview') query.set('role', state.scope)
  window.history.replaceState(null, '', `${window.location.pathname}?${query}${window.location.hash}`)
}

function renderMetricHelp() {
  $('legend-metric-help').textContent = metricDescriptions[settings.elements.namedItem('metric').value]
}

async function loadResults() {
  const query = buildQuery()
  if (!query) return
  state.request?.abort()
  const request = new AbortController()
  state.request = request
  const container = $('legend-results')
  container.setAttribute('aria-busy', 'true')
  $('legend-run').disabled = true
  $('legend-status').textContent = 'Comparing builds…'
  try {
    const result = await fetchJson(`/api/legend-builds?${query}`, request.signal)
    if (request.signal.aborted) return
    state.result = result
    state.query = query
    if (state.scope === 'roster' && !result.roster) state.scope = 'overview'
    syncUrl()
    renderSnapshot(result)
    renderTabs()
    renderResults()
    $('legend-status').textContent = ''
  } catch (error) {
    if (request.signal.aborted) return
    $('legend-status').textContent = error.message
    if (!state.result) container.innerHTML = '<div class="surface legend-empty">Choose Compare builds to retry.</div>'
  } finally {
    if (!request.signal.aborted) {
      $('legend-run').disabled = false
      container.setAttribute('aria-busy', 'false')
    }
  }
}

settings.addEventListener('submit', (event) => {
  event.preventDefault()
  if (state.meta) void loadResults()
  else void start()
})
$('legend-budgets').addEventListener('input', (event) => event.target.setCustomValidity(''))
settings.addEventListener('change', (event) => {
  if (event.target.name === 'metric') renderMetricHelp()
})
for (const region of ['legend-tabs', 'legend-results', 'legend-ability-context']) {
  $(region).addEventListener('click', (event) => {
    const control = event.target.closest('[data-scope]')
    if (control) showScope(control.dataset.scope, control)
  })
}
document.addEventListener('error', (event) => {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true
}, true)

async function start() {
  try {
    state.meta = await fetchJson('/api/legend-builds/meta')
    populateSettings(state.meta)
    await loadResults()
  } catch (error) {
    $('legend-status').textContent = error.message
    $('legend-results').setAttribute('aria-busy', 'false')
    $('legend-results').innerHTML = '<div class="surface legend-empty">Comparison settings could not be loaded.</div>'
    $('legend-run').disabled = false
  }
}

void start()
