const $ = (id) => document.getElementById(id)
const form = $('gpm-settings')
const integers = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
const decimals = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })
const scenarioTypes = [
  { key: 'bad', label: 'Bad game', percentile: 'Q25' },
  { key: 'good', label: 'Good game', percentile: 'Q50 · median' },
  { key: 'easy', label: 'Easy game', percentile: 'Q85' },
]
const basisLabels = {
  'gold-timeline': 'Cumulative gold at minute',
  'full-match-gpm': 'Full-match GPM extrapolation',
  unavailable: 'No economy samples',
}
const state = { meta: null, result: null, request: null, context: null, contextLoading: false }

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
  ))
}

function count(value) {
  return Number.isFinite(value) ? integers.format(value) : '—'
}

function amount(value) {
  return Number.isFinite(value) ? decimals.format(value) : '—'
}

function gold(value) {
  return Number.isFinite(value) ? `${count(value)}g` : '—'
}

function signed(value) {
  return Number.isFinite(value) && value > 0 ? `+${amount(value)}` : amount(value)
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal })
  if (response.ok) return response.json()
  const problem = await response.json().catch(() => null)
  throw new Error(problem?.error ?? 'The projection service could not respond.')
}

function thumbnail(kind, key) {
  const slug = (key ?? '').replace(/^npc_dota_hero_/, '')
  const source = /^[a-z0-9_-]+$/i.test(slug) ? `/assets/${kind}/${slug}.${kind === 'heroes' ? 'jpg' : 'png'}` : ''
  const className = kind === 'heroes' ? 'portrait' : 'item-icon'
  return `<span class="${className}" aria-hidden="true">${source ? `<img src="${source}" alt="" loading="lazy" decoding="async">` : ''}</span>`
}

function buildUrl(row, scenario) {
  const { level, targetArmor } = state.result.options
  const query = new URLSearchParams({
    heroId: row.hero.id,
    level,
    targetArmor,
    budget: Math.min(100000, Math.max(scenario.spent, Math.floor(scenario.budget))),
    metric: 'physicalDps',
  })
  for (const item of scenario.items) query.append('itemKey', item.key)
  return `/efficiency?${query}`
}

function buildMarkup(row, scenario, label) {
  if (!scenario.items?.length) return '<span class="gpm-build">Baseline only</span>'
  const parts = scenario.items.map((item) => `<span class="gpm-build-part" title="${gold(item.cost)}">
    ${thumbnail('items', item.key)}${escape(item.name)}</span>`).join('<span aria-hidden="true">+</span>')
  const description = `Inspect ${row.hero.name} in a ${label.toLowerCase()} with ${scenario.items.map(({ name }) => name).join(' and ')}`
  return `<a class="gpm-build" href="${escape(buildUrl(row, scenario))}" aria-label="${escape(description)}">${parts}</a>`
}

function economyMarkup(roles) {
  const panel = $('gpm-economy')
  const content = $('gpm-economy-body')
  panel.hidden = !roles.length
  if (!roles.length) return
  const sampledRole = state.result.options.role
  const display = sampledRole === 'all' ? roles : roles.filter(({ key }) => key === sampledRole)
  content.innerHTML = `<p>Samples are grouped by inferred Legend role. Budget subtracts the selected reserve from projected gold earned.</p>
    <div class="scroll-table" tabindex="0" role="region" aria-label="Role economy and item budgets">
      <table><thead><tr><th scope="col">Role</th><th scope="col">Economy sample</th>
        ${scenarioTypes.map(({ label, percentile }) => `<th scope="col">${label} · ${percentile}</th>`).join('')}</tr></thead>
      <tbody>${display.map((role) => `<tr><td>${escape(role.label)}</td>
        <td>${count(role.scenarios[0]?.sampleSize ?? 0)} picks <span class="gpm-source-label">${basisLabels[role.basis] ?? 'Economy basis unavailable'}</span></td>
        ${scenarioTypes.map(({ key }) => {
          const scenario = role.scenarios.find((entry) => entry.key === key)
          if (!scenario || !Number.isFinite(scenario.gpm)) return '<td class="gpm-muted">—</td>'
          return `<td>${amount(scenario.gpm)} GPM · ${gold(scenario.budget)} budget<span class="gpm-source-label">${gold(scenario.earnedGold)} earned · n=${count(scenario.sampleSize)}</span></td>`
        }).join('')}
      </tr>`).join('')}</tbody></table>
    </div>`
}

