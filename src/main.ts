import { AmmoraDataApiClient, giwaSepoliaAutoRouteDeployment, giwaSepoliaAutoRoute, resolveAmmoraFinalizedHead, verifyAmmoraV4CoreAtBlock, getAmmoraV4NextConfigId, getAmmoraV4ConfigAtBlock } from '@ammora-protocol/sdk';
import { createPublicClient, custom, defineChain, http, type Transport } from 'viem';
import './style.css';

type LaunchRow = { name: string; symbol: string; address: string; status: string; raw: unknown };
type ConfigRow = { configId: string; enabled: boolean; configHash: string; owner: string; feeClaimer: string; quoteToken: string; migrationMode: string; segments: number };
const CHAIN_ID = 91342;
const API_URL = 'https://ammora-giwa-sepolia-data.fly.dev';

// GIWA's free public RPC is rate-limited. Serialize every SDK JSON-RPC request
// instead of allowing bursts from parallel contract reads.
function pacedHttp(url: string, intervalMs = 650): Transport {
  const base = http(url, { retryCount: 0, timeout: 15_000 });
  let tail: Promise<unknown> = Promise.resolve();
  let nextStart = 0;
  return (parameters) => {
    const transport = base(parameters);
    return custom({
      request: (args) => {
        const result = tail.then(async () => {
          await new Promise(resolve => setTimeout(resolve, Math.max(0, nextStart - Date.now())));
          try {
            return await transport.request(args);
          } finally {
            nextStart = Date.now() + intervalMs;
          }
        });
        tail = result.catch(() => undefined);
        return result;
      },
    }, { retryCount: 0 })(parameters);
  };
}
const app = document.querySelector<HTMLDivElement>('#app')!;
let allLaunches: LaunchRow[] = [];
let configs: ConfigRow[] = [];
let connectedAddress = '';
let rpcStatus = 'Checking network';
let publicClient: ReturnType<typeof createPublicClient> | undefined;
let verifiedBlock: bigint | undefined;
let activeRpcUrl = '';
let readClientPromise: Promise<void> | undefined;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ]);
}

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
        <p class="hero-copy">A focused launchpad workspace for GIWA Sepolia. Read live on-chain launch configurations, inspect market status and prepare a launch brief — without risking real funds.</p>
        <div class="hero-meta"><span>NETWORK <b>GIWA SEPOLIA</b></span><span>CHAIN ID <b>${CHAIN_ID}</b></span><span>MODE <b>READ-ONLY / TESTNET</b></span></div>
      </section>
      <section class="stats-grid">
        <article class="stat-card"><span>SDK DEPLOYMENT</span><strong id="sdk-version">0.3.9</strong><small>Auto-route · V4 catalog</small></article>
        <article class="stat-card"><span>ON-CHAIN CONFIGS</span><strong id="config-count">—</strong><small>Verified GIWA Sepolia registry</small></article>
        <article class="stat-card"><span>WALLET</span><strong id="wallet-state">Not connected</strong><small id="wallet-detail">Connect only if you want to</small></article>
        <article class="stat-card"><span>RPC STATUS</span><strong id="rpc-state">Checking</strong><small id="rpc-detail">Public read endpoint</small></article>
      </section>
      <section class="section-head"><div><div class="eyebrow">01 / ON-CHAIN REGISTRY</div><h2>Verified launch configs</h2><p>Read directly from Ammora's GIWA Sepolia V4 registry at one finalized block. No Data API dependency.</p></div><button id="refresh-configs" class="outline-btn">↻ Read on-chain</button></section>
      <section class="directory-panel">
        <div class="directory-toolbar"><span id="config-status" class="muted">Checking deployment and registry…</span><span id="config-block" class="muted"></span></div>
        <div class="table-wrap"><table><thead><tr><th>CONFIG</th><th>QUOTE TOKEN</th><th>OWNER</th><th>STATUS</th></tr></thead><tbody id="config-rows"><tr><td colspan="4" class="empty">Verifying GIWA deployment…</td></tr></tbody></table></div>
      </section>
      <section class="section-head"><div><div class="eyebrow">02 / OPTIONAL INDEX</div><h2>Explore launches</h2><p>Indexed launch records from Ammora's Data API. This service is separate from the on-chain registry.</p></div><button id="refresh" class="outline-btn">↻ Refresh data</button></section>
      <section class="directory-panel">
        <div class="directory-toolbar"><div class="search-wrap"><span>⌕</span><input id="search" placeholder="Search by token, symbol or address" /></div><span id="data-status" class="muted">Optional index loading…</span></div>
        <div class="table-wrap"><table><thead><tr><th>PROJECT</th><th>TOKEN ADDRESS</th><th>STAGE</th><th></th></tr></thead><tbody id="launch-rows"><tr><td colspan="4" class="empty">Connecting to Ammora Data API…</td></tr></tbody></table></div>
      </section>
      <section class="builder-grid">
        <div class="builder-intro"><div class="eyebrow">03 / LAUNCH CONFIGURATOR</div><h2>Shape your<br><em>next launch.</em></h2><p>Draft a launch brief and review the parameters before any wallet action. This release does not submit transactions or spend test ETH.</p><div class="safety-note"><span>◎</span><div><b>Safe by default</b><small>No private keys, approvals or transactions are requested by this configurator.</small></div></div><div class="policy-note"><b>Protocol safety notice</b><small>Do not reuse the quarantined GIWA Registry Config #6. Select only an enabled config after reviewing its on-chain parameters and protocol guidance.</small></div></div>
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
  document.querySelector('#refresh-configs')?.addEventListener('click', loadConfigs);
  document.querySelector<HTMLInputElement>('#search')?.addEventListener('input', e => renderRows((e.target as HTMLInputElement).value));
  document.querySelector<HTMLFormElement>('#launch-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const name = (document.querySelector<HTMLInputElement>('#token-name')!).value.trim();
    const symbol = (document.querySelector<HTMLInputElement>('#token-symbol')!).value.trim().toUpperCase();
    const supply = (document.querySelector<HTMLInputElement>('#token-supply')!).value.trim();
    const desc = (document.querySelector<HTMLTextAreaElement>('#token-description')!).value.trim();
    if (!name || !symbol || !/^\\d+$/.test(supply) || BigInt(supply) <= 0n) { alert('Enter a token name, symbol and a positive whole-number supply.'); return; }
    const out = document.querySelector<HTMLDivElement>('#draft-output')!;
    out.hidden = false;
    out.innerHTML = `<div class="draft-label">LOCAL PREVIEW · NOT DEPLOYED</div><h4>${esc(name)} <span>${esc(symbol)}</span></h4><p>Total supply: <b>${BigInt(supply).toLocaleString('en-US')}</b></p><p>${esc(desc || 'No description provided.')}</p><small>This is a local brief only. No token or on-chain launch has been created.</small>`;
    out.scrollIntoView({behavior:'smooth', block:'nearest'});
  });
}

