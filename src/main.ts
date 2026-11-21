import { AmmoraDataApiClient, giwaSepoliaAutoRouteDeployment } from '@ammora-protocol/sdk';
import { createPublicClient, defineChain, http } from 'viem';
import './style.css';

type LaunchRow = { name: string; symbol: string; address: string; status: string; raw: unknown };
const CHAIN_ID = 91342;
const API_URL = 'https://ammora-giwa-sepolia-data.fly.dev';
const app = document.querySelector<HTMLDivElement>('#app')!;
let allLaunches: LaunchRow[] = [];
let connectedAddress = '';
let rpcStatus = 'Checking network';

const short = (s: string) => s ? `${s.slice(0, 6)}…${s.slice(-4)}` : '—';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function toRows(payload: any): LaunchRow[] {
  const items = Array.isArray(payload) ? payload : payload?.launches ?? payload?.items ?? payload?.data ?? [];
  if (!Array.isArray(items)) return [];
  return items.map((x: any) => ({
    name: x.name ?? x.tokenName ?? x.metadata?.name ?? 'Unnamed launch',
    symbol: x.symbol ?? x.tokenSymbol ?? x.metadata?.symbol ?? '—',
    address: x.tokenAddress ?? x.token ?? x.address ?? x.token_address ?? '',
    status: x.status ?? x.stage ?? (x.graduated ? 'Graduated' : 'Live'),
    raw: x
  }));
}

