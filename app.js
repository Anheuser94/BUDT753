// Simplified MDUI Landing — robust WeekID -> certId + processor lookup + single Approve&Pay
let provider, signer;
const SCALE = 1_000_000n;

// ----- TUNABLES -----
const SCAN_LINEAR_MAX = 600n; // linear scan upper bound for certIds as last resort
const DEBUG = false;
// ---------------------

// --- ABIs ---
const MDUI_ABI = [
  {"type":"function","name":"owner","stateMutability":"view","inputs":[],"outputs":[{"type":"address"}]},
  {"type":"function","name":"processor","stateMutability":"view","inputs":[{"type":"address"}],"outputs":[{"type":"bool"}]},
  {"type":"function","name":"token","stateMutability":"view","inputs":[],"outputs":[{"type":"address"}]},

  {"type":"function","name":"getCertificationId","stateMutability":"view","inputs":[{"type":"address"},{"type":"uint256"}],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"getCertificationIdByRef","stateMutability":"view","inputs":[{"type":"bytes32"}],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"getCertificationIdByAccountRef","stateMutability":"view","inputs":[{"type":"bytes32"}],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"certificationIdByAccountRef","stateMutability":"view","inputs":[{"type":"bytes32"}],"outputs":[{"type":"uint256"}]},

  {"type":"function","name":"previewPayout","stateMutability":"view","inputs":[
    {"type":"address"},{"type":"uint256"},{"type":"bool"},{"type":"bool"},{"type":"bool"}
  ],"outputs":[{"type":"uint256"}]},

  {"type":"function","name":"previewCertification","stateMutability":"view","inputs":[{"type":"uint256"}],"outputs":[
    {"components":[
      {"name":"claimant","type":"address"},
      {"name":"weekId","type":"uint256"},
      {"name":"answersHash","type":"bytes32"},
      {"name":"accountRef","type":"bytes32"},
      {"name":"flags","type":"uint16"},
      {"name":"inputs","type":"tuple","components":[
        {"name":"reportedEarnings","type":"uint256"},
        {"name":"availableForWork","type":"bool"},
        {"name":"jobSearchCompliant","type":"bool"},
        {"name":"workedFullTime","type":"bool"}
      ]},
      {"name":"status","type":"uint8"},
      {"name":"submittedAt","type":"uint64"}
    ],"type":"tuple"},
    {"type":"uint256"},
    {"components":[
      {"name":"status","type":"uint8"},
      {"name":"lockedAmount","type":"uint256"},
      {"name":"decidedAt","type":"uint64"},
      {"name":"rejectReason","type":"string"}
    ],"type":"tuple"}
  ]},

  {"type":"function","name":"submitCertification","stateMutability":"nonpayable","inputs":[
    {"name":"weekId","type":"uint256"},
    {"name":"answersHash","type":"bytes32"},
    {"name":"accountRef","type":"bytes32"},
    {"name":"reportedEarnings","type":"uint256"},
    {"name":"availableForWork","type":"bool"},
    {"name":"jobSearchCompliant","type":"bool"},
    {"name":"workedFullTime","type":"bool"},
    {"name":"flags","type":"uint16"}
  ],"outputs":[]},

  {"type":"function","name":"approveAndPay","stateMutability":"nonpayable","inputs":[{"type":"uint256"}],"outputs":[]},
  {"type":"function","name":"rejectCertification","stateMutability":"nonpayable","inputs":[{"type":"uint256"},{"type":"string"}],"outputs":[]},

  {"type":"function","name":"setProcessor","stateMutability":"nonpayable","inputs":[{"type":"address"},{"type":"bool"}],"outputs":[]},
  {"type":"function","name":"testSetBaseWeeklyBenefit","stateMutability":"nonpayable","inputs":[{"type":"address"},{"type":"uint256"}],"outputs":[]},
  {"type":"function","name":"testSetPolicy","stateMutability":"nonpayable","inputs":[{"type":"uint256"},{"type":"uint16"},{"type":"uint256"}],"outputs":[]},
  {"type":"function","name":"testSetDependents","stateMutability":"nonpayable","inputs":[{"type":"address"},{"type":"uint8"}],"outputs":[]}
];