async function ensureReadClient() {
  if (publicClient && verifiedBlock !== undefined) return;
  if (readClientPromise) return readClientPromise;
  readClientPromise = ensureReadClientInternal();
  try {
    await readClientPromise;
  } finally {
    readClientPromise = undefined;
  }
}

async function ensureReadClientInternal() {
  const deployment = giwaSepoliaAutoRouteDeployment;
  if (deployment.chain.id !== CHAIN_ID || deployment.contracts.launch.protocolVersion !== 4) {
    throw new Error('Unexpected SDK deployment catalog');
  }

  // Prefer the SDK catalog endpoint, then try GIWA's documented public endpoints.
  const candidates = [...new Set([
    deployment.chain.rpcUrls[0],
    'https://sepolia-rpc.giwa.io',
    'https://sepolia-rpc-flashblocks.giwa.io',
  ].filter((url): url is string => Boolean(url)))];

  const failures: string[] = [];
  for (const rpcUrl of candidates) {
    const host = new URL(rpcUrl).host;
    const status = document.querySelector('#config-status');
    if (status) status.textContent = `Connecting to ${host}…`;
    document.querySelector('#rpc-state')!.textContent = 'Connecting';
    document.querySelector('#rpc-detail')!.textContent = host;
    try {
      const chainConfig = defineChain({
        id: deployment.chain.id,
        name: deployment.chain.name,
        nativeCurrency: deployment.chain.nativeCurrency,
        rpcUrls: { default: { http: [rpcUrl] } },
      });
      const client = createPublicClient({
        chain: chainConfig,
        transport: pacedHttp(rpcUrl),
      });
      const actualChainId = await withTimeout(client.getChainId(), 12_000, `${host} chain check`);
      if (actualChainId !== CHAIN_ID) {
        throw new Error(`RPC chain mismatch: expected ${CHAIN_ID}, received ${actualChainId}`);
      }

      const block = await withTimeout(
        resolveAmmoraFinalizedHead([client], giwaSepoliaAutoRoute.finality),
        25_000,
        `${host} finalized-head lookup`,
      );
      const registry = deployment.contracts.launch;
      await withTimeout(verifyAmmoraV4CoreAtBlock(client, {
        configRegistry: registry.configRegistry,
        launchFactory: registry.factory,
        graduationAdapter: registry.graduationAdapter,
        feePolicy: registry.feePolicy,
      }, block), 25_000, `${host} V4 verification`);

      publicClient = client;
      verifiedBlock = block;
      activeRpcUrl = rpcUrl;
      rpcStatus = 'Online';
      document.querySelector('#rpc-state')!.textContent = rpcStatus;
      document.querySelector('#rpc-detail')!.textContent = `V4 verified · ${new URL(rpcUrl).host}`;
      return;
    } catch (err: any) {
      failures.push(`${new URL(rpcUrl).host}: ${err?.shortMessage ?? err?.message ?? 'RPC request failed'}`);
    }
  }
  throw new Error(`All GIWA RPC endpoints failed. ${failures.join(' | ')}`);
}
async function loadConfigs() {
  const status = document.querySelector('#config-status');
  const tbody = document.querySelector('#config-rows');
  if (status) status.textContent = 'Checking RPC and Ammora V4 deployment…';
  if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="empty">Read-only verification in progress…</td></tr>';
  try {
    await ensureReadClient();
    if (status) status.textContent = `RPC online · V4 verified · reading registry at block ${verifiedBlock!.toString()}…`;
    const deployment = giwaSepoliaAutoRouteDeployment;
    const registry = deployment.contracts.launch.configRegistry;
    const block = verifiedBlock!;
    if (status) status.textContent = 'Reading registered Config count…';
    const nextId = await withTimeout(getAmmoraV4NextConfigId(publicClient!, registry, block), 15_000, 'Config count read');
    const total = nextId > 1n ? nextId - 1n : 0n;
    const count = Number(total > 3n ? 3n : total);
    configs = [];
    if (status) status.textContent = `Found ${total} registered configs · loading first ${count}…`;
    for (let i = 0; i < count; i++) {
      if (status) status.textContent = `Reading Config #${i + 1} of ${count}…`;
      configs.push(await withTimeout(
        getAmmoraV4ConfigAtBlock(publicClient!, registry, BigInt(i + 1), block),
        18_000,
        `Config #${i + 1} read`,
      ));
    }
    document.querySelector('#config-count')!.textContent = String(total);
    if (status) status.textContent = `Verified V4 registry · showing ${count} of ${total} configs`;
    const blockLabel = document.querySelector('#config-block');
    if (blockLabel) blockLabel.textContent = `Finalized block #${block.toString()} · ${new URL(activeRpcUrl).host}`;
    renderConfigs();
  } catch (err: any) {
    const detail = err?.shortMessage ?? err?.message ?? String(err ?? 'Read failed');
    if (status) status.textContent = 'On-chain registry unavailable · ' + detail;
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="empty">${esc(detail)}</td></tr>`;
    document.querySelector('#config-count')!.textContent = '—';
    // Keep RPC health separate from registry-read failures. The RPC can be online
    // and the V4 core verified even when a particular registry read times out.
    if (verifiedBlock === undefined) {
      document.querySelector('#rpc-state')!.textContent = 'Unavailable';
      document.querySelector('#rpc-detail')!.textContent = (err?.shortMessage ?? err?.message ?? 'RPC verification failed').slice(0, 180);
    } else {
      document.querySelector('#rpc-state')!.textContent = 'Online';
      document.querySelector('#rpc-detail')!.textContent = `V4 verified · ${new URL(activeRpcUrl).host}`;
    }
  }
}

function renderConfigs() {
  const tbody = document.querySelector<HTMLTableSectionElement>('#config-rows');
  if (!tbody) return;
  if (!configs.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No registered configs were found at the verified block.</td></tr>';
    return;
  }
  tbody.innerHTML = configs.map(c => `<tr><td><b>#${esc(c.configId)}</b><small class="mono">${esc(c.configHash.slice(0, 14))}…</small></td><td class="mono">${esc(short(c.quoteToken))}</td><td class="mono">${esc(short(c.owner))}</td><td><span class="stage">${c.enabled ? 'Enabled' : 'Disabled'}</span></td></tr>`).join('');
}

async function connectWallet() {
  const eth = (window as any).ethereum;
  if (!eth) { alert('No EVM wallet detected. You can still use the on-chain directory and configurator without connecting.'); return; }
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
    const result = await withTimeout(api.getLaunches({ chainId: BigInt(CHAIN_ID) }), 12_000, 'Ammora Data API');
    allLaunches = toRows(result);
    renderRows((document.querySelector<HTMLInputElement>('#search')?.value) ?? '');
    if (status) status.textContent = `Updated ${new Date().toLocaleTimeString()} · ${allLaunches.length} records`;
  } catch (err: any) {
    if (status) status.textContent = 'Data API unavailable — on-chain configs remain available above';
    const tbody = document.querySelector('#launch-rows');
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="empty">Optional index unavailable: ${esc(err?.shortMessage ?? err?.message ?? 'Network error')}</td></tr>`;
  }
}

async function checkRpc() {
  try {
    await ensureReadClient();
    await loadConfigs();
  } catch (err: any) {
    document.querySelector('#rpc-state')!.textContent = 'Unavailable';
    document.querySelector('#rpc-detail')!.textContent = err?.shortMessage ?? err?.message ?? 'Could not verify RPC';
  }
}

render();
loadLaunches();
checkRpc();
