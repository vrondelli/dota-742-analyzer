const $ = (id) => document.getElementById(id)
const form = $('build-settings')
const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
const decimals = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
const pageSize = 10
const effectSwitches = ['includeActives', 'includeOnHit', 'includeAuras']
const state = { meta: null, query: null, request: null, result: null, page: 0, selected: null }

const statLabels = {
  damage: ['Attack damage', ''], strength: ['Strength', ''], agility: ['Agility', ''],
  intelligence: ['Intelligence', ''], health: ['Maximum health', 'HP'], mana: ['Maximum mana', 'mana'],
  armor: ['Armor', ''], armorReduction: ['Armor reduction', ''], attackSpeed: ['Attack speed', 'AS'],
  attackDamagePct: ['Base attack damage', '%'], magicResistance: ['Magic resistance', '%'],
  healthRegen: ['Health regeneration', 'HP/s'], manaRegen: ['Mana regeneration', 'mana/s'],
  spellAmp: ['Spell amplification', '%'], moveSpeed: ['Movement speed', 'units/s'],
}
const coverageNames = { flat: 'Flat stats', partial: 'Partial coverage', unmodelled: 'No estimate' }

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
  ))
}

function number(value) {
  return Number.isFinite(value) ? decimals.format(value) : '—'
}

function signed(value) {
  if (!Number.isFinite(value)) return '—'
  return value > 0 ? `+${number(value)}` : number(value)
}

function gold(value) {
  return Number.isFinite(value) ? `${whole.format(value)}g` : '—'
}

async function getJson(url, signal) {
  const response = await fetch(url, { signal })
  if (response.ok) return response.json()
  const problem = await response.json().catch(() => null)
  throw new Error(problem?.error ?? 'The build service is unavailable.')
}

function selectedMetric() {
  return state.meta.metrics.find((metric) => metric.key === state.result.options.metric)
}

function populateSettings(meta) {
  const { defaults, heroes, metrics, items } = meta
  const query = new URLSearchParams(window.location.search)
  const suppliedHero = query.get('heroId')
  const validHero = heroes.find((hero) => String(hero.id) === suppliedHero)
  $('eff-hero').replaceChildren(...heroes.map((hero) => new Option(hero.name, hero.id)))
  $('eff-level').replaceChildren(...Array.from({ length: 30 }, (_, index) => new Option(index + 1, index + 1)))

  const groups = new Map()
  for (const metric of metrics) {
    if (!groups.has(metric.group)) {
      const group = document.createElement('optgroup')
      group.label = metric.group
      groups.set(metric.group, group)
    }
    groups.get(metric.group).append(new Option(metric.label, metric.key))
  }
  $('eff-metric').replaceChildren(...groups.values())

  for (const [field, value] of Object.entries({ ...defaults, heroId: validHero?.id ?? defaults.heroId })) {
    const control = form.elements.namedItem(field)
    if (!control || value == null) continue
    if (control.type === 'checkbox') control.checked = value
    else control.value = value
  }

  for (const field of ['level', 'budget', 'targetArmor', 'targetMagicResistance', 'windowSeconds', 'baseSpellDamage', 'metric']) {
    const value = query.get(field)
    if (value === null || value.trim() === '') continue
    const control = form.elements.namedItem(field)
    const previous = control.value
    control.value = value
    if (!control.value || !control.checkValidity()) control.value = previous
  }
  const onHit = query.get('includeOnHit')
  if (onHit === 'true' || onHit === 'false') form.elements.namedItem('includeOnHit').checked = onHit === 'true'

  if (items?.length) {
    const sorted = [...items].sort((first, second) => first.name.localeCompare(second.name))
    for (const field of ['manual-first', 'manual-second']) {
      $(field).append(...sorted.map((item) => new Option(`${item.name} (${gold(item.cost)})`, item.key)))
    }
    $('manual-settings').hidden = false
    const selected = [...new Set(query.getAll('itemKey'))]
      .filter((key) => items.some((item) => item.key === key)).slice(0, 2)
    if (selected.length) {
      if (selected.length === 2) form.elements.namedItem('maxItems').value = '2'
      $('manual-first').value = selected[0]
      syncManual()
      $('manual-second').value = selected[1] ?? ''
      $('manual-settings').open = true
    }
  }
  syncManual()
  $('build-apply').disabled = false
}

