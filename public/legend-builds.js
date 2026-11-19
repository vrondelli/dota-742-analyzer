const $ = (id) => document.getElementById(id)
const settings = $('legend-settings')
const counts = new Intl.NumberFormat('en')
const decimals = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
const coverageLabels = { flat: 'Flat stats', partial: 'Partial', unmodelled: 'No estimate' }
const state = { meta: null, result: null, scope: 'overview', request: null }

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
  return spell ? `${spell.name} · rank ${spell.rank} · ${number(spell.damage)} raw` : 'Item damage only'
}

function castName(ability) {
  return ability ? `${ability.name} · rank ${ability.rank} · ${number(ability.durationSeconds)}s` : ''
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
  return `<td class="legend-cast-hits"><span class="legend-cast-value"${margin}>${count(baseline.hits)} → ${count(build.hits)}</span>
    <span class="legend-cast-note">${gained ? `<strong>${signed(gained)} hits</strong>` : 'Same hit count'}</span>${delayed}</td>
    <td class="legend-cast-speed"><span class="legend-cast-value">${number(baseline.preCastAttackSpeed)} → ${number(build.preCastAttackSpeed)}</span>
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
  const instructions = abilityMetric()
    ? 'Open a role to see its ranked builds and cast breakpoints.'
    : 'Open a role to see its ranked builds. Select a hero to inspect the exact build.'
  return `<div class="surface">
    <div class="section-heading"><div><h2 id="overview-heading">Leaders by role and spend</h2>
      <p class="subtle">${instructions}</p></div></div>
    <div class="scroll-table" tabindex="0" role="region" aria-labelledby="overview-heading">
    <table class="legend-overview">
      <thead><tr><th scope="col">Role</th>${bands.map((band) => `<th scope="col" class="legend-band-title">${escape(bandName(band))}</th>`).join('')}</tr></thead>
      <tbody>${roles.map((role) => `<tr>
        <td><button type="button" class="plain-button" data-scope="${escape(role.key)}">${escape(role.label)}</button>
          <span class="legend-role-subtitle subtle">${count(role.replayPicks)} replay picks</span></td>
        ${role.bands.map((band) => {
          const best = band.rows[0]
          const winner = best ?? band.itemOnlyRows?.[0]
          if (!winner) return '<td><span class="subtle">No eligible gain</span></td>'
          const itemOnly = magicMetric() && !best
          const spell = magicMetric() ? spellText(winner.spell) : castName(winner.ability)
          const hits = winner.ability
            ? `<span class="legend-cast-note">${count(winner.ability.baseline.hits)} → ${count(winner.ability.build.hits)} hits</span>`
            : ''
          return `<td>
            <div class="leader-name">${heroLink(winner, band)}</div>
            <div class="leader-items legend-items">${buildItems(winner.items)}</div>
            <div class="leader-output">
              <strong>${signed(winner.gainPer1000)} ${unit()} / 1,000g</strong>
              <span>${gold(winner.cost)}</span>
              <span>${count(winner.replayPicks)} role picks</span>
              ${winner.coverage === 'partial' ? '<span>Partial item coverage</span>' : ''}
            </div>
            ${spell ? `<span class="legend-spell subtle">${escape(spell)}</span>` : ''}
            ${hits}
            ${itemOnly ? '<span class="subtle">Separate item-only ranking</span>' : ''}
          </td>`
        }).join('')}
      </tr>`).join('')}</tbody>
    </table></div></div>`
}

function renderTable(rows, band, showPicks, label) {
  const magic = magicMetric()
  const ability = abilityMetric()
  return `<div class="scroll-table" tabindex="0" role="region" aria-label="${escape(label)}">
    <table class="legend-table${ability ? ' legend-ability-table' : ''}">
      <thead><tr><th scope="col" aria-label="Rank">#</th><th scope="col">Hero</th><th scope="col">Items</th><th scope="col">Cost</th>
        ${ability ? '<th scope="col">Estimated hits</th><th scope="col">Pre-cast attack speed</th>' : ''}
        <th scope="col">${ability ? 'Damage per cast' : `Total ${unit()}`}</th><th scope="col">Gain</th><th scope="col" aria-sort="descending">Gain / 1,000g</th>
        ${showPicks ? '<th scope="col">Role picks</th>' : ''}<th scope="col">Item coverage</th></tr></thead>
      <tbody>${rows.map((row) => `<tr>
        <td class="rank-cell">${count(row.rank)}</td>
        <td><div class="legend-hero-name">${heroLink(row, band)}</div>
          ${magic ? `<span class="legend-spell subtle">${escape(spellText(row.spell))}</span>` : ''}
          ${ability ? `<span class="legend-spell subtle">${escape(castName(row.ability))}</span>` : ''}</td>
        <td><div class="legend-items">${buildItems(row.items)}</div></td>
        <td class="legend-gold">${gold(row.cost)}</td>
        ${ability ? castCells(row.ability) : ''}
        <td title="No-item baseline ${number(row.base)} ${unit()}">${number(row.total)} ${ability
          ? `<span class="legend-cast-note">${number(row.base)} without items</span>`
          : `<span class="legend-value-unit">${unit()}</span>`}</td>
        <td class="legend-value">${signed(row.gain)}</td>
        <td class="positive legend-value">${signed(row.gainPer1000)}</td>
        ${showPicks ? `<td class="legend-picks">${count(row.replayPicks)}</td>` : ''}
        <td class="legend-coverage-cell${row.coverage === 'partial' ? ' is-partial' : ''}">${coverageLabels[row.coverage] ?? '—'}</td>
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
    ? 'The selected scope has no ranked ability builds. Full roster shows the mechanics comparison without the Legend role filter.'
    : 'Arrows show no items → selected build. The estimate counts an immediate first hit and later whole hits before the cast window ends.'
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
  $('interaction-summary').textContent = `${count(scored)} scored · ${count(mapped)} mapped for future scoring`
  $('interaction-list').innerHTML = interactions.map((entry) => {
    const isScored = entry.modelStatus === 'implemented'
    const examples = (entry.exampleItems ?? []).map(({ name }) => name)
    const roleCounts = meta.roles.filter(({ key }) => Number.isFinite(entry.rolePicks?.[key])).map(({ key, label }) => (
      `${label} ${count(entry.rolePicks[key])}`
    ))
    const parameters = (entry.parameters ?? []).map(({ name, value }) => (
      `<li><strong>${escape(name)}</strong> · ${escape(formatParameter(value))}</li>`
    ))
    const limitations = (entry.limitations ?? []).map((note) => `<li>${escape(note)}</li>`)
    const evidence = (entry.sources ?? []).filter(({ url }) => typeof url === 'string' && url.startsWith('https://'))
      .map(({ label, url }) => `<a href="${escape(url)}" target="_blank" rel="noreferrer">${escape(label)} ↗</a>`)
    return `<details class="legend-interaction">
      <summary>
        <span class="interaction-title"><span aria-hidden="true">${isScored ? '●' : '○'}</span>
          <span><strong>${escape(entry.heroName)}</strong><small>${escape(entry.name)}</small></span></span>
        <span class="interaction-example">${escape(examples.length ? examples.join(' · ') : (entry.itemStats ?? []).join(' · '))}</span>
        <span class="interaction-status${isScored ? ' is-scored' : ''}">${isScored ? 'Scored' : 'Mapped'}</span>
      </summary>
      <div class="interaction-detail">
        <p>${escape(entry.mechanic)}</p>
        ${(entry.itemStats ?? []).length ? `<p><strong>Relevant item stats</strong> · ${escape(entry.itemStats.join(' · '))}</p>` : ''}
        ${parameters.length ? `<ul>${parameters.join('')}</ul>` : ''}
        ${entry.rolePicks ? `<p><strong>Legend replay picks by inferred role</strong> · ${escape(roleCounts.join(' · ') || '0 across tracked positions')}</p>` : ''}
        ${limitations.length ? `<ul>${limitations.join('')}</ul>` : ''}
        ${entry.demoCheck ? `<p><strong>Suggested in-game check</strong> · ${escape(entry.demoCheck)}</p>` : ''}
        ${evidence.length ? `<p>${evidence.join(' · ')}</p>` : ''}
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
    ? `Level ${options.level} · ${number(options.windowSeconds)}s window · ${number(options.targetMagicResistance)}% target magic resist · ${options.includeOnHit ? 'Attack procs included' : 'Casts only'}`
    : `Level ${options.level} · ${number(options.targetArmor)} target armor${abilityMetric() ? ' · Damage per cast' : ''}`
  let evidence = ` · Minimum ${count(options.minReplayPicks ?? 1)} replay ${options.minReplayPicks > 1 ? 'picks' : 'pick'} per role`
  if (state.scope === 'roster') evidence = ' · Mechanics comparison across the whole roster'
  else if (board) evidence = ` · ${count(board.replayPicks)} inferred role picks across ${count(board.replayMatches)} replays`
  $('legend-scenario').textContent = scenario + evidence
  renderAbilityContext(roles, roster, board)
  $('legend-results').innerHTML = state.scope === 'overview' ? renderOverview(roles)
    : board ? renderBoard(board)
      : '<div class="surface legend-empty">This scope is unavailable for the current settings.</div>'
}

function showScope(scope, control) {
  if (state.scope === scope) return
  const focusTitle = control.closest('#legend-results, #legend-ability-context')
  state.scope = scope
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
  for (const [key, value] of Object.entries(meta.defaults)) {
    const control = settings.elements.namedItem(key)
    if (control && value != null) control.value = Array.isArray(value) ? value.join(', ') : value
  }
  const query = new URLSearchParams(window.location.search)
  const metric = query.get('metric')
  if (meta.metrics.some(({ key }) => key === metric)) settings.elements.namedItem('metric').value = metric
  const level = Number(query.get('level'))
  if (Number.isInteger(level) && level >= 1 && level <= 30) $('legend-level').value = level
  const procs = query.get('includeOnHit')
  if (procs === 'true' || procs === 'false') $('legend-procs').value = procs
  const role = query.get('role')
  if (meta.roles.some(({ key }) => key === role) || role === 'roster') state.scope = role
  $('legend-run').disabled = false
  renderTabs()
  renderInteractions(meta)
  renderSnapshot(meta)
}

function buildQuery() {
  const input = $('legend-budgets')
  const parts = input.value.split(',').map((part) => part.trim())
  const values = parts.map(Number)
  const valid = parts.length <= 5 && values.every((value, index) => (
    /^\d+$/.test(parts[index]) && Number.isInteger(value) && value >= 1 && value <= 100000
      && (index === 0 || value > values[index - 1])
  ))
  input.setCustomValidity(valid ? '' : 'Enter up to five increasing gold ceilings from 1 to 100,000, separated by commas.')
  if (!settings.reportValidity()) return null
  const query = new URLSearchParams(new FormData(settings))
  query.set('budgets', values.join(','))
  return query
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
  $('legend-status').textContent = 'Comparing heroes and builds across all roles…'
  try {
    const result = await fetchJson(`/api/legend-builds?${query}`, request.signal)
    if (request.signal.aborted) return
    state.result = result
    if (state.scope === 'roster' && !result.roster) state.scope = 'overview'
    const note = $('legend-note')
    if (result.coverage.replayMatches) {
      note.textContent = 'Role eligibility comes from inferred positions in Legend-average replays. Rankings use modeled 7.42 damage and show each hero’s role sample.'
    } else {
      note.textContent = 'Legend replays with position estimates are unavailable. The Full roster view still has mechanics estimates.'
    }
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
