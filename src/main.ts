import { AmmoraDataApiClient, AmmoraV4MigrationMode, buildSingleSegmentCurve, assertAmmoraV4Config, concentratedDepositQuote, buildCreateAmmoraV4Config, giwaSepoliaAutoRouteDeployment, giwaSepoliaAutoRoute, resolveAmmoraFinalizedHead, verifyAmmoraV4CoreAtBlock, getAmmoraV4NextConfigId, getAmmoraV4ConfigAtBlock } from '@ammora-protocol/sdk';
import { createPublicClient, custom, defineChain, http, type Transport } from 'viem';
import './style.css';

type LaunchRow = { name: string; symbol: string; address: string; status: string; raw: unknown };
type ConfigRow = { configId: string; enabled: boolean; configHash: string; owner: string; feeClaimer: string; quoteToken: string; migrationMode: string; segments: number; details: unknown };
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
let lookupConfigs: ConfigRow[] = [];
let compareConfigIds: string[] = [];
let configTotal = 0n;
let configPageSize = 5;
let configLoading = false;
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
      <div class="top-actions"><span class="network"><i></i> GIWA SEPOLIA · ${CHAIN_ID}</span></div>
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
        
        <article class="stat-card"><span>RPC STATUS</span><strong id="rpc-state">Checking</strong><small id="rpc-detail">Public read endpoint</small></article>
      </section>
      <section class="section-head"><div><div class="eyebrow">01 / ON-CHAIN REGISTRY</div><h2>Verified launch configs</h2><p>Read directly from Ammora's GIWA Sepolia V4 registry at one finalized block. No Data API dependency.</p></div><button id="refresh-configs" class="outline-btn">↻ Read on-chain</button></section>
      <section class="directory-panel">
        <div class="directory-toolbar"><div class="search-wrap"><span>⌕</span><input id="config-search" placeholder="Search loaded configs, owner or token address" /></div><select id="config-filter" class="config-filter" aria-label="Filter configs"><option value="all">All statuses</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option><option value="quarantined">Quarantined</option></select></div>
        <div class="directory-toolbar"><div class="search-wrap"><span>#</span><input id="config-id-lookup" type="number" min="1" placeholder="Jump to any Config ID (e.g. 72)" /></div><button id="lookup-config" class="outline-btn">Lookup Config</button></div>
        <div class="directory-toolbar"><span id="config-status" class="muted">Checking deployment and registry…</span><span id="config-block" class="muted"></span></div>
        <div class="table-wrap"><table><thead><tr><th>CONFIG</th><th>QUOTE TOKEN</th><th>OWNER</th><th>STATUS</th></tr></thead><tbody id="config-rows"><tr><td colspan="4" class="empty">Verifying GIWA deployment…</td></tr></tbody></table></div>
        <div class="directory-toolbar"><span id="config-page-status" class="muted">First 5 of the verified registry configs</span><button id="load-more-configs" class="outline-btn" disabled>Load next 5</button></div>
      </section>
      <section class="builder-grid">
        <div class="builder-intro"><div class="eyebrow">03 / LAUNCH CONFIGURATOR</div><h2>Shape your<br><em>next launch.</em></h2><p>Draft a launch brief and review the parameters before any wallet action. This release does not submit transactions or spend test ETH.</p><div class="safety-note"><span>◎</span><div><b>Safe by default</b><small>No private keys, approvals or transactions are requested by this configurator.</small></div></div><div class="policy-note"><b>Protocol safety notice</b><small>Do not reuse the quarantined GIWA Registry Config #6. Select only an enabled config after reviewing its on-chain parameters and protocol guidance.</small></div></div>
        <form id="launch-form" class="form-panel">
          <div class="form-title"><div><span>NEW LAUNCH</span><h3>Configuration draft</h3></div><span class="draft-pill">LOCAL DRAFT</span></div>
          <label>Token name<input id="token-name" maxlength="32" placeholder="e.g. Aurora Protocol" required /></label>
          <div class="two-col"><label>Token symbol<input id="token-symbol" maxlength="10" placeholder="AURA" required /></label><label>Token supply<input id="token-supply" inputmode="numeric" placeholder="1000000000" required /></label></div>
          <div class="selected-config-note" id="selected-config-note">Waiting for registry…</div><select id="draft-config" hidden><option value="">No eligible Config</option></select>
          <label>Project description<textarea id="token-description" maxlength="240" rows="3" placeholder="What is this project building?"></textarea></label>
          <div class="form-foot"><span>Local draft · no chain writes</span><button class="primary-btn" type="submit">Create draft preview ↗</button></div>
          <div id="draft-validation" class="validation-list" aria-live="polite"></div>
          <details class="sdk-preview-panel"><summary>Advanced · SDK economics preview (optional)</summary>
            <div class="form-title"><div><span>SDK 0.3.9 · READ-ONLY</span><h3>Config economics preview</h3></div><span class="draft-pill">NO TRANSACTION</span></div>
            <p class="field-hint">Uses a loaded enabled Config as a template. Sale supply and quote threshold must be raw integer units using the template token and quote-token decimals.</p>
            <div class="two-col"><label>Template Config ID<input id="preview-template-id" inputmode="numeric" placeholder="e.g. 72" /></label><label>Sale supply (raw units)<input id="preview-sale-supply" inputmode="numeric" placeholder="e.g. 1000000000000" /></label></div>
            <div class="two-col"><label>Migration quote threshold (raw)<input id="preview-quote-threshold" inputmode="numeric" placeholder="e.g. 1000000000000000000" /></label><label>New Config owner address<input id="preview-owner" spellcheck="false" placeholder="0x..." /></label></div>
            <button id="run-sdk-preview" class="primary-btn" type="button">Derive & validate with SDK ↗</button>
            <div id="sdk-preview-status" class="validation-list" aria-live="polite"></div>
            <pre id="sdk-preview-output" class="sdk-preview-output" hidden></pre>
          </details>
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
  document.querySelector('#refresh-configs')?.addEventListener('click', loadConfigs);
  document.querySelector('#load-more-configs')?.addEventListener('click', loadMoreConfigs);
  document.querySelector('#lookup-config')?.addEventListener('click', loadConfigById);
  document.querySelector<HTMLInputElement>('#config-id-lookup')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); loadConfigById(); }
  });
  document.querySelector<HTMLInputElement>('#config-search')?.addEventListener('input', renderConfigs);
  document.querySelector<HTMLSelectElement>('#config-filter')?.addEventListener('change', renderConfigs);
  document.querySelector<HTMLButtonElement>('#run-sdk-preview')?.addEventListener('click', runSdkConfigPreview);
  document.querySelector('#config-rows')?.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>('[data-config-details]');
    if (button) toggleConfigDetails(button.dataset.configDetails || '');
  });
  document.querySelector<HTMLInputElement>('#search')?.addEventListener('input', e => renderRows((e.target as HTMLInputElement).value));
  document.querySelector<HTMLFormElement>('#launch-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const name = (document.querySelector<HTMLInputElement>('#token-name')!).value.trim();
    const symbol = (document.querySelector<HTMLInputElement>('#token-symbol')!).value.trim().toUpperCase();
    const supply = (document.querySelector<HTMLInputElement>('#token-supply')!).value.trim();
    const desc = (document.querySelector<HTMLTextAreaElement>('#token-description')!).value.trim();
    const validation = validateLaunchDraft({name, symbol, supply, configId:(document.querySelector<HTMLSelectElement>('#draft-config')!).value});
    renderValidation(validation);
    if (validation.length) return;
    const out = document.querySelector<HTMLDivElement>('#draft-output')!;
    out.hidden = false;
    const configId = (document.querySelector<HTMLSelectElement>('#draft-config')!).value;
    out.innerHTML = '<div class="draft-label">VALIDATED LOCAL DRAFT · NOT DEPLOYED</div><h4>' + esc(name) + ' <span>' + esc(symbol) + '</span></h4><p>Total supply: <b>' + BigInt(supply).toLocaleString('en-US') + '</b></p><p>Registry Config: <b>#' + esc(configId) + '</b> · enabled, not safety-certified</p><p>' + esc(desc || 'No description provided.') + '</p><small>Validation checks draft completeness only. No SDK launch preview, token creation or on-chain action has been performed.</small>';
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
    configTotal = nextId > 1n ? nextId - 1n : 0n;
    configs = [];
    lookupConfigs = [];
    if (status) status.textContent = `Found ${configTotal} registered configs · loading first page…`;
    await loadConfigPage(1);
    document.querySelector('#config-count')!.textContent = String(configTotal);
    if (status) status.textContent = `Verified V4 registry · showing ${configs.length} of ${configTotal} configs`;
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

async function loadConfigPage(startId: number) {
  if (configLoading) return;
  configLoading = true;
  const status = document.querySelector('#config-status');
  const button = document.querySelector<HTMLButtonElement>('#load-more-configs');
  if (button) button.disabled = true;
  try {
    const registry = giwaSepoliaAutoRouteDeployment.contracts.launch.configRegistry;
    const block = verifiedBlock!;
    const endId = Math.min(Number(configTotal), startId + configPageSize - 1);
    for (let id = startId; id <= endId; id++) {
      if (status) status.textContent = `Reading Config #${id} of ${configTotal}…`;
      const entry: any = await withTimeout(
        getAmmoraV4ConfigAtBlock(publicClient!, registry, BigInt(id), block),
        18_000,
        `Config #${id} read`,
      );
      configs.push({
        configId: String(entry.configId ?? id),
        enabled: Boolean(entry.enabled),
        configHash: String(entry.configHash ?? ''),
        owner: String(entry.identity?.owner ?? ''),
        feeClaimer: String(entry.identity?.feeClaimer ?? ''),
        quoteToken: String(entry.config?.quoteToken ?? ''),
        migrationMode: String(entry.config?.migrationMode ?? ''),
        segments: Array.isArray(entry.segments) ? entry.segments.length : 0,
        details: { identity: entry.identity, config: entry.config, segments: entry.segments },
      });
    }
    renderConfigs();
    refreshDraftConfigOptions();
    if (status) status.textContent = `Verified V4 registry · showing ${configs.length} of ${configTotal} configs`;
    const pageStatus = document.querySelector('#config-page-status');
    if (pageStatus) pageStatus.textContent = `Showing ${configs.length} of ${configTotal} verified configs`;
  } catch (err: any) {
    if (status) status.textContent = err?.shortMessage ?? err?.message ?? 'Config page read failed';
  } finally {
    configLoading = false;
    if (button) button.disabled = BigInt(configs.length) >= configTotal;
  }
}

async function loadMoreConfigs() {
  if (BigInt(configs.length) >= configTotal) return;
  await loadConfigPage(configs.length + 1);
}

async function loadConfigById() {
  const input = document.querySelector<HTMLInputElement>('#config-id-lookup');
  const button = document.querySelector<HTMLButtonElement>('#lookup-config');
  const status = document.querySelector('#config-status');
  const rawId = input?.value.trim() ?? '';
  if (!/^\d+$/.test(rawId) || BigInt(rawId) < 1n || BigInt(rawId) > configTotal) {
    if (status) status.textContent = `Enter a Config ID between 1 and ${configTotal.toString()}.`;
    return;
  }
  if (configLoading) return;
  configLoading = true;
  if (button) button.disabled = true;
  try {
    await ensureReadClient();
    const id = BigInt(rawId);
    if (status) status.textContent = `Reading Config #${rawId} at verified block…`;
    const registry = giwaSepoliaAutoRouteDeployment.contracts.launch.configRegistry;
    const entry: any = await withTimeout(
      getAmmoraV4ConfigAtBlock(publicClient!, registry, id, verifiedBlock!),
      18_000,
      `Config #${rawId} read`,
    );
    const row: ConfigRow = {
      configId: rawId,
      enabled: Boolean(entry.enabled),
      configHash: String(entry.configHash ?? ''),
      owner: String(entry.identity?.owner ?? ''),
      feeClaimer: String(entry.identity?.feeClaimer ?? ''),
      quoteToken: String(entry.config?.quoteToken ?? ''),
      migrationMode: String(entry.config?.migrationMode ?? ''),
      segments: Array.isArray(entry.segments) ? entry.segments.length : 0,
      details: { identity: entry.identity, config: entry.config, segments: entry.segments },
    };
    lookupConfigs = [row, ...lookupConfigs.filter(c => c.configId !== row.configId)];
    renderConfigs();
    refreshDraftConfigOptions();
    const detailRow = document.querySelector<HTMLTableRowElement>(`#config-detail-${CSS.escape(row.configId)}`);
    if (detailRow) detailRow.hidden = false;
    const detailButton = document.querySelector<HTMLButtonElement>(`[data-config-details="${CSS.escape(row.configId)}"]`);
    if (detailButton) detailButton.textContent = 'Hide −';
    if (status) status.textContent = `Config #${rawId} loaded directly · verified block ${verifiedBlock!.toString()}`;
  } catch (err: any) {
    if (status) status.textContent = `Config #${rawId} lookup failed · ${err?.shortMessage ?? err?.message ?? 'Read error'}`;
  } finally {
    configLoading = false;
    if (button) button.disabled = false;
  }
}

type LaunchDraft = { id:string; name:string; symbol:string; supply:string; description:string; configId:string; updatedAt:string };
const DRAFTS_KEY = 'ammora-launchpad-studio:drafts:v1';
function readDrafts(): LaunchDraft[] { try { const v=JSON.parse(localStorage.getItem(DRAFTS_KEY)||'[]'); return Array.isArray(v)?v:[]; } catch { return []; } }
function refreshSavedDrafts(selected='') { const el=document.querySelector<HTMLSelectElement>('#saved-drafts'); if(!el)return; const ds=readDrafts(); el.innerHTML='<option value="">Choose a saved draft</option>'+ds.map(d=>'<option value="'+esc(d.id)+'">'+esc(d.name||'Untitled')+' · '+esc(d.symbol||'—')+'</option>').join(''); el.value=selected; }
function refreshDraftConfigOptions(selected='') { const el=document.querySelector<HTMLSelectElement>('#draft-config'); const note=document.querySelector<HTMLDivElement>('#selected-config-note'); if(!el)return; const list=[...configs,...lookupConfigs].filter((x,i,a)=>x.enabled&&x.configId!=='6'&&Number(x.migrationMode)===0&&a.findIndex(y=>y.configId===x.configId)===i); const chosen=list.find(x=>x.configId===selected)??list[0]; el.innerHTML=chosen?'<option value="'+esc(chosen.configId)+'">Config #'+esc(chosen.configId)+'</option>':'<option value="">No eligible Config loaded</option>';el.value=chosen?.configId??'';if(note)note.textContent=chosen?'Automatic candidate: Config #'+chosen.configId+' · enabled + Concentrated mode. Not safety-certified.':'No eligible Config loaded yet.'; }
function applyDraftTemplate() { const fixed=(document.querySelector<HTMLSelectElement>('#draft-template')!).value==='fixed'; const v=fixed?['Community Token','COMM','1000000000','A community-led token draft. Replace this description before use.']:['','','','']; (document.querySelector<HTMLInputElement>('#token-name')!).value=v[0]; (document.querySelector<HTMLInputElement>('#token-symbol')!).value=v[1]; (document.querySelector<HTMLInputElement>('#token-supply')!).value=v[2]; (document.querySelector<HTMLTextAreaElement>('#token-description')!).value=v[3]; (document.querySelector<HTMLSelectElement>('#draft-config')!).value=''; renderValidation([]); }
function currentDraft():LaunchDraft { return {id:crypto.randomUUID(),name:(document.querySelector<HTMLInputElement>('#token-name')!).value.trim(),symbol:(document.querySelector<HTMLInputElement>('#token-symbol')!).value.trim().toUpperCase(),supply:(document.querySelector<HTMLInputElement>('#token-supply')!).value.trim(),description:(document.querySelector<HTMLTextAreaElement>('#token-description')!).value.trim(),configId:(document.querySelector<HTMLSelectElement>('#draft-config')!).value,updatedAt:new Date().toISOString()}; }
function saveDraft() { const d=currentDraft(), a=readDrafts(), i=a.findIndex(x=>x.name===d.name&&x.symbol===d.symbol); if(i>=0){d.id=a[i].id;a[i]=d;}else a.unshift(d); try{localStorage.setItem(DRAFTS_KEY,JSON.stringify(a.slice(0,20)));refreshSavedDrafts(d.id);renderValidation(['Draft saved locally in this browser.']);}catch{renderValidation(['Could not save locally. Check browser storage settings.']);} }
function loadSelectedDraft() { const id=(document.querySelector<HTMLSelectElement>('#saved-drafts')!).value,d=readDrafts().find(x=>x.id===id);if(!d){renderValidation(['Choose a saved draft first.']);return;}(document.querySelector<HTMLInputElement>('#token-name')!).value=d.name;(document.querySelector<HTMLInputElement>('#token-symbol')!).value=d.symbol;(document.querySelector<HTMLInputElement>('#token-supply')!).value=d.supply;(document.querySelector<HTMLTextAreaElement>('#token-description')!).value=d.description;refreshDraftConfigOptions(d.configId);renderValidation(['Draft loaded. Recheck Config availability and all parameters before preview.']);}
function validateLaunchDraft(d:{name:string;symbol:string;supply:string;configId:string}):string[] { const a:string[]=[];if(d.name.length<2||d.name.length>32)a.push('Token name must contain 2–32 characters.');if(!/^[A-Z0-9]{2,10}$/.test(d.symbol))a.push('Symbol must be 2–10 uppercase letters or numbers.');if(!/^\d+$/.test(d.supply)||BigInt(d.supply||'0')<=0n||BigInt(d.supply||'0')>(2n**256n-1n))a.push('Supply must be a positive whole number within uint256.');if(!d.configId)a.push('Select an enabled Registry Config.');else if(d.configId==='6')a.push('Config #6 is quarantined and cannot be selected.');else if(![...configs,...lookupConfigs].some(x=>x.configId===d.configId&&x.enabled))a.push('Selected Config is not loaded and verified as enabled. Load it from the registry first.');return a;}
function renderValidation(items:string[]) { const el=document.querySelector<HTMLDivElement>('#draft-validation');if(!el)return;el.innerHTML=items.length?'<ul>'+items.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'';el.classList.toggle('has-errors',items.some(x=>!x.startsWith('Draft saved')&&!x.startsWith('Draft loaded')));}
function flattenConfigDetails(value: unknown, prefix = ''): Array<[string, string]> {
  if (value === null || value === undefined) return [[prefix || 'value', '—']];
  if (typeof value === 'bigint') return [[prefix || 'value', value.toString()]];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [[prefix || 'value', String(value)]];
  }
  if (Array.isArray(value)) {
    if (!value.length) return [[prefix || 'value', 'Empty list']];
    return value.flatMap((item, index) => flattenConfigDetails(item, `${prefix}[${index}]`));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return [[prefix || 'value', 'Empty object']];
    return entries.flatMap(([key, item]) => flattenConfigDetails(item, prefix ? `${prefix} · ${key}` : key));
  }
  return [[prefix || 'value', String(value)]];
}