function syncManual() {
  const pairMode = form.elements.namedItem('maxItems').value === '2'
  const first = $('manual-first').value
  const second = $('manual-second')
  second.disabled = !pairMode || !first
  if (second.disabled || second.value === first) second.value = ''
  for (const candidate of second.options) candidate.disabled = candidate.value !== '' && candidate.value === first
}

function scenarioLabel(metric, options) {
  if (metric.key === 'physicalDps') return `Sustained attacks against ${number(options.targetArmor)} armor`
  if (metric.key === 'magicalDamage') return `${number(options.windowSeconds)}s · ${number(options.baseSpellDamage)} base spell damage · ${number(options.targetMagicResistance)}% target magic resist`
  if (metric.group === 'Auras') return options.includeAuras ? 'One in-range unit per aura' : 'Auras disabled in combat assumptions'
  if (metric.key === 'physicalEhp' || metric.key === 'magicEhp') return 'Effective health against a single damage type'
  return metric.label
}

function renderBenchmark(result, metric) {
  const { hero, options, baseline } = result
  const slug = state.meta.heroes.find(({ id }) => id === hero.id)?.slug
  const picture = $('eff-portrait')
  if (slug && /^[\w-]+$/.test(slug)) {
    const source = `/assets/heroes/${slug}.jpg`
    if (picture.getAttribute('src') !== source) {
      picture.src = source
      picture.hidden = false
    }
  } else {
    picture.hidden = true
  }
  $('benchmark-level').textContent = `Level ${options.level}`
  $('benchmark-hero').textContent = hero.name
  $('benchmark-scenario').textContent = scenarioLabel(metric, options)
  const unit = metric.unit === 'pp' ? '%' : metric.unit
  $('benchmark-value').innerHTML = `${number(baseline[metric.key])}<small>${escape(unit)}</small>`
}

function itemIcon(item) {
  const slug = /^[a-z0-9_-]+$/i.test(item.key) ? item.key : ''
  if (!slug) return ''
  return `<span class="item-icon" aria-hidden="true"><img src="/assets/items/${slug}.png" alt="" loading="lazy" decoding="async"></span>`
}

function buildName(row) {
  return row.items.map((item) => item.name).join(' + ')
}

function buildButton(row, index) {
  const items = row.items.map((item) => (
    `<span class="build-part">${itemIcon(item)}${escape(item.name)}</span>`
  )).join('<span class="build-join" aria-hidden="true">+</span>')
  return `<button type="button" class="build-name" data-build="${index}" aria-label="View details for ${escape(buildName(row))}" aria-pressed="${state.selected === index}" aria-controls="build-detail">${items}</button>`
}