function projectionCell(row, { key, label }) {
  const scenario = row.scenarios.find((entry) => entry.key === key)
  if (!scenario) return '<td><span class="subtle">Projection unavailable</span></td>'
  const tone = scenario.gain > 0 ? 'positive' : 'neutral'
  const partial = scenario.coverage === 'partial' ? ' · partial item coverage' : ''
  return `<td>
    <div class="gpm-projection-figures">
      <strong>${amount(scenario.dps)} <small>DPS</small></strong>
      <span>${gold(scenario.budget)} budget</span>
    </div>
    ${buildMarkup(row, scenario, label)}
    <p class="gpm-spend"><span class="${tone}">${signed(scenario.gain)} DPS</span> · ${gold(scenario.spent)} spent · ${gold(scenario.unspent)} budget left${partial}</p>
    <p class="gpm-spend">${amount(scenario.gpm)} GPM · ${gold(scenario.earnedGold)} earned</p>
  </td>`
}

function renderRows() {
  if (!state.result) return
  const { rows } = state.result
  const target = $('gpm-result-body')
  if (!rows.length) {
    target.innerHTML = '<div class="gpm-empty"><strong>No projections for these settings</strong><span>Try an earlier minute or select a different role with economy samples.</span></div>'
    return
  }
  const view = $('gpm-display').value
  const scenarios = scenarioTypes.filter(({ key }) => view === 'all' || view === key)
  target.innerHTML = `<div class="scroll-table" tabindex="0" role="region" aria-label="Ranked GPM build projections">
    <table class="gpm-table${view === 'all' ? ' gpm-all-scenarios' : ''}">
      <thead><tr><th scope="col">Hero</th><th scope="col" aria-sort="descending">Mean DPS</th>
        ${scenarios.map(({ key, label, percentile }) => `<th scope="col" class="gpm-scenario-head gpm-${key}">${label}<span>${percentile}</span></th>`).join('')}</tr></thead>
      <tbody>${rows.map((row) => `<tr>
        <th scope="row"><span class="gpm-hero-identity">
          <span class="gpm-hero-rank" aria-label="Rank ${count(row.rank)}">${count(row.rank)}</span>
          ${thumbnail('heroes', row.hero.key)}<span>${escape(row.hero.name)}</span>
        </span><span class="gpm-row-evidence">${escape(row.roleLabel)} · ${count(row.replayPicks)} role picks</span></th>
        <td class="gpm-mean">${amount(row.averageDps)} <small>${amount(row.baselineDps)} no items</small></td>
        ${scenarios.map((scenario) => projectionCell(row, scenario)).join('')}
      </tr>`).join('')}</tbody>
    </table></div>`
}

function renderSnapshot({ fetchedAt }) {
  if (!fetchedAt) return
  const date = new Date(fetchedAt)
  if (!Number.isFinite(date.getTime())) return
  const formatted = new Intl.DateTimeFormat('en', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo', timeZoneName: 'short',
  }).format(date)
  $('gpm-snapshot').textContent = `OpenDota role snapshot · ${formatted}`
}

function contextPrice(note, role) {
  if (!note.exampleBuild.length) return ''
  const total = note.exampleBuild.reduce((spend, { cost }) => spend + cost, 0)
  const prices = scenarioTypes.map(({ key, label }) => {
    const scenario = role?.scenarios.find((entry) => entry.key === key)
    if (!scenario) return ''
    const margin = scenario.budget - total
    const fits = margin >= 0
    return `<span class="${fits ? 'positive' : ''}">${label} · ${fits ? `${gold(margin)} spare` : `${gold(-margin)} short`}</span>`
  }).join('')
  const items = note.exampleBuild.map(({ name }) => escape(name)).join(' + ')
  return `<p><strong>${items}</strong> · ${gold(total)}</p>${prices ? `<p class="gpm-context-budget">${prices}</p>` : ''}`
}