function toggleConfigDetails(configId: string) {
  const row = document.querySelector<HTMLTableRowElement>(`#config-detail-${CSS.escape(configId)}`);
  if (row) {
    row.hidden = !row.hidden;
    const button = document.querySelector<HTMLButtonElement>(`[data-config-details="${CSS.escape(configId)}"]`);
    if (button) button.textContent = row.hidden ? 'Details +' : 'Hide −';
  }
}

function renderConfigAnalysis(c: ConfigRow): string {
  const details = c.details as any;
  const cfg = details?.config ?? {};
  const identity = details?.identity ?? {};
  const bps = (value: unknown) => Number(value ?? 0) / 100;
  const raw = (value: unknown) => value === undefined || value === null ? 'Not supplied' : String(value);
  const feeStart = bps(cfg.cliffFeeBps);
  const reduction = bps(cfg.feeReductionFactorBps);
  const periods = Number(cfg.feeNumberOfPeriods ?? 0);
  const frequency = Number(cfg.feePeriodFrequency ?? 0);
  const scheduleFieldsPresent = Number.isFinite(feeStart) && Number.isFinite(reduction) && periods > 0 && frequency > 0;
  // Do not infer enum semantics from another protocol. Mode 1 remains unverified
  // until Ammora's own SDK/contract source documents the exact behavior.
  const migration = Number(cfg.migrationMode) === 0 ? 'Concentrated (SDK guide)' : 'Mode ' + raw(cfg.migrationMode) + ' · verify enum';
  const creatorShare = bps(cfg.creatorShareOfNonProtocolBps);
  const partnerLocked = bps(cfg.liquidityDistribution?.partnerPermanentLockedBps);
  const creatorLocked = bps(cfg.liquidityDistribution?.creatorPermanentLockedBps);
  const warnings = [feeStart >= 15 ? 'High initial fee: review user impact.' : '', cfg.dynamicFeeEnabled ? '' : 'Dynamic fee is disabled.', cfg.rateLimiterEnabled ? '' : 'Rate limiter is disabled.', 'Graduation readiness is not proven by Config fields alone.', 'Quote-token decimals and policy must be verified independently.', 'Confirm fee scheduler enum and timing against SDK/contract source.'].filter(Boolean);
  const timeline = '<span><b>Mode ' + esc(raw(cfg.feeSchedulerMode)) + '</b>Semantics not verified</span>';
  return '<section class="config-analysis">' +
    '<div class="analysis-heading"><div><small>CONFIG INTELLIGENCE</small><h3>Config #' + esc(c.configId) + ' analysis</h3></div><span class="analysis-status">' + (c.enabled ? 'ENABLED · NOT SAFETY-CERTIFIED' : 'DISABLED') + '</span></div>' +
    '<div class="analysis-metrics"><article><small>INITIAL FEE</small><b>' + feeStart.toFixed(2) + '%</b></article><article><small>POST-MIGRATION FEE</small><b>' + bps(cfg.postMigrationFeeBps).toFixed(2) + '%</b></article><article><small>CREATOR SHARE*</small><b>' + creatorShare.toFixed(2) + '%</b></article><article><small>LP PERMANENT LOCK</small><b>' + (partnerLocked + creatorLocked).toFixed(2) + '%</b></article></div>' +
    '<div class="analysis-columns"><div><h4>Fee schedule · not yet calculated</h4><p>' + (scheduleFieldsPresent ? 'Fields present: ' + periods + ' periods · ' + frequency + 's frequency · reduction factor ' + esc(raw(cfg.feeReductionFactorBps)) + ' bps.' : 'Fee schedule fields incomplete.') + '</p><div class="fee-timeline">' + timeline + '</div><small class="analysis-foot">No final fee or timing estimate is shown until Ammora SDK/contract semantics for this mode are verified.</small></div>' +
    '<div><h4>Graduation & LP</h4><p>Migration: <b>' + esc(migration) + '</b></p><p>Supply (raw): <code>' + esc(raw(cfg.totalSupply)) + '</code></p><p>Base threshold (raw): <code>' + esc(raw(cfg.migrationBaseThreshold)) + '</code></p><p>Quote threshold (raw): <code>' + esc(raw(cfg.migrationQuoteThreshold)) + '</code></p><p>Partner / Creator permanent lock: <b>' + partnerLocked.toFixed(2) + '% / ' + creatorLocked.toFixed(2) + '%</b></p></div></div>' +
    '<div class="analysis-warnings"><h4>Checks still required</h4><ul>' + warnings.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul></div>' +
    '<p class="analysis-foot">*Creator share is of the non-Protocol fee portion, not total trading volume. Owner: ' + esc(identity.owner ?? c.owner) + ' · Fee claimer: ' + esc(identity.feeClaimer ?? c.feeClaimer) + '</p></section>';
}
async function runSdkConfigPreview() {
  const status=document.querySelector<HTMLDivElement>('#sdk-preview-status');
  const output=document.querySelector<HTMLPreElement>('#sdk-preview-output');
  if(status) status.textContent='Checking inputs and verified registry snapshot…';
  if(output){output.hidden=true;output.textContent='';}
  try {
    const idText=(document.querySelector<HTMLInputElement>('#preview-template-id')!).value.trim();
    const supplyText=(document.querySelector<HTMLInputElement>('#preview-sale-supply')!).value.trim();
    const quoteText=(document.querySelector<HTMLInputElement>('#preview-quote-threshold')!).value.trim();
    const owner=(document.querySelector<HTMLInputElement>('#preview-owner')!).value.trim();
    if(!/^\\d+$/.test(idText)||BigInt(idText)<=0n) throw new Error('Enter a positive template Config ID.');
    if(!/^\\d+$/.test(supplyText)||BigInt(supplyText)<=0n) throw new Error('Sale supply must be a positive raw integer.');
    if(!/^\\d+$/.test(quoteText)||BigInt(quoteText)<=0n) throw new Error('Migration quote threshold must be a positive raw integer.');
    if(!/^0x[0-9a-fA-F]{40}$/.test(owner)) throw new Error('Enter a valid 20-byte Config owner address.');
    await ensureReadClient();
    const id=BigInt(idText), registry=giwaSepoliaAutoRouteDeployment.contracts.launch.configRegistry;
    const template:any=await withTimeout(getAmmoraV4ConfigAtBlock(publicClient!,registry,id,verifiedBlock!),18000,'Template Config read');
    if(!template.enabled) throw new Error('Template Config is disabled.');
    if(id===6n) throw new Error('Config #6 is quarantined and cannot be used.');
    if(template.config.migrationMode!==AmmoraV4MigrationMode.Concentrated) throw new Error('This preview helper supports Concentrated migration mode only. Mode 1 requires a separately reviewed compounding policy.');
    const saleSupply=BigInt(supplyText), migrationQuoteThreshold=BigInt(quoteText);
    const curve=buildSingleSegmentCurve(template.config.startSqrtPrice,saleSupply,migrationQuoteThreshold);
    const segment=curve[0];
    if(!segment) throw new Error('SDK returned no curve segment.');
    const range={sqrtPriceX64:segment.upperSqrtPrice,sqrtMinPriceX64:segment.lowerSqrtPrice,sqrtMaxPriceX64:segment.upperSqrtPrice*2n};
    const quoteFee=migrationQuoteThreshold*BigInt(template.config.migrationQuoteFeeBps)/10000n;
    const quoteAfterFee=migrationQuoteThreshold-quoteFee;
    const destination=concentratedDepositQuote(range,{quoteAmount:quoteAfterFee});
    const vesting=template.config.lockedBaseVesting;
    const lockedBase=vesting.cliffUnlockAmount+vesting.amountPerPeriod*BigInt(vesting.numberOfPeriods);
    const config={...template.config,totalSupply:saleSupply+destination.baseAmount+lockedBase,migrationQuoteThreshold,migrationBaseThreshold:destination.baseAmount,postMigrationSqrtMinPrice:range.sqrtMinPriceX64,postMigrationSqrtMaxPrice:range.sqrtMaxPriceX64,postMigrationLiquidity:destination.liquidity};
    assertAmmoraV4Config(config,curve);
    const deployment=giwaSepoliaAutoRouteDeployment.contracts.launch;
    const transaction={to:registry,...buildCreateAmmoraV4Config(config,curve,owner as `0x${string}`)};
    const json=(value:unknown)=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2);
    const preview={status:'SDK_VALIDATED_PREVIEW_ONLY',chainId:CHAIN_ID,blockNumber:verifiedBlock!.toString(),template:{configId:idText,configHash:template.configHash,enabled:template.enabled,tokenDecimals:String(template.config.tokenDecimals),quoteToken:template.config.quoteToken},owner,config,curve,economics:{saleAllocationRaw:saleSupply,grossMigrationBaseRaw:destination.baseAmount,grossMigrationQuoteRaw:destination.quoteAmount,migrationQuoteFeeRaw:quoteFee,quoteSurplusToProtocolRaw:quoteAfterFee-destination.quoteAmount,lockedBaseRaw:lockedBase,totalSupplyRaw:config.totalSupply},transaction:{to:transaction.to,data:transaction.data},notice:'Validated calldata preview only; not simulated, signed or sent. Template recipients, fee rules, vesting and LP policy are inherited. Independently verify graduation inventory and every economic assumption.'};
    if(output){output.textContent=json(preview);output.hidden=false;}
    if(status) status.textContent='SDK Config assertion passed · calldata derived · no simulation or transaction performed.';
  } catch(err:any) {
    if(status) status.textContent='Preview blocked · '+(err?.shortMessage??err?.message??String(err));
  }
}
function findConfig(id:string):ConfigRow|undefined { return [...configs,...lookupConfigs].find(x=>x.configId===id); }
function toggleConfigCompare(id:string) {
  const item=findConfig(id);
  if(!item||!item.enabled||id==='6') return;
  if(compareConfigIds.includes(id)) compareConfigIds=compareConfigIds.filter(x=>x!==id);
  else if(compareConfigIds.length<2) compareConfigIds=[...compareConfigIds,id];
  else { const panel=document.querySelector<HTMLDivElement>('#config-comparison'); if(panel) panel.innerHTML='<p class="comparison-empty">Only two Configs can be compared at once. Remove one selection first.</p>'; return; }
  renderConfigs();
}
function configRiskFlags(c:ConfigRow):string[] {
  const cfg=(c.details as any)?.config??{}, flags:string[]=[];
  if(c.configId==='6') flags.push('Quarantined by protocol guidance — do not use.');
  if(!c.enabled) flags.push('Config is disabled.');
  if(Number(cfg.cliffFeeBps)>=1500) flags.push('Initial fee is at least 15%; review user impact.');
  if(cfg.dynamicFeeEnabled!==true) flags.push('Dynamic fee is disabled.');
  if(cfg.rateLimiterEnabled!==true) flags.push('Rate limiter is disabled.');
  const partner=Number(cfg.liquidityDistribution?.partnerPermanentLockedBps??0), creator=Number(cfg.liquidityDistribution?.creatorPermanentLockedBps??0);
  if(partner+creator!==10000) flags.push('Permanent LP lock fields do not sum to 100%; inspect vesting and remaining allocation.');
  if(Number(cfg.migrationMode)!==0) flags.push('Migration mode is not confirmed as Concentrated by the available SDK guide.');
  if(Number(cfg.feeSchedulerMode)===1) flags.push('Fee scheduler Mode 1 semantics remain unverified.');
  if(!cfg.quoteToken) flags.push('Quote-token address is missing.');
  flags.push('Enabled status is not a safety certification; graduation readiness requires independent checks.');
  return flags;
}
function configCompareValue(c:ConfigRow,key:string):string {
  const cfg=(c.details as any)?.config??{}, bps=(v:any)=>(Number(v??0)/100).toFixed(2)+'%';
  const values:Record<string,string>={
    'Initial fee':bps(cfg.cliffFeeBps),'Post-migration fee':bps(cfg.postMigrationFeeBps),
    'Creator share of non-Protocol fees':bps(cfg.creatorShareOfNonProtocolBps),
    'Partner permanent LP lock':bps(cfg.liquidityDistribution?.partnerPermanentLockedBps),
    'Creator permanent LP lock':bps(cfg.liquidityDistribution?.creatorPermanentLockedBps),
    'Dynamic fee':String(cfg.dynamicFeeEnabled??'Not supplied'),'Rate limiter':String(cfg.rateLimiterEnabled??'Not supplied'),
    'Fee scheduler mode':String(cfg.feeSchedulerMode??'Not supplied'),
    'Migration mode':Number(cfg.migrationMode)===0?'0 · Concentrated (SDK guide)':String(cfg.migrationMode??'Not supplied'),
    'Quote token':c.quoteToken||'Not supplied','Segments':String(c.segments),
    'Enabled':String(c.enabled)
  };
  return values[key]??'—';
}
function renderConfigComparison() {
  const panel=document.querySelector<HTMLDivElement>('#config-comparison'); if(!panel)return;
  const selected=compareConfigIds.map(findConfig).filter((x):x is ConfigRow=>Boolean(x));
  if(!selected.length){panel.innerHTML='<p class="comparison-empty">Select up to two enabled Configs to compare their on-chain parameters and risk flags.</p>';return;}
  const fields=['Initial fee','Post-migration fee','Creator share of non-Protocol fees','Partner permanent LP lock','Creator permanent LP lock','Dynamic fee','Rate limiter','Fee scheduler mode','Migration mode','Quote token','Segments','Enabled'];
  panel.innerHTML='<div class="comparison-head"><div><span class="eyebrow">CONFIG COMPARISON</span><h3>Side-by-side review</h3><small>On-chain values only · not a safety certification</small></div><button type="button" class="outline-btn" id="clear-config-compare">Clear selection</button></div>'+
    '<div class="comparison-table"><div class="comparison-row comparison-label"><b>Parameter</b>'+selected.map(x=>'<b>Config #'+esc(x.configId)+'</b>').join('')+'</div>'+
    fields.map(field=>'<div class="comparison-row"><span>'+esc(field)+'</span>'+selected.map(x=>'<code>'+esc(configCompareValue(x,field))+'</code>').join('')+'</div>').join('')+'</div>'+
    '<div class="risk-columns">'+selected.map(x=>'<section><h4>Config #'+esc(x.configId)+' · Review flags</h4><ul>'+configRiskFlags(x).map(flag=>'<li>'+esc(flag)+'</li>').join('')+'</ul></section>').join('')+'</div>';
  panel.querySelector('#clear-config-compare')?.addEventListener('click',()=>{compareConfigIds=[];renderConfigs();});
}
function renderConfigs() {
  const tbody = document.querySelector<HTMLTableSectionElement>('#config-rows');
  if (!tbody) return;
  const query = (document.querySelector<HTMLInputElement>('#config-search')?.value ?? '').trim().toLowerCase();
  const filter = document.querySelector<HTMLSelectElement>('#config-filter')?.value ?? 'all';
  const visible = [...configs, ...lookupConfigs].filter(c => {
    const quarantined = c.configId === '6';
    const statusMatch = filter === 'all' || (filter === 'quarantined' && quarantined)
      || (filter === 'enabled' && c.enabled && !quarantined)
      || (filter === 'disabled' && !c.enabled && !quarantined);
    const haystack = [c.configId, c.configHash, c.owner, c.feeClaimer, c.quoteToken].join(' ').toLowerCase();
    return statusMatch && (!query || haystack.includes(query));
  });
  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">${configs.length ? 'No loaded configs match this search or filter. Load more configs to search the rest of the registry.' : 'No registered configs were found at the verified block.'}</td></tr>`;
  } else {
    tbody.innerHTML = visible.map(c => {
      const quarantined = c.configId === '6';
      const state = quarantined ? 'Quarantined · Do not use' : c.enabled ? 'Enabled' : 'Disabled';
      const detailRows = flattenConfigDetails(c.details).map(([key, value]) =>
        `<div class="config-detail-item"><span>${esc(key)}</span><code>${esc(value)}</code></div>`
      ).join('');
      return `<tr><td><b>#${esc(c.configId)}</b><small class="mono">${esc(c.configHash.slice(0, 14))}…</small><button class="view-btn" type="button" data-config-details="${esc(c.configId)}">Details +</button></td><td class="mono">${esc(short(c.quoteToken))}</td><td class="mono">${esc(short(c.owner))}</td><td><span class="stage">${state}</span></td></tr><tr id="config-detail-${esc(c.configId)}" hidden><td colspan="4"><div class="config-detail-grid">${renderConfigAnalysis(c)}<div class="config-detail-grid">${detailRows}</div></td></tr>`;
    }).join('');
  }
  const button = document.querySelector<HTMLButtonElement>('#load-more-configs');
  if (button) button.disabled = configLoading || BigInt(configs.length) >= configTotal;
  const pageStatus = document.querySelector('#config-page-status');
  if (pageStatus) pageStatus.textContent = `Showing ${visible.length} matching configs · ${configs.length} of ${configTotal} paged configs loaded`;
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
checkRpc();