function renderTable(result, metric) {
  const { rows, totalRows, options } = result
  const start = state.page * pageSize
  const buildSize = options.maxItems === 2 ? 'Singles and pairs' : 'One-item builds'
  const selection = options.itemKeys?.length ? 'Selected build' : buildSize
  $('result-summary').textContent = `${selection} · ${whole.format(totalRows)} within ${gold(options.budget)}`
  $('eff-pagination').hidden = totalRows <= pageSize
  $('eff-page-count').textContent = `${whole.format(start + 1)}–${whole.format(start + rows.length)} of ${whole.format(totalRows)}`
  $('eff-previous').disabled = state.page === 0
  $('eff-next').disabled = start + rows.length >= totalRows
  if (!rows.length) {
    $('eff-results').innerHTML = '<div class="empty-state"><strong>No eligible builds</strong><span>Increase the budget or change your item selection.</span></div>'
    return
  }

  const sortKey = $('result-sort').value === 'gain' ? 'gain' : 'gainPer1000'
  const maxGain = Math.max(0, ...rows.map((row) => row[sortKey] ?? 0))
  const markup = rows.map((row, index) => {
    const selected = state.selected === index
    const expense = row[sortKey]
    const width = maxGain > 0 ? Math.max(0, expense ?? 0) / maxGain * 100 : 0
    const tone = row.gain > 0 ? 'positive' : row.gain < 0 ? 'negative' : 'neutral'
    const track = width ? `<span class="gain-track" aria-hidden="true"><span style="--gain:${width}%"></span></span>` : ''
    const gain = signed(row.gain)
    const ratio = signed(row.gainPer1000)
    return `<tr class="${selected ? 'selected-build' : ''}">
      <td class="rank-cell">${start + index + 1}</td>
      <td>${buildButton(row, index)}</td>
      <td class="gold-value">${gold(row.cost)}</td>
      <td>${row.gain === null ? '—' : number(row.metrics[metric.key])}</td>
      <td class="build-gain ${tone}">${sortKey === 'gain' ? `<span class="gain-stack">${gain}${track}</span>` : gain}</td>
      <td class="build-gain ${tone}">${sortKey === 'gainPer1000' ? `<span class="gain-stack">${ratio}${track}</span>` : ratio}</td>
      <td class="subtle">${coverageNames[row.coverage] ?? '—'}</td>
    </tr>`
  }).join('')
  $('eff-results').innerHTML = `<div class="scroll-table" tabindex="0" role="region" aria-label="Ranked builds table"><table class="build-table">
    <thead><tr><th scope="col" aria-label="Rank">#</th><th scope="col">Build</th><th scope="col">Cost</th>
      <th scope="col">Total (${escape(metric.unit === 'pp' ? '%' : metric.unit)})</th>
      <th scope="col"${sortKey === 'gain' ? ' aria-sort="descending"' : ''}>Gain${metric.unit === 'pp' ? ' (pp)' : ''}</th>
      <th scope="col"${sortKey === 'gainPer1000' ? ' aria-sort="descending"' : ''}>Gain / 1,000g</th>
      <th scope="col">Coverage</th></tr></thead>
    <tbody>${markup}</tbody>
  </table></div>`
}

function describeStats(stats) {
  return Object.entries(stats ?? {}).filter(([, value]) => Number.isFinite(value)).map(([key, value]) => {
    const label = statLabels[key]?.[0] ?? key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)
    return `${label} ${signed(value)}${statLabels[key]?.[1] ? ` ${statLabels[key][1]}` : ''}`
  }).join(' · ')
}

function describeEffect(effect) {
  const pieces = []
  if (Number.isFinite(effect.damage) && effect.damage !== 0) pieces.push(`${number(effect.damage)} damage`)
  if (Number.isFinite(effect.damagePerTick)) {
    pieces.push(`${number(effect.damagePerTick)} damage every ${number(effect.tickInterval)}s for ${number(effect.tickDuration)}s`)
  }
  if (Number.isFinite(effect.chance)) pieces.push(`${number(effect.chance)}% chance`)
  if (Number.isFinite(effect.armorReduction)) pieces.push(`${number(effect.armorReduction)} armor reduction`)
  if (Number.isFinite(effect.multiplier)) pieces.push(`${number(effect.multiplier)}% of the hit`)
  if (number(effect.cooldown) !== '—') pieces.push(`${number(effect.cooldown)}s cooldown`)
  return pieces.join(' · ')
}

function itemDetails(item) {
  const lines = []
  if (describeStats(item.stats)) lines.push(describeStats(item.stats))
  for (const aura of item.auras ?? []) {
    const radius = Number.isFinite(aura.radius) && aura.radius > 0 ? ` within ${whole.format(aura.radius)} units` : ''
    lines.push(`${aura.name ?? aura.key} · ${aura.recipient}${radius} · ${describeStats(aura.stats)}`)
  }
  for (const effect of item.effects ?? []) {
    const values = describeEffect(effect)
    lines.push(`${effect.name ?? effect.key}${values ? ` · ${values}` : ''}`)
  }
  if (!lines.length) lines.push('No numeric effects in this model.')
  return `<div class="build-detail-list"><h3>${escape(item.name)} <span class="subtle">· ${gold(item.cost)}</span></h3><ul>${lines.map((line) => `<li>${escape(line)}</li>`).join('')}</ul></div>`
}