function render() {
  app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="#top"><span class="brand-mark">A</span><span>AMMORA<span class="brand-sub">LAUNCHPAD STUDIO</span></span></a>
      <div class="top-actions"><span class="network"><i></i> GIWA SEPOLIA · ${CHAIN_ID}</span><button id="connect" class="wallet-btn">${connectedAddress ? short(connectedAddress) : 'Connect wallet'}</button></div>
    </header>
    <main id="top">
      <section class="hero">
        <div class="eyebrow"><span class="pulse"></span> BUILT WITH AMMORA SDK 0.3.9</div>
        <h1>Launch ideas.<br><em>Build markets.</em></h1>
        <p class="hero-copy">A focused launchpad workspace for GIWA Sepolia. Explore token launches, inspect market status and prepare a launch configuration — without risking real funds.</p>
        <div class="hero-meta"><span>NETWORK <b>GIWA SEPOLIA</b></span><span>CHAIN ID <b>${CHAIN_ID}</b></span><span>MODE <b>READ-ONLY / TESTNET</b></span></div>
      </section>
      <section class="stats-grid">
        <article class="stat-card"><span>SDK DEPLOYMENT</span><strong id="sdk-version">0.3.9</strong><small>Auto-route · V4 catalog</small></article>
        <article class="stat-card"><span>DISCOVERED LAUNCHES</span><strong id="launch-count">—</strong><small>GIWA Sepolia index</small></article>
        <article class="stat-card"><span>WALLET</span><strong id="wallet-state">Not connected</strong><small id="wallet-detail">Connect only if you want to</small></article>
        <article class="stat-card"><span>RPC STATUS</span><strong id="rpc-state">Checking</strong><small id="rpc-detail">Public read endpoint</small></article>
      </section>
      <section class="section-head"><div><div class="eyebrow">01 / MARKET DIRECTORY</div><h2>Explore launches</h2><p>Live launch records returned by Ammora's GIWA Sepolia Data API.</p></div><button id="refresh" class="outline-btn">↻ Refresh data</button></section>
      <section class="directory-panel">
        <div class="directory-toolbar"><div class="search-wrap"><span>⌕</span><input id="search" placeholder="Search by token, symbol or address" /></div><span id="data-status" class="muted">Loading launches…</span></div>
        <div class="table-wrap"><table><thead><tr><th>PROJECT</th><th>TOKEN ADDRESS</th><th>STAGE</th><th></th></tr></thead><tbody id="launch-rows"><tr><td colspan="4" class="empty">Connecting to Ammora Data API…</td></tr></tbody></table></div>
      </section>
      <section class="builder-grid">
        <div class="builder-intro"><div class="eyebrow">02 / LAUNCH CONFIGURATOR</div><h2>Shape your<br><em>next launch.</em></h2><p>Draft a launch brief and review the parameters before any wallet action. This first release intentionally does not submit transactions or spend test ETH.</p><div class="safety-note"><span>◎</span><div><b>Safe by default</b><small>No private keys, approvals or transactions are requested by this configurator.</small></div></div><div class="policy-note"><b>Protocol safety notice</b><small>Do not reuse the quarantined GIWA Registry Config #6. Ammora documents a graduation-readiness issue. Any future launch flow must select and independently verify a qualified Config first.</small></div></div>
        <form id="launch-form" class="form-panel">
          <div class="form-title"><div><span>NEW LAUNCH</span><h3>Configuration draft</h3></div><span class="draft-pill">LOCAL DRAFT</span></div>
          <label>Token name<input id="token-name" maxlength="32" placeholder="e.g. Aurora Protocol" required /></label>
          <div class="two-col"><label>Token symbol<input id="token-symbol" maxlength="10" placeholder="AURA" required /></label><label>Token supply<input id="token-supply" inputmode="numeric" placeholder="1000000000" required /></label></div>
          <label>Project description<textarea id="token-description" maxlength="240" rows="3" placeholder="What is this project building?"></textarea></label>
          <div class="form-foot"><span>Preview only · Stored in this browser session</span><button class="primary-btn" type="submit">Preview launch brief ↗</button></div>
          <div id="draft-output" class="draft-output" hidden></div>
        </form>
      </section>
      <section class="bottom-strip"><div><span class="eyebrow">BUILT FOR THE AMMORA ECOSYSTEM</span><p>Powered by <b>@ammora-protocol/sdk 0.3.9</b> · GIWA Sepolia testnet</p></div><a href="https://docs.ammora.org/" target="_blank" rel="noreferrer">Developer documentation ↗</a></section>
    </main>
    <footer><span>AMMORA LAUNCHPAD STUDIO</span><span>Independent community build · Testnet only</span><span>© 2026</span></footer>
  </div>`;
  bind();
}

function bind() {
  document.querySelector('#connect')?.addEventListener('click', connectWallet);
  document.querySelector('#refresh')?.addEventListener('click', loadLaunches);
  document.querySelector<HTMLInputElement>('#search')?.addEventListener('input', e => renderRows((e.target as HTMLInputElement).value));
  document.querySelector<HTMLFormElement>('#launch-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const name = (document.querySelector<HTMLInputElement>('#token-name')!).value.trim();
    const symbol = (document.querySelector<HTMLInputElement>('#token-symbol')!).value.trim().toUpperCase();
    const supply = (document.querySelector<HTMLInputElement>('#token-supply')!).value.trim();
    const desc = (document.querySelector<HTMLTextAreaElement>('#token-description')!).value.trim();
    if (!name || !symbol || !/^\d+$/.test(supply) || BigInt(supply) <= 0n) { alert('Enter a token name, symbol and a positive whole-number supply.'); return; }
    const out = document.querySelector<HTMLDivElement>('#draft-output')!;
    out.hidden = false;
    out.innerHTML = `<div class="draft-label">LOCAL PREVIEW · NOT DEPLOYED</div><h4>${esc(name)} <span>${esc(symbol)}</span></h4><p>Total supply: <b>${Number(supply).toLocaleString('en-US')}</b></p><p>${esc(desc || 'No description provided.')}</p><small>Next engineering step: validate quote asset, fee recipients and launch parameters against the selected GIWA deployment before generating an unsigned SDK plan.</small>`;
    out.scrollIntoView({behavior:'smooth', block:'nearest'});
  });
}

async function connectWallet() {
  const eth = (window as any).ethereum;
  if (!eth) { alert('No EVM wallet detected. You can still use the launch directory and configurator without connecting.'); return; }
  try {
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    const chainHex = await eth.request({ method: 'eth_chainId' });
    if (Number.parseInt(chainHex, 16) !== CHAIN_ID) {
      alert('Please switch your wallet to GIWA Sepolia (chain ID 91342). No network switch or transaction was requested.');
      return;
    }
    connectedAddress = accounts[0] ?? '';
    const button = document.querySelector<HTMLButtonElement>('#connect');
    if (button) button.textContent = short(connectedAddress);
    document.querySelector('#wallet-state')!.textContent = 'Connected';
    document.querySelector('#wallet-detail')!.textContent = short(connectedAddress);
  } catch (err: any) { alert(err?.message ?? 'Wallet connection was cancelled.'); }
}

function renderRows(filter = '') {
  const tbody = document.querySelector<HTMLTableSectionElement>('#launch-rows');
  if (!tbody) return;
  const q = filter.toLowerCase();
  const rows = allLaunches.filter(x => `${x.name} ${x.symbol} ${x.address}`.toLowerCase().includes(q));
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">${allLaunches.length ? 'No launches match your search.' : 'No indexed launches returned yet. Try refreshing later.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(x => `<tr><td><div class="token-name"><span class="token-icon">${esc((x.symbol || '?').slice(0,1))}</span><span><b>${esc(x.name)}</b><small>${esc(x.symbol)}</small></span></div></td><td class="mono">${x.address ? `${esc(short(x.address))} <button class="copy" data-copy="${esc(x.address)}" title="Copy address">⧉</button>` : '—'}</td><td><span class="stage">${esc(x.status)}</span></td><td><button class="view-btn" data-details="${esc(x.address)}">Inspect ↗</button></td></tr>`).join('');
  tbody.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach(b => b.addEventListener('click', () => navigator.clipboard?.writeText(b.dataset.copy ?? '')));
  tbody.querySelectorAll<HTMLButtonElement>('[data-details]').forEach(b => b.addEventListener('click', () => {
    const item = rows.find(x => x.address === b.dataset.details);
    if (item) alert(JSON.stringify(item.raw, null, 2).slice(0, 5000));
  }));
}

async function loadLaunches() {
  const status = document.querySelector('#data-status');
  if (status) status.textContent = 'Refreshing…';
  try {
    const api = new AmmoraDataApiClient(API_URL);
    const result = await api.getLaunches({ chainId: BigInt(CHAIN_ID) });
    allLaunches = toRows(result);
    document.querySelector('#launch-count')!.textContent = String(allLaunches.length);
    if (status) status.textContent = `Updated ${new Date().toLocaleTimeString()} · ${allLaunches.length} records`;
    renderRows((document.querySelector<HTMLInputElement>('#search')?.value) ?? '');
  } catch (err: any) {
    if (status) status.textContent = 'Data API unavailable — retry later';
    const tbody = document.querySelector('#launch-rows');
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="empty">Could not load the index. ${esc(err?.message ?? 'Network error')}</td></tr>`;
  }
}