const ERC20_TEST_ABI = [
  {"type":"function","name":"name","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]},
  {"type":"function","name":"symbol","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]},
  {"type":"function","name":"decimals","stateMutability":"view","inputs":[],"outputs":[{"type":"uint8"}]},
  {"type":"function","name":"totalSupply","stateMutability":"view","inputs":[],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"balanceOf","stateMutability":"view","inputs":[{"type":"address"}],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"mintForTesting","stateMutability":"nonpayable","inputs":[{"type":"address"},{"type":"uint256"}],"outputs":[]}
];

const MCC6_ABI = [
  {"type":"function","name":"decimals","stateMutability":"view","inputs":[],"outputs":[{"type":"uint8"}]},
  {"type":"function","name":"balanceOf","stateMutability":"view","inputs":[{"type":"address"}],"outputs":[{"type":"uint256"}]}
];

// --- Helpers ---
const $ = (id) => document.getElementById(id);
const fmtAddr = (a) => a ? (a.slice(0,6) + '…' + a.slice(-4)) : '—';
const keccakHex = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const usdToScaled = (v) => BigInt(Math.round(Number(v || 0) * 1_000_000));
const scaledToUsd = (bi, d = 6) => Number(bi) / (10 ** Number(d));

function getOrCreateSecretSalt() {
  let s = localStorage.getItem("mdui-secret-salt");
  if (!s) { s = ethers.hexlify(ethers.randomBytes(8)); localStorage.setItem("mdui-secret-salt", s); }
  return s;
}
function collectAnswersArray() {
  const yesNo = (b) => (b ? "Y" : "N");
  const a1 = $("availableForWork").value === "true";
  const a2 = $("qSchool").value === "true";
  const a3 = $("jobSearchCompliant").value === "true";
  const a4 = $("workedFullTime").value === "true";
  const a5 = $("qCommission").value === "true";
  const a6 = $("qRefusedWork").value === "true";
  const a7 = $("qOtherIncome").value === "true";
  return [a1,a2,a3,a4,a5,a6,a7].map(yesNo);
}
function computeFlagsHidden() {
  let f = 0;
  if ($("qSchool").value === "true") f |= (1 << 0);
  if ($("qCommission").value === "true") f |= (1 << 1);
  return f;
}

// Tabs
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("tab")) {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
    e.target.classList.add("active");
    document.getElementById("tab-" + e.target.getAttribute("data-tab")).classList.add("active");
  }
});

// Wallet
async function connectWallet() {
  const injected = Array.isArray(window.ethereum?.providers) && window.ethereum.providers.length
    ? window.ethereum.providers.find(p => p.isMetaMask) || window.ethereum.providers[0]
    : window.ethereum;
  if (!injected) return alert("No injected wallet found.");
  await injected.request({ method: "eth_requestAccounts" });
  provider = new ethers.BrowserProvider(injected);
  signer = await provider.getSigner();
  const net = await provider.getNetwork();
  $("networkName").textContent = `${net.name} (chainId ${net.chainId})`;
  $("accountAddr").textContent = fmtAddr(await signer.getAddress());
}

// Config persistence
function saveConfig() { localStorage.setItem("mdui-config", JSON.stringify({ mdui: $("mduiAddress").value })); }
function loadConfig() { try { const s = localStorage.getItem("mdui-config"); if (s) $("mduiAddress").value = JSON.parse(s).mdui || ""; } catch {} }
function clearConfig() { localStorage.removeItem("mdui-config"); }

// Fetch MDUI info
async function fetchMduiInfo() {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer || provider);
  try {
    const [owner, token, me, amProc] = await Promise.all([
      mdui.owner(), mdui.token(), signer.getAddress(),
      (async()=>{ try { return await mdui.processor(await signer.getAddress()); } catch { return false; } })()
    ]);
    $("mduiOwner").value = owner;
    $("tokenAddress").value = token;
    $("amIProcessor").value = amProc ? "Yes" : "No";
    const t = new ethers.Contract(token, MCC6_ABI, signer || provider);
    const [dec, bal] = await Promise.all([ (async()=>{ try { return await t.decimals(); } catch { return 6; } })(), t.balanceOf(me) ]);
    $("myMccBalance").value = scaledToUsd(bal, Number(dec)).toFixed(Number(dec));
  } catch (e) { console.error(e); alert("Failed reading MDUI."); }
}