function renderBuildDetails(result, metric, row) {
  $('build-detail').hidden = !row
  if (!row) return
  $('build-detail-title').textContent = buildName(row)
  $('build-detail-summary').textContent = `${gold(row.cost)} · ${coverageNames[row.coverage] ?? 'Modeled effects'}`
  const entries = []
  if (Number.isFinite(row.synergy)) entries.push(['Gain beyond sum of individual items', signed(row.synergy)])
  for (const [side, auraStats] of Object.entries(row.metrics.auras ?? {})) {
    const description = describeStats(auraStats)
    if (description) entries.push([`Net aura effects on ${side}`, description])
  }
  if (metric.key === 'magicalDamage') {
    if (result.options.includeActives) entries.push(['Item active contribution', number(row.metrics.activeMagicDamage)])
    if (result.options.includeOnHit) entries.push(['On-hit contribution', number(row.metrics.onHitMagicDamage)])
  }
  const flags = [
    result.options.includeAuras || 'Auras disabled',
    result.options.includeOnHit || 'On-hit effects disabled',
    result.options.includeActives || 'Item actives disabled',
  ].filter((flag) => typeof flag === 'string')
  const notes = [...flags, ...(row.notes ?? [])]
  if (row.coverage === 'partial') notes.unshift('The total uses the represented effects. Other effects can change in-game performance.')
  const breakdown = entries.map(([label, value]) => `<div class="breakdown-pill"><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')
  $('build-detail-content').innerHTML = `<div class="build-details-inner">
    ${breakdown ? `<dl class="build-breakdown">${breakdown}</dl>` : ''}
    ${row.items.map(itemDetails).join('')}
    ${notes.length ? `<div class="build-detail-list"><h3>Coverage notes</h3><ul>${notes.map((note) => `<li>${escape(note)}</li>`).join('')}</ul></div>` : ''}
  </div>`
}

function drawChart() {
  const points = state.result?.frontier
  if (!points?.length) return
  const canvas = $('frontier-chart')
  const { width, height } = canvas.getBoundingClientRect()
  if (!width || !height) return
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = width * ratio
  canvas.height = height * ratio
  const context = canvas.getContext('2d')
  const x0 = 52
  const y0 = height - 24
  const chartWidth = width - x0 - 24
  const chartHeight = y0 - 15
  const maxCost = Math.max(state.result.options.budget, ...points.map((point) => point.cost), 1)
  const maxGain = Math.max(...points.map((point) => point.gain), 0.01)
  const x = (cost) => x0 + cost / maxCost * chartWidth
  const y = (gain) => y0 - gain / maxGain * chartHeight
  context.scale(ratio, ratio)
  context.font = '10px system-ui'
  context.fillStyle = '#a4a5ad'
  context.strokeStyle = '#32343b'
  for (let tick = 0; tick <= 4; tick += 1) {
    const fraction = tick / 4
    const level = y(maxGain * fraction)
    context.beginPath()
    context.moveTo(x0, level)
    context.lineTo(width - 20, level)
    context.stroke()
    context.fillText(number(maxGain * fraction), 4, level + 3)
    context.textAlign = 'center'
    context.fillText(gold(maxCost * fraction), x(maxCost * fraction), y0 + 15)
    context.textAlign = 'start'
  }
  context.strokeStyle = '#ed8a73'
  context.fillStyle = '#ffad97'
  context.lineWidth = 1.5
  context.beginPath()
  context.moveTo(x0, y0)
  for (const point of points) context.lineTo(x(point.cost), y(point.gain))
  context.stroke()
  for (const point of points) {
    context.beginPath()
    context.arc(x(point.cost), y(point.gain), 3.2, 0, Math.PI * 2)
    context.fill()
  }
}

function renderFrontier(result, metric) {
  const { frontier } = result
  $('frontier-surface').hidden = !frontier?.length
  if (!frontier?.length) return
  $('frontier-summary').textContent = `Best improvements by gold threshold · gain in ${metric.unit}`
  $('frontier-data').innerHTML = `<table class="build-table"><thead><tr><th scope="col">Build</th><th scope="col">Cost</th><th scope="col">Gain</th><th scope="col">Gain / 1,000g</th></tr></thead>
    <tbody>${frontier.map((point) => `<tr><td>${escape(point.label)}</td><td>${gold(point.cost)}</td><td>${signed(point.gain)}</td><td>${signed(point.gainPer1000)}</td></tr>`).join('')}</tbody></table>`
  requestAnimationFrame(drawChart)
}

function render() {
  const { result } = state
  const metric = selectedMetric()
  renderBenchmark(result, metric)
  renderTable(result, metric)
  renderFrontier(result, metric)
  renderBuildDetails(result, metric, result.rows[state.selected])
  $('model-coverage').innerHTML = `<ul>${result.assumptions.map((assumption) => `<li>${escape(assumption)}</li>`).join('')}</ul>`
}

async function refresh() {
  if (!state.query) return
  state.request?.abort()
  const request = new AbortController()
  state.request = request
  const query = new URLSearchParams(state.query)
  query.set('sort', $('result-sort').value)
  query.set('offset', state.page * pageSize)
  query.set('limit', pageSize)
  $('settings-status').textContent = 'Calculating builds…'
  $('eff-results').setAttribute('aria-busy', 'true')
  $('eff-previous').disabled = true
  $('eff-next').disabled = true
  try {
    const result = await getJson(`/api/efficiency?${query}`, request.signal)
    if (request.signal.aborted) return
    state.result = result
    state.selected = result.options.itemKeys?.length && result.rows.length ? 0 : null
    render()
    $('settings-status').textContent = ''
  } catch (error) {
    if (request.signal.aborted) return
    state.result = null
    $('settings-status').textContent = ''
    $('result-summary').textContent = 'Calculation unavailable'
    $('eff-pagination').hidden = true
    $('frontier-surface').hidden = true
    $('build-detail').hidden = true
    $('eff-results').innerHTML = `<div class="empty-state"><strong>Build comparison unavailable</strong><span>${escape(error.message)}</span></div>`
  } finally {
    if (!request.signal.aborted) $('eff-results').setAttribute('aria-busy', 'false')
  }
}

function submitSettings() {
  const data = new FormData(form)
  for (const flag of effectSwitches) data.set(flag, String(form.elements.namedItem(flag).checked))
  state.query = new URLSearchParams([...data].filter(([, value]) => value !== ''))
  state.page = 0
  void refresh()
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  submitSettings()
})
form.addEventListener('change', syncManual)
$('result-sort').addEventListener('change', () => { state.page = 0; void refresh() })
$('eff-previous').addEventListener('click', () => { state.page -= 1; void refresh() })
$('eff-next').addEventListener('click', () => { state.page += 1; void refresh() })
$('eff-results').addEventListener('click', (event) => {
  const control = event.target.closest('[data-build]')
  if (!control || !state.result) return
  const index = Number(control.dataset.build)
  const row = state.result.rows[index]
  if (!row) return
  state.selected = index
  const metric = selectedMetric()
  renderTable(state.result, metric)
  renderBuildDetails(state.result, metric, row)
  $('build-detail-title').tabIndex = -1
  $('build-detail-title').focus()
})
document.addEventListener('error', (event) => {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true
}, true)
new ResizeObserver(drawChart).observe($('frontier-chart'))

async function start() {
  try {
    state.meta = await getJson('/api/efficiency/meta')
    populateSettings(state.meta)
    submitSettings()
  } catch (error) {
    $('settings-status').textContent = error.message
    $('benchmark-scenario').textContent = 'The mechanics dataset could not be loaded.'
    $('eff-results').innerHTML = '<p class="empty-state">Build data unavailable.</p>'
  }
}

void start()