async function checkRpc() {
  try {
    const deployment = giwaSepoliaAutoRouteDeployment;
    if (deployment.chain.id !== CHAIN_ID) throw new Error('Unexpected SDK chain catalog');
    if (deployment.contracts.launch.protocolVersion !== 4) throw new Error('Unexpected launch protocol version');
    const rpcUrl = deployment.chain.rpcUrls[0];
    if (!rpcUrl) throw new Error('SDK deployment catalog has no public RPC URL');
    const chainConfig = defineChain({ id: deployment.chain.id, name: deployment.chain.name, nativeCurrency: deployment.chain.nativeCurrency, rpcUrls: { default: { http: [rpcUrl] } } });
    const client = createPublicClient({ chain: chainConfig, transport: http(rpcUrl) });
    const actualChainId = await client.getChainId();
    rpcStatus = actualChainId === CHAIN_ID ? 'Online' : `Chain ${actualChainId}`;
    document.querySelector('#rpc-state')!.textContent = rpcStatus;
    document.querySelector('#rpc-detail')!.textContent = 'GIWA Sepolia RPC · read-only';
  } catch (err: any) {
    document.querySelector('#rpc-state')!.textContent = 'Unavailable';
    document.querySelector('#rpc-detail')!.textContent = err?.message ?? 'Could not verify RPC';
  }
}

render();
loadLaunches();
checkRpc();