// Preview payout
$("btnPreviewPayout").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer || provider);
  const me = await signer.getAddress();
  const out = await mdui.previewPayout(
    me,
    usdToScaled($("earnUsd").value),
    $("availableForWork").value === "true",
    $("jobSearchCompliant").value === "true",
    $("workedFullTime").value === "true"
  ).catch(() => 0n);
  $("previewResult").textContent = out ? ("Estimated payout: $" + scaledToUsd(out, 6).toFixed(2)) : "Preview error — seed WBA/Policy first?";
};

// Submit certification
$("btnSubmitCert").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer);
  const weekId = BigInt($("weekId").value || "0"); if (weekId === 0n) return alert("Week ID required.");

  const answersHash = keccakHex(JSON.stringify(collectAnswersArray()));
  const me = await signer.getAddress();
  const accountRef = keccakHex(`${me}:${getOrCreateSecretSalt()}:${weekId.toString()}`);
  const flags = computeFlagsHidden();

  const tx = await mdui.submitCertification(
    weekId, answersHash, accountRef,
    usdToScaled($("earnUsd").value),
    $("availableForWork").value === "true",
    $("jobSearchCompliant").value === "true",
    $("workedFullTime").value === "true",
    flags
  );
  const rec = await tx.wait();
  alert("Submitted. Tx: " + rec.hash);

  // Resolve & cache immediately
  const id = await resolveCertIdForWeek(mdui, me, weekId);
  if (id && id !== 0n) cacheCertId(me, weekId, id);
};

// ---------- Robust WeekID -> certId ----------
function logD(...args){ if (DEBUG) console.log("[resolver]", ...args); }

function cacheCertId(address, weekId, certId) {
  const key = `mdui-cert-index-${address.toLowerCase()}`;
  const map = JSON.parse(localStorage.getItem(key) || "{}");
  map[String(weekId)] = String(certId);
  localStorage.setItem(key, JSON.stringify(map));
}
function readCachedCertId(address, weekId) {
  const key = `mdui-cert-index-${address.toLowerCase()}`;
  try { const map = JSON.parse(localStorage.getItem(key) || "{}"); return map[String(weekId)] ? BigInt(map[String(weekId)]) : 0n; } catch { return 0n; }
}

async function resolveCertIdForWeek(mdui, me, weekId) {
  // 0) cached
  let id = readCachedCertId(me, weekId);
  if (id && id !== 0n) { logD("cached id", id); return id; }

  // 1) main getter
  try {
    id = await mdui.getCertificationId(me, weekId);
    logD("direct getter ->", id);
    if (id && id !== 0n) {
      const [cert] = await mdui.previewCertification(id);
      if (BigInt(cert.weekId) === weekId && cert.claimant?.toLowerCase() === me.toLowerCase()) return id;
    }
  } catch (e) { logD("direct getter failed", e?.message); }

  // 2) accountRef-based fallbacks
  const ref = keccakHex(`${me}:${getOrCreateSecretSalt()}:${weekId.toString()}`);
  const tryFns = ["getCertificationIdByRef","getCertificationIdByAccountRef","certificationIdByAccountRef"];
  for (const fn of tryFns) {
    if (typeof mdui[fn] !== "function") continue;
    try {
      const rid = await mdui[fn](ref);
      logD(fn, "->", rid);
      if (rid && rid !== 0n) {
        const [cert] = await mdui.previewCertification(rid);
        if (BigInt(cert.weekId) === weekId && cert.claimant?.toLowerCase() === me.toLowerCase()) return rid;
      }
    } catch(e){ logD(fn, "failed", e?.message); }
  }

  // 3) FINAL RESORT: linear scan from id 1 up to SCAN_LINEAR_MAX
  for (let i = 1n; i <= SCAN_LINEAR_MAX; i++) {
    try {
      const [cert] = await mdui.previewCertification(i);
      if (!cert?.claimant) continue;
      if (cert.claimant.toLowerCase() === me.toLowerCase() && BigInt(cert.weekId) === weekId) {
        logD("linear scan hit at", i);
        return i;
      }
    } catch { /* non-existent id -> ignore */ }
  }

  return 0n;
}

