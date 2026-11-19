(() => {
  const panel = document.getElementById('hero-farm-check');
  if (!panel) return;

  const marks = [5, 10, 15, 20, 25, 30];
  const tiers = ['bad', 'good', 'easy'];
  const bases = { 'gold-timeline': 'Timeline', 'full-match-gpm': 'Full game' };
  const count = new Intl.NumberFormat('en-US');
  const rate = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  const state = { role: null, checkpoints: null, loading: false };

  panel.classList.add('farm-check');
  panel.setAttribute('aria-labelledby', 'hero-farm-check-title');
  panel.innerHTML = `<details id="hero-farm-check-disclosure">
    <summary class="farm-check-heading"><strong id="hero-farm-check-title">Check your farm pace</strong><span class="subtle" id="hero-farm-check-role"></span></summary>
    <p id="hero-farm-check-status" class="farm-check-status subtle" role="status"></p>
    <button id="hero-farm-check-retry" class="profile-button farm-check-retry" type="button" hidden>Retry</button>
    <div class="farm-check-layout" id="hero-farm-check-body" hidden>
      <div class="farm-check-evidence">
        <table class="farm-check-table">
          <caption class="sr-only">Legend role farm checkpoints, comparing gold earned and average gold per minute</caption>
          <thead><tr><th scope="col">Minute</th><th scope="col">Bad</th><th scope="col">Good</th><th scope="col">Easy</th><th scope="col">Sample</th></tr></thead>
          <tbody id="hero-farm-check-rows"></tbody>
        </table>
        <details class="farm-check-method"><summary>How checkpoints are measured</summary>
          <p class="subtle">Bad, Good, and Easy show the 25th, 50th, and 85th percentiles of earned gold. The calculator treats the 25th percentile and below as Bad, the 85th and above as Easy, and the range between as Good.</p>
          <p class="subtle">Timeline uses gold recorded by that minute. Full game estimates that minute from whole-match GPM. Sample size counts Legend players in the selected position.</p>
        </details>
      </div>
      <div class="farm-check-estimate">
        <h3>Compare your pace</h3>
        <div class="farm-check-fields">
          <label for="hero-farm-check-minute">Game minute
            <select id="hero-farm-check-minute" class="select">${marks.map((minute) => `<option value="${minute}"${minute === 20 ? ' selected' : ''}>${minute}:00</option>`).join('')}</select>
          </label>
          <label for="hero-farm-check-earned">Estimated earned gold
            <input id="hero-farm-check-earned" type="number" inputmode="numeric" min="0" step="1" aria-describedby="hero-farm-check-help">
          </label>
        </div>
        <p id="hero-farm-check-help" class="subtle">Add unspent gold and gold already spent, then subtract starting gold. Sales, death penalties, and untracked consumables can affect your estimate.</p>
        <output class="farm-check-result" id="hero-farm-check-result" for="hero-farm-check-minute hero-farm-check-earned" role="status"></output>
      </div>
    </div>
  </details>`;

  const find = (fragment) => document.getElementById(`hero-farm-check-${fragment}`);
  const roleLabel = find('role');
  const disclosure = find('disclosure');
  const status = find('status');
  const retry = find('retry');
  const body = find('body');
  const rows = find('rows');
  const minuteInput = find('minute');
  const earnedInput = find('earned');
  const result = find('result');

  function checkpointAt(minute) {
    return state.checkpoints?.get(state.role)?.checkpoints.find((entry) => entry.minute === minute);
  }

  function updatePace() {
    const minute = Number(minuteInput.value);
    for (const row of rows.rows) row.classList.toggle('active', Number(row.dataset.minute) === minute);
    const earned = earnedInput.valueAsNumber;
    const checkpoint = checkpointAt(minute);
    result.replaceChildren();
    if (earnedInput.validity.badInput || (earnedInput.value !== '' && !Number.isSafeInteger(earned)) || earned < 0) {
      result.textContent = 'Enter a whole amount of gold, zero or higher.';
      return;
    }
    if (earnedInput.value === '') return;
    if (!Number.isFinite(checkpoint?.bad?.gold) || !Number.isFinite(checkpoint?.easy?.gold)) {
      result.textContent = 'No farm comparison is available for that minute.';
      return;
    }
    const low = checkpoint.bad.gold;
    const high = checkpoint.easy.gold;
    if (low === high && earned === low) {
      result.textContent = 'The tiers overlap at this minute. Try another checkpoint.';
      return;
    }
    const pace = earned <= low ? 'Bad' : earned >= high ? 'Easy' : 'Good';
    const title = document.createElement('strong');
    title.dataset.pace = pace.toLowerCase();
    title.textContent = `${pace} farm pace`;
    const average = document.createElement('span');
    average.textContent = `${rate.format(earned / minute)} GPM through minute ${minute}.`;
    result.append(title, average);
    const next = pace === 'Bad' ? { label: 'Good', cutoff: low + 1 } : pace === 'Good' ? { label: 'Easy', cutoff: high } : null;
    if (next) {
      const gap = document.createElement('span');
      gap.textContent = `${count.format(next.cutoff - earned)}g to ${next.label} pace at this checkpoint.`;
      result.append(gap);
    }
    const build = document.createElement('a');
    build.className = 'text-link';
    build.href = `#profile-build-${pace.toLowerCase()}`;
    build.textContent = `View ${pace.toLowerCase()} farm items`;
    result.append(build);
  }

  function thresholdCell(value) {
    return Number.isFinite(value?.gold) && Number.isFinite(value?.gpm)
      ? `<td><strong>${count.format(value.gold)}g</strong><span>${rate.format(value.gpm)} GPM</span></td>`
      : '<td>—</td>';
  }

  function renderCheckpoints() {
    const selected = state.checkpoints?.get(state.role);
    if (!selected) {
      body.hidden = true;
      if (state.checkpoints) status.textContent = 'Farm checkpoints are unavailable for this role.';
      return;
    }
    roleLabel.textContent = `${selected.label} in Legend`;
    rows.innerHTML = marks.map((minute) => {
      const checkpoint = checkpointAt(minute);
      const basis = Object.hasOwn(bases, checkpoint?.basis) ? bases[checkpoint.basis] : null;
      const sample = basis && Number.isFinite(checkpoint.sampleSize)
        ? `<strong>${count.format(checkpoint.sampleSize)}</strong><span>${basis}</span>` : '—';
      return `<tr data-minute="${minute}"><th scope="row">${minute}:00</th>
        ${tiers.map((tier) => thresholdCell(checkpoint?.[tier])).join('')}<td>${sample}</td></tr>`;
    }).join('');
    status.textContent = '';
    body.hidden = false;
    updatePace();
  }

  async function loadCheckpoints() {
    if (state.loading) return;
    state.loading = true;
    retry.hidden = true;
    status.textContent = 'Loading farm checkpoints…';
    try {
      const response = await fetch('/api/hero-farm-check');
      if (!response.ok) throw new Error(`Farm checkpoints API returned ${response.status}`);
      const { roles } = await response.json();
      state.checkpoints = new Map(roles.map((entry) => [entry.key, entry]));
      renderCheckpoints();
    } catch (error) {
      status.textContent = 'Farm checkpoints could not load.';
      retry.hidden = false;
      console.error(error);
    } finally {
      state.loading = false;
    }
  }

  minuteInput.addEventListener('change', updatePace);
  earnedInput.addEventListener('input', updatePace);
  retry.addEventListener('click', () => { void loadCheckpoints(); });
  disclosure.addEventListener('toggle', () => {
    if (disclosure.open && !state.checkpoints) void loadCheckpoints();
  });
  document.addEventListener('hero-farm-check-role', (event) => {
    const role = event.detail?.role;
    if (!role || role === state.role) return;
    state.role = role;
    panel.hidden = false;
    if (state.checkpoints) renderCheckpoints();
    else if (disclosure.open) void loadCheckpoints();
  });
})();