function renderContext() {
  if (!state.context) return
  const { notes, usage, provenance, potency } = state.context
  const { role: currentRole = 'all', targetMinute } = state.result?.options ?? {}
  const selectedNotes = currentRole === 'all' ? notes : notes.filter(({ role }) => role === currentRole)
  const roles = new Map(state.meta?.roles.map(({ key, label }) => [key, label]))
  const budgets = new Map(state.result?.roles.map((role) => [role.key, role]))
  const sourceLinks = `<a class="text-link" href="${escape(potency.sourceUrl)}" target="_blank" rel="noreferrer">Valve patch mechanics ↗</a>
    · <a class="text-link" href="${escape(potency.itemSourceUrl)}" target="_blank" rel="noreferrer">Pinned item data ↗</a>`
  $('gpm-context-body').innerHTML = `<section aria-labelledby="gpm-potency-title">
    <h3 id="gpm-potency-title">On-hit effects by attack source</h3>
    <div class="scroll-table" tabindex="0" role="region" aria-labelledby="gpm-potency-title">
      <table class="gpm-context-table"><thead><tr><th scope="col">Attack source</th><th scope="col">Item Potency</th>
        ${potency.items.map((item) => `<th scope="col">${escape(item.name)}<small>${escape(item.effect)} · ${gold(item.cost)}</small></th>`).join('')}
      </tr></thead><tbody>${potency.sources.map((source) => `<tr>
        <th scope="row">${escape(source.label)}${source.requiredItem ? `<small>Requires ${escape(source.requiredItem.name)} · ${gold(source.requiredItem.cost)}</small>` : ''}</th>
        <td>${amount(source.potency)}%</td>
        ${potency.items.map((item) => {
          const effect = source.effects.find(({ itemKey }) => itemKey === item.key)
          if (!Number.isFinite(effect?.value)) return '<td>—</td>'
          const unit = item.kind === 'proc-chance' ? '%' : ` ${escape(item.unit)}`
          const sequence = Number.isFinite(effect.sequenceValue) ? `<small>Up to ${amount(effect.sequenceValue)} across ${count(source.hits)} hits</small>` : ''
          return `<td>${amount(effect.value)}${unit}${sequence}</td>`
        }).join('')}
      </tr>`).join('')}</tbody></table>
    </div>
    <ul class="gpm-context-assumptions">${potency.assumptions.map((line) => `<li>${escape(line)}</li>`).join('')}</ul>
    <p>${sourceLinks}</p>
  </section>
  <section aria-labelledby="gpm-report-title">
    <h3 id="gpm-report-title">Build ideas${targetMinute ? ` at minute ${count(targetMinute)}` : ''}</h3>
    <p>${escape(usage)}</p>
    ${selectedNotes.length ? `<div class="gpm-context-cards">${selectedNotes.map((note) => `<article class="gpm-context-card">
      <h4>${escape(note.heroName)} <small>· ${escape(roles.get(note.role) ?? note.role)}</small></h4>
      <p><strong>${escape(note.label)}</strong></p>
      <p>${escape(note.summary)}</p>
      ${contextPrice(note, budgets.get(note.role))}
      <p class="gpm-context-cite">${count(note.legendRolePicks)} Legend role picks · Report pp. ${note.reportPages.map(count).join(', ')}</p>
    </article>`).join('')}</div>` : '<p>The report has no priced build example for this role.</p>'}
    <p class="gpm-context-cite">${escape(provenance.reportTitle)} · ${escape(provenance.baselineLabel)}</p>
  </section>`
}

async function openContext() {
  if (!$('gpm-context').open || state.context || state.contextLoading) return
  const body = $('gpm-context-body')
  state.contextLoading = true
  body.textContent = 'Loading item interactions…'
  try {
    state.context = await fetchJson('/api/gpm-builds/context')
    renderContext()
  } catch (error) {
    state.context = null
    body.textContent = error.message
  } finally {
    state.contextLoading = false
  }
}

