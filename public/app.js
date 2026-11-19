const $ = (id) => document.getElementById(id)
const whole = new Intl.NumberFormat('en')
const percent = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 })
const pageSize = 12
const windowNames = { opening: 'Opening', early: 'Early', mid: 'Mid', late: 'Late' }

const state = {
  meta: null,
  heroData: null,
  itemData: null,
  heroRequest: null,
  itemRequest: null,
  selected: null,
  comparison: new Set(),
  role: 'all',
  rank: '5',
  window: 'early',
  minGames: 5,
  minGroup: 5,
  patchConfidence: 'all',
  roleConfidence: 'all',
  page: 1,
  heroError: false,
  itemError: false,
}

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
  ))
}

function count(value) {
  return Number.isFinite(value) ? whole.format(value) : '—'
}

function rate(value) {
  return Number.isFinite(value) ? percent.format(value) : '—'
}

function coverage(numerator, denominator) {
  return denominator && Number.isFinite(numerator) ? rate(numerator / denominator) : '—'
}

function time(value) {
  if (!Number.isFinite(value)) return '—'
  const seconds = Math.round(Math.abs(value))
  return `${value < 0 ? '−' : ''}${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function delta(value) {
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 1000) / 10
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : ''
  return `${sign}${Math.abs(rounded).toFixed(1)} pp`
}

function activeRole() {
  return state.meta?.roles.find(({ key }) => key === state.role)?.label ?? 'All roles'
}

function heroById(id) {
  return state.heroData?.rows.find((hero) => hero.heroId === id)
    ?? state.meta?.heroes.find((hero) => hero.id === id)
}

function asset(kind, slug) {
  return /^[a-z0-9_-]+$/i.test(slug ?? '')
    ? `/assets/${kind}/${slug}.${kind === 'heroes' ? 'jpg' : 'png'}`
    : ''
}

function thumbnail(kind, slug) {
  const source = asset(kind, slug)
  const className = kind === 'heroes' ? 'portrait' : 'item-icon'
  return `<span class="${className}" aria-hidden="true">${source
    ? `<img src="${source}" alt="" loading="lazy" decoding="async">` : ''}</span>`
}

function matchFilters() {
  return new URLSearchParams({
    role: state.role,
    rank: state.rank,
    patchConfidence: state.patchConfidence,
    roleConfidence: state.roleConfidence,
  })
}

async function fetchData(url, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
  return response.json()
}

function renderCoverage(cohort) {
  $('dataset-matches').textContent = count(cohort.matches)
  $('dataset-roles').textContent = coverage(cohort.roleKnownPicks, cohort.totalPicks)
  $('dataset-purchases').textContent = coverage(cohort.parsedPicks, cohort.totalPicks)
  $('dataset-roles').title = `${count(cohort.roleKnownPicks)} of ${count(cohort.totalPicks)} hero picks`
  $('dataset-purchases').title = `${count(cohort.parsedPicks)} of ${count(cohort.totalPicks)} hero picks`
  const note = $('dataset-note')
  const rankLabel = $('rank-filter').selectedOptions[0]?.textContent ?? 'All ranks'
  const inferred = cohort.matches - cohort.verifiedMatches
  if (!cohort.matches) {
    note.textContent = `No match results for ${rankLabel} with these filters.`
  } else if (inferred > 0) {
    note.textContent = `The patch is inferred from start time for ${count(inferred)} of ${count(cohort.matches)} matches.`
  } else {
    note.textContent = `Patch verified for all ${count(cohort.matches)} matches.`
  }
  note.classList.remove('is-error')
}

function renderMetadata() {
  const meta = state.meta
  $('rank-filter').replaceChildren(...meta.rankTiers.map(({ key, label }) => new Option(label, key)))
  $('rank-filter').value = state.rank
  $('role-tabs').innerHTML = meta.roles.map(({ key, label }) => (
    `<button type="button" class="role-tab" data-role="${escape(key)}" aria-pressed="${key === state.role}">${escape(label)}</button>`
  )).join('')
  $('window-tabs').innerHTML = meta.windows.map(({ key, label, start, end }) => (
    `<button type="button" class="window-tab" data-window="${escape(key)}" aria-pressed="${key === state.window}">
      ${escape(windowNames[key] ?? label)}<small>${time(start)} – ${time(end)}</small>
    </button>`
  )).join('')

  if (meta.fetchedAt) {
    const date = new Date(meta.fetchedAt)
    if (Number.isFinite(date.getTime())) {
      const timestamp = new Intl.DateTimeFormat('en', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo', timeZoneName: 'short',
      }).format(date)
      $('snapshot-label').textContent = `OpenDota snapshot from ${timestamp}`
    }
  }
}

function renderHeroRows() {
  const body = $('hero-rows')
  const cohort = state.heroData
  if (!cohort) {
    const message = state.heroError ? 'Match results could not load. <button type="button" class="plain-button" data-retry-heroes>Retry</button>' : 'Loading heroes…'
    body.innerHTML = `<tr><td colspan="6" class="loading-cell">${message}</td></tr>`
    $('pagination').hidden = true
    return
  }

  $('hero-cohort').textContent = `${count(cohort.eligiblePicks)} hero picks. Ranking requires ${count(cohort.minGames)} matches.`
  const search = $('hero-search').value.trim().toLowerCase()
  const matches = cohort.rows.filter((hero) => hero.name?.toLowerCase().includes(search))
  const pages = Math.max(1, Math.ceil(matches.length / pageSize))
  state.page = Math.min(state.page, pages)
  if (!matches.length) {
    body.innerHTML = '<tr><td colspan="6" class="loading-cell">No heroes match your search.</td></tr>'
    $('pagination').hidden = true
    return
  }

  const start = (state.page - 1) * pageSize
  const rows = matches.slice(start, start + pageSize)
  body.innerHTML = rows.map((hero) => {
    const selected = hero.heroId === state.selected
    const compared = state.comparison.has(hero.heroId)
    const hasGames = hero.games > 0 && Number.isFinite(hero.winRate)
    const winsAboveHalf = hasGames && hero.rank != null && hero.winRate !== 0.5
    const tone = winsAboveHalf ? (hero.winRate > 0.5 ? 'positive' : 'negative') : 'neutral'
    const interval = hasGames && Number.isFinite(hero.confidenceLow) && Number.isFinite(hero.confidenceHigh)
      ? ` title="95% interval ${rate(hero.confidenceLow)}–${rate(hero.confidenceHigh)}"` : ''
    const rankName = hero.rank == null ? (hasGames ? 'Below ranking minimum' : 'No observations') : `Rank ${hero.rank}`
    return `<tr data-row="${hero.heroId}" class="${selected ? 'selected-row' : ''}">
      <td class="rank-cell${hero.rank == null ? '' : ' ranked'}" title="${rankName}">${hero.rank ?? '—'}</td>
      <td><button type="button" class="hero-select" data-hero="${hero.heroId}" aria-pressed="${selected}" aria-controls="item-section">${thumbnail('heroes', hero.slug)}<span>${escape(hero.name)}</span></button></td>
      <td class="${tone}"${interval}>${hasGames ? rate(hero.winRate) : '—'}</td>
      <td class="pick-cell">${rate(hero.pickRate)}</td>
      <td class="sample-cell">${count(hero.games)}</td>
      <td class="compare-cell"><button type="button" class="compare-button" data-compare="${hero.heroId}" aria-label="Compare ${escape(hero.name)}" aria-pressed="${compared}" aria-controls="comparison">${compared ? '−' : '+'}</button></td>
    </tr>`
  }).join('')

  $('pagination').hidden = false
  $('page-count').textContent = `${start + 1}–${start + rows.length} of ${count(matches.length)} heroes`
  $('previous-page').disabled = state.page === 1
  $('next-page').disabled = state.page === pages
}

function renderComparison() {
  const chosen = [...state.comparison].map(heroById).filter(Boolean)
  const body = $('comparison-body')
  $('clear-comparison').hidden = chosen.length === 0
  $('comparison-link').hidden = chosen.length === 0
  $('comparison-link').textContent = `Compare ${chosen.length}`
  $('compare-description').textContent = chosen.length
    ? `${activeRole()} (${$('rank-filter').selectedOptions[0]?.textContent ?? 'all ranks'})`
    : 'Add up to three heroes with +.'
  body.style.setProperty('--count', chosen.length || 1)
  body.innerHTML = chosen.map((hero) => {
    const id = hero.heroId ?? hero.id
    return `<article class="compare-card">
      <button type="button" class="hero-select" data-hero="${id}" aria-label="View items for ${escape(hero.name)}" aria-controls="item-section">${thumbnail('heroes', hero.slug)}${escape(hero.name)}</button>
      <button type="button" class="compare-button" data-compare="${id}" aria-label="Remove ${escape(hero.name)} from comparison">×</button>
      <dl class="compare-metrics">
        <div><dt>Win rate</dt><dd>${rate(hero.winRate)}</dd></div>
        <div><dt>Pick rate</dt><dd>${rate(hero.pickRate)}</dd></div>
        <div><dt>Matches</dt><dd>${count(hero.games ?? 0)}</dd></div>
        <div><dt>95% interval</dt><dd>${hero.games > 0 && Number.isFinite(hero.confidenceLow) ? `${rate(hero.confidenceLow)}–${rate(hero.confidenceHigh)}` : '—'}</dd></div>
      </dl>
    </article>`
  }).join('')
}

function renderHeroFeature() {
  const hero = heroById(state.selected)
  const picture = $('featured-image')
  $('build-link').href = hero ? `/efficiency?heroId=${hero.heroId ?? hero.id}` : '/efficiency'
  const profile = $('featured-profile')
  profile.hidden = !hero?.slug
  if (!profile.hidden) {
    const role = ['all', 'unknown'].includes(state.role) ? '' : `?role=${encodeURIComponent(state.role)}`
    profile.href = `/hero/${encodeURIComponent(hero.slug)}${role}`
    profile.setAttribute('aria-label', `${hero.name} hero guide`)
  }
  if (!hero) {
    picture.hidden = true
    $('detail-heading').textContent = 'Select a hero'
    $('featured-record').textContent = ''
    return
  }
  const source = asset('heroes', hero.slug)
  if (!source) picture.hidden = true
  else if (picture.getAttribute('src') !== source) {
    picture.src = source
    picture.hidden = false
  }
  $('detail-heading').textContent = hero.name
  $('featured-record').textContent = hero.games > 0
    ? `Won ${rate(hero.winRate)} of ${count(hero.games)} ${hero.games === 1 ? 'match' : 'matches'}`
    : 'No matches for these filters'
}

function itemNotice(title, description) {
  return `<div class="file-note"><strong>${escape(title)}</strong>${description ? `<span>${escape(description)}</span>` : ''}</div>`
}

function renderItems() {
  const hero = heroById(state.selected)
  const result = state.itemData
  const body = $('item-body')
  const status = $('item-coverage')
  const context = $('item-context')
  status.textContent = ''

  if (!hero) {
    context.textContent = ''
    body.innerHTML = ''
    return
  }
  context.textContent = `First purchases (${activeRole().toLowerCase()})`
  if (state.itemError) {
    body.innerHTML = `${itemNotice('Purchase results could not load')}<button type="button" class="plain-button" data-retry-items>Retry</button>`
    return
  }
  if (!result) {
    body.innerHTML = itemNotice('Loading purchases…')
    return
  }

  status.textContent = `${count(result.parsedGames)} of ${count(result.windowGames)} games in this time range have purchase logs`
  if (!result.rows.length) {
    if (!result.heroGames) {
      body.innerHTML = itemNotice('No games for these filters', 'Try all roles or a different match rank.')
    } else if (!result.windowGames) {
      body.innerHTML = itemNotice('No games reached this window', 'Choose an earlier purchase window.')
    } else if (!result.parsedGames) {
      body.innerHTML = itemNotice('No purchase logs in this window', 'Try a different purchase window.')
    } else {
      body.innerHTML = itemNotice('Not enough comparable purchases', `Each item needs at least ${result.minGroup} games with a purchase and ${result.minGroup} without one in this window.`)
    }
    return
  }

  const unranked = result.rows.filter((item) => item.rank == null).length
  const sampleNote = unranked > 0
    ? `<p class="sample-note">${unranked === result.rows.length ? 'Exploratory results only.' : 'Muted rows are exploratory.'} Ranking requires at least ${count(result.minGroup)} games in each group.</p>`
    : ''
  const rows = result.rows.map((item) => {
    const tone = item.rank == null || !item.winRateDifference
      ? 'neutral' : item.winRateDifference > 0 ? 'positive' : 'negative'
    const details = `${count(item.buyers)} buyers at ${rate(item.buyerWinRate)} and ${count(item.nonBuyers)} comparisons at ${rate(item.nonBuyerWinRate)}`
    return `<tr>
      <td><div class="hero-identity">${thumbnail('items', item.slug)}<div><div class="item-name">${escape(item.name)}</div>${Number.isFinite(item.cost) ? `<div class="subtle">${count(item.cost)} gold</div>` : ''}</div></div></td>
      <td>${rate(item.buyerWinRate)}</td>
      <td class="${tone}" title="${escape(details)}">${delta(item.winRateDifference)}</td>
      <td title="${escape(details)}">${count(item.buyers)} / ${count(item.nonBuyers)}</td>
      <td>${time(item.medianPurchaseTime)}</td>
    </tr>`
  }).join('')
  body.innerHTML = `${sampleNote}<div class="scroll-table"><table class="item-table">
    <thead><tr><th scope="col">Item</th><th scope="col">Buyer win rate</th><th scope="col" title="Buyer minus comparison win rate">Win gap</th><th scope="col" title="Buyer and comparison sample sizes">Games</th><th scope="col" title="Median first purchase time">Time</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <details class="item-disclosure"><summary>How to read the item table</summary><p>Games lists buyers first and comparison games second. Win gap is buyer win rate minus comparison win rate in percentage points. Time is the median first purchase.</p></details>`
}

async function loadHeroes() {
  state.heroRequest?.abort()
  const request = new AbortController()
  state.heroRequest = request
  const query = matchFilters()
  query.set('minGames', state.minGames)
  state.heroData = null
  state.heroError = false
  $('hero-cohort').textContent = 'Loading match counts…'
  renderHeroRows()
  try {
    const result = await fetchData(`/api/heroes?${query}`, request.signal)
    if (request.signal.aborted) return
    state.heroData = result
    renderCoverage(result)
    if (state.selected == null) {
      state.selected = result.rows.find((hero) => hero.games > 0)?.heroId
        ?? result.rows.find((hero) => hero.slug === 'pangolier')?.heroId
        ?? result.rows[0]?.heroId ?? null
    }
    renderHeroRows()
    renderComparison()
    renderHeroFeature()
    void loadItems()
  } catch (error) {
    if (request.signal.aborted) return
    state.heroError = true
    renderHeroRows()
  }
}

async function loadItems() {
  state.itemRequest?.abort()
  const request = new AbortController()
  state.itemRequest = request
  state.itemData = null
  state.itemError = false
  renderItems()
  if (state.selected == null) return
  const query = matchFilters()
  query.set('heroId', state.selected)
  query.set('window', state.window)
  query.set('minGroup', state.minGroup)
  try {
    const result = await fetchData(`/api/items?${query}`, request.signal)
    if (request.signal.aborted) return
    state.itemData = result
  } catch (error) {
    if (request.signal.aborted) return
    state.itemError = true
  }
  renderItems()
}

function syncGroup(id, field, value) {
  for (const control of $(id).querySelectorAll(`[data-${field}]`)) {
    control.setAttribute('aria-pressed', String(control.dataset[field] === value))
  }
}

function applyFilters() {
  state.page = 1
  state.itemRequest?.abort()
  state.itemData = null
  state.itemError = false
  renderItems()
  void loadHeroes()
}

function chooseHero(id) {
  if (state.selected === id) return
  state.selected = id
  renderHeroRows()
  renderHeroFeature()
  void loadItems()
  $('announcements').textContent = `Showing item results for ${heroById(id)?.name ?? 'selected hero'}`
}

function toggleComparison(id) {
  if (state.comparison.has(id)) state.comparison.delete(id)
  else if (state.comparison.size < 3) state.comparison.add(id)
  else {
    const message = 'Remove a hero before adding another.'
    $('compare-description').textContent = message
    $('announcements').textContent = message
    return
  }
  renderHeroRows()
  renderComparison()
  $('announcements').textContent = `${state.comparison.size} of three heroes selected for comparison`
}

function handleHeroAction(event) {
  const origin = event.currentTarget
  if (event.target.closest('[data-retry-heroes]')) {
    void loadHeroes()
    return
  }
  const compareButton = event.target.closest('[data-compare]')
  if (compareButton) {
    const id = Number(compareButton.dataset.compare)
    toggleComparison(id)
    const nextButton = origin.querySelector(`[data-compare="${id}"]`)
      ?? $('hero-rows').querySelector(`[data-compare="${id}"]`)
    nextButton?.focus({ preventScroll: true })
    return
  }
  const selectButton = event.target.closest('[data-hero]')
  const clickedRow = event.target.closest('[data-row]')
  const id = Number(selectButton?.dataset.hero ?? clickedRow?.dataset.row)
  if (!Number.isInteger(id)) return
  chooseHero(id)
  if (window.matchMedia('(max-width: 860px)').matches) {
    $('detail-heading').tabIndex = -1
    $('detail-heading').focus()
    return
  }
  origin.querySelector(`[data-hero="${id}"]`)?.focus({ preventScroll: true })
}

$('role-tabs').addEventListener('click', (event) => {
  const control = event.target.closest('[data-role]')
  if (!control || control.dataset.role === state.role) return
  state.role = control.dataset.role
  syncGroup('role-tabs', 'role', state.role)
  applyFilters()
})
$('rank-filter').addEventListener('change', (event) => {
  state.rank = event.target.value
  applyFilters()
})
$('verified-filter').addEventListener('change', (event) => {
  state.patchConfidence = event.target.checked ? 'verified' : 'all'
  applyFilters()
})
$('observed-filter').addEventListener('change', (event) => {
  state.roleConfidence = event.target.checked ? 'observed' : 'all'
  applyFilters()
})
$('sample-filter').addEventListener('change', (event) => {
  const value = event.target.valueAsNumber
  state.minGames = Number.isFinite(value) ? Math.min(10000, Math.max(1, Math.floor(value))) : 5
  event.target.value = state.minGames
  applyFilters()
})
$('item-sample-filter').addEventListener('change', (event) => {
  const value = event.target.valueAsNumber
  state.minGroup = Number.isFinite(value) ? Math.min(10000, Math.max(1, Math.floor(value))) : 5
  event.target.value = state.minGroup
  void loadItems()
})
$('filter-toggle').addEventListener('click', (event) => {
  const toggle = event.currentTarget
  const open = toggle.getAttribute('aria-expanded') === 'true'
  toggle.setAttribute('aria-expanded', String(!open))
  $('filter-details').hidden = open
})
$('window-tabs').addEventListener('click', (event) => {
  const control = event.target.closest('[data-window]')
  if (!control || control.dataset.window === state.window) return
  state.window = control.dataset.window
  syncGroup('window-tabs', 'window', state.window)
  void loadItems()
})
$('hero-search').addEventListener('input', () => {
  state.page = 1
  renderHeroRows()
})
$('next-page').addEventListener('click', () => { state.page += 1; renderHeroRows() })
$('previous-page').addEventListener('click', () => { state.page -= 1; renderHeroRows() })
$('hero-rows').addEventListener('click', handleHeroAction)
$('comparison-body').addEventListener('click', handleHeroAction)
$('item-body').addEventListener('click', (event) => {
  if (event.target.closest('[data-retry-items]')) void loadItems()
})
$('clear-comparison').addEventListener('click', () => {
  state.comparison.clear()
  renderHeroRows()
  renderComparison()
  $('compare-heading').tabIndex = -1
  $('compare-heading').focus()
})
document.addEventListener('error', (event) => {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true
}, true)

async function start() {
  try {
    state.meta = await fetchData('/api/meta')
    renderMetadata()
    await loadHeroes()
  } catch (error) {
    const note = $('dataset-note')
    note.textContent = 'Match data could not be loaded. '
    const retry = document.createElement('button')
    retry.textContent = 'Retry'
    retry.className = 'plain-button'
    retry.addEventListener('click', start)
    note.append(retry)
    note.classList.add('is-error')
    $('hero-cohort').textContent = 'Dataset unavailable'
    state.heroError = true
    renderHeroRows()
  }
}

void start()