// ----- Claimant lookup buttons -----
$("btnLookupCertId").onclick = async () => {
  $("foundCertId").value = "";
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();

  const mdui = new ethers.Contract(addr, MDUI_ABI, signer || provider);
  const me = await signer.getAddress();
  const raw = ($("lookupWeekId").value || "").trim();
  if (!raw) return alert("Week ID required.");

  let weekId; try { weekId = BigInt(raw); } catch { return alert("Invalid Week ID."); }
  const certId = await resolveCertIdForWeek(mdui, me, weekId);
  $("foundCertId").value = certId && certId !== 0n ? String(certId) : "not found";
};

$("btnPreviewCert").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer || provider);
  const certIdStr = ($("foundCertId").value || "").trim();
  if (!certIdStr || certIdStr === "not found" || certIdStr === "error") return alert("Resolve a certId first.");
  let certId; try { certId = BigInt(certIdStr); } catch { return alert("Bad certId value."); }

  try {
    const [cert, computed, proc] = await mdui.previewCertification(certId);
    const obj = {
      cert: {
        claimant: cert.claimant,
        weekId: String(cert.weekId),
        flags: Number(cert.flags),
        inputs: {
          reportedEarnings: scaledToUsd(cert.inputs.reportedEarnings, 6),
          availableForWork: Boolean(cert.inputs.availableForWork),
          jobSearchCompliant: Boolean(cert.inputs.jobSearchCompliant),
          workedFullTime: Boolean(cert.inputs.workedFullTime),
        },
        status: Number(cert.status),
        submittedAt: Number(cert.submittedAt),
      },
      computedAmountUSD: scaledToUsd(computed, 6),
      proc: {
        status: Number(proc.status),
        lockedAmountUSD: scaledToUsd(proc.lockedAmount, 6),
        decidedAt: Number(proc.decidedAt),
        rejectReason: proc.rejectReason
      }
    };
    $("certPreviewJson").textContent = JSON.stringify(obj, null, 2);
  } catch (e) { console.error(e); $("certPreviewJson").textContent = "previewCertification failed."; }
};

// ----- Processor lookup (new), preview, and actions -----
$("btnProcLookupCertId").onclick = async () => {
  $("procFoundCertId").value = "";
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();

  const mdui = new ethers.Contract(addr, MDUI_ABI, signer || provider);
  const me = await signer.getAddress();
  const raw = ($("procLookupWeekId").value || "").trim();
  if (!raw) return alert("Week ID required.");

  let weekId; try { weekId = BigInt(raw); } catch { return alert("Invalid Week ID."); }

  const certId = await resolveCertIdForWeek(mdui, me, weekId);
  if (certId && certId !== 0n) {
    $("procFoundCertId").value = String(certId);
    $("procCertId").value = String(certId); // auto-fill for Approve & Pay
  } else {
    $("procFoundCertId").value = "not found";
  }
};

$("btnProcPreviewCert").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer || provider);

  let certIdStr = ($("procCertId").value || $("procFoundCertId").value || "").trim();
  if (!certIdStr || certIdStr === "not found") return alert("No certId to preview.");
  let certId; try { certId = BigInt(certIdStr); } catch { return alert("Bad certId value."); }

  try {
    const [cert, computed, proc] = await mdui.previewCertification(certId);
    const obj = {
      cert: {
        claimant: cert.claimant,
        weekId: String(cert.weekId),
        flags: Number(cert.flags),
        inputs: {
          reportedEarnings: Number(cert.inputs.reportedEarnings) / 1_000_000,
          availableForWork: Boolean(cert.inputs.availableForWork),
          jobSearchCompliant: Boolean(cert.inputs.jobSearchCompliant),
          workedFullTime: Boolean(cert.inputs.workedFullTime),
        },
        status: Number(cert.status),
        submittedAt: Number(cert.submittedAt),
      },
      computedAmountUSD: Number(computed) / 1_000_000,
      proc: {
        status: Number(proc.status),
        lockedAmountUSD: Number(proc.lockedAmount) / 1_000_000,
        decidedAt: Number(proc.decidedAt),
        rejectReason: proc.rejectReason
      }
    };
    $("procCertPreviewJson").textContent = JSON.stringify(obj, null, 2);
  } catch (e) {
    console.error(e);
    $("procCertPreviewJson").textContent = "previewCertification failed.";
  }
};