function renderResult(query) {
  const { coverage, options, roles, assumptions } = state.result
  $('gpm-match-count').textContent = count(coverage.roleMatches)
  const usedSamples = roles.reduce((total, role) => total + (role.scenarios[0]?.sampleSize ?? 0), 0)
  $('gpm-sample-count').textContent = count(usedSamples)
  $('gpm-hero-count').textContent = count(coverage.returnedHeroes)
  $('gpm-results-title').textContent = `Top ${options.limit} heroes`
  $('gpm-results-scenario').textContent = `Mean DPS across three scenarios · Minute ${options.targetMinute} · Level ${options.level} · ${amount(options.targetArmor)} target armor`
  const legendQuery = new URLSearchParams({ level: options.level })
  if (options.role !== 'all') legendQuery.set('role', options.role)
  $('gpm-legend-link').href = `/legend-builds?${legendQuery}`
  $('gpm-export').href = `/api/gpm-builds.csv?${query}`
  $('gpm-export').hidden = !coverage.returnedHeroes
  const provenance = 'Patch assignment may use match start time. Legend roles are inferred from the replay observations.'
  $('gpm-assumptions').innerHTML = `<ul>${[...assumptions, provenance].map((line) => `<li>${escape(line)}</li>`).join('')}</ul>`
  renderSnapshot(state.result)
  economyMarkup(roles)
  renderRows()
  renderContext()
}

function populateSettings(meta) {
  const roles = meta.roles.some(({ key }) => key === 'all')
    ? meta.roles : [{ key: 'all', label: 'All observed roles' }, ...meta.roles]
  $('gpm-role').replaceChildren(...roles.map(({ key, label }) => new Option(key === 'all' ? 'All observed roles' : label, key)))
  $('gpm-level').replaceChildren(...Array.from({ length: 30 }, (_, index) => new Option(index + 1, index + 1)))
  for (const [field, value] of Object.entries(meta.defaults)) {
    const control = form.elements.namedItem(field)
    if (control && value != null) control.value = value
  }
  const role = new URLSearchParams(window.location.search).get('role')
  if (roles.some(({ key }) => key === role)) $('gpm-role').value = role
  $('gpm-run').disabled = false
  renderSnapshot(meta)
}

async function loadResults() {
  state.request?.abort()
  const request = new AbortController()
  state.request = request
  const query = new URLSearchParams(new FormData(form))
  $('gpm-result-body').setAttribute('aria-busy', 'true')
  $('gpm-run').disabled = true
  $('gpm-status').textContent = 'Projecting economy and comparing builds…'
  try {
    const result = await fetchJson(`/api/gpm-builds?${query}`, request.signal)
    if (request.signal.aborted) return
    state.result = result
    renderResult(query)
    $('gpm-status').textContent = ''
  } catch (error) {
    if (request.signal.aborted) return
    $('gpm-status').textContent = error.message
    if (!state.result) $('gpm-result-body').innerHTML = '<div class="gpm-empty">Choose Project builds to retry.</div>'
  } finally {
    if (!request.signal.aborted) {
      $('gpm-run').disabled = false
      $('gpm-result-body').setAttribute('aria-busy', 'false')
    }
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  if (state.meta) void loadResults()
  else void start()
})
$('gpm-display').addEventListener('change', renderRows)
$('gpm-context').addEventListener('toggle', openContext)
if (window.location.hash === '#gpm-context') $('gpm-context').open = true
document.addEventListener('error', (event) => {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true
}, true)

async function start() {
  try {
    state.meta = await fetchJson('/api/gpm-builds/meta')
    populateSettings(state.meta)
    await loadResults()
  } catch (error) {
    $('gpm-status').textContent = error.message
    $('gpm-result-body').setAttribute('aria-busy', 'false')
    $('gpm-result-body').innerHTML = '<div class="gpm-empty">Projection settings could not be loaded.</div>'
    $('gpm-run').disabled = false
  }
}

void start()