$("btnApproveAndPay").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const certId = BigInt($("procCertId").value || "0"); if (certId === 0n) return alert("Enter a certId.");
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer);
  const rec = await (await mdui.approveAndPay(certId)).wait();
  alert("Approve & Pay done. Tx: " + rec.hash);
};

$("btnReject").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const certId = BigInt($("procCertId").value || "0"); if (certId === 0n) return alert("Enter a certId.");
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer);
  const rec = await (await mdui.rejectCertification(certId, $("rejectReason").value || "")).wait();
  alert("Rejected. Tx: " + rec.hash);
};

// Owner + token utilities
$("btnSetProcessor").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer);
  const rec = await (await mdui.setProcessor($("newProcessor").value.trim(), $("newProcessorAllowed").value === "true")).wait();
  alert("setProcessor done. Tx: " + rec.hash);
};
$("btnBurnReissue").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer);
  const rec = await (await mdui.adminBurnAndReissueAll($("oldWallet").value.trim(), $("newWallet").value.trim())).wait();
  alert("Reissued. Tx: " + rec.hash);
};
$("btnSetWBA").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer);
  const rec = await (await mdui.testSetBaseWeeklyBenefit($("wbaAddress").value.trim(), usdToScaled($("wbaUsd").value))).wait();
  alert("WBA set. Tx: " + rec.hash);
};
$("btnSetDeps").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer);
  const rec = await (await mdui.testSetDependents($("depAddress").value.trim(), Number($("depCount").value || 0))).wait();
  alert("Dependents set. Tx: " + rec.hash);
};
$("btnSetPolicy").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer);
  const disregard = usdToScaled($("disregardUsd").value || "50");
  const taperBps = Number($("taperBps").value || 0);
  const max = usdToScaled($("maxWkUsd").value || "430");
  const rec = await (await mdui.testSetPolicy(disregard, taperBps, max)).wait();
  alert("Policy set. Tx: " + rec.hash);
};

// Token tools
$("refreshBalances").onclick = async () => {
  await fetchMduiInfo();
  let out = {};
  try {
    const me = await signer.getAddress();
    const token = $("tokenAddress").value.trim();
    if (token) {
      const t = new ethers.Contract(token, ERC20_TEST_ABI, signer || provider);
      const [name, symbol, dec, total, bal] = await Promise.all([
        (async()=>{ try { return await t.name(); } catch { return "Token"; } })(),
        (async()=>{ try { return await t.symbol(); } catch { return "TOK"; } })(),
        (async()=>{ try { return await t.decimals(); } catch { return 6; } })(),
        (async()=>{ try { return await t.totalSupply(); } catch { return 0n; } })(),
        (async()=>{ try { return await t.balanceOf(me); } catch { return 0n; } })(),
      ]);
      out["MDUI.token()"] = {
        token, name, symbol, decimals: Number(dec),
        totalSupply: Number(total) / 10**Number(dec),
        myBalance: Number(bal) / 10**Number(dec)
      };
    }
    const ext = $("extTokenAddr").value.trim();
    if (ext) {
      const e20 = new ethers.Contract(ext, ERC20_TEST_ABI, signer || provider);
      const [name, symbol, dec, total, bal] = await Promise.all([
        e20.name(), e20.symbol(), e20.decimals(), e20.totalSupply(), e20.balanceOf(me)
      ]);
      out["External ERC20"] = { address: ext, name, symbol, decimals: Number(dec), totalSupply: Number(total) / 10**Number(dec), myBalance: Number(bal) / 10**Number(dec) };
    }
  } catch (e) { console.error(e); out["error"] = "Failed to read token(s)."; }
  $("tokenInfo").textContent = JSON.stringify(out, null, 2);
};

// Wire & boot
$("connectBtn").onclick = connectWallet;
$("btnInitRead").onclick = fetchMduiInfo;
$("saveConfig").onclick = saveConfig;
$("loadConfig").onclick = loadConfig;
$("clearConfig").onclick = clearConfig;
loadConfig();
     
   

  



 
 

   
    

 
 

 
  
   

