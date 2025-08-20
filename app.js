
/* app.js — cleaned (no duplicate vars/consts), ethers v6 UMD */

"use strict";

// ----------------- Globals & constants -----------------
let provider, signer;
const SCALE = 1_000_000n;
const SCAN_LINEAR_MAX = 600n; // linear scan upper bound for certIds as last resort
const DEBUG = false;

// --------------- ABIs (trimmed to what we call) ---------------
const MDUI_ABI = [
  {"type":"function","name":"owner","stateMutability":"view","inputs":[],"outputs":[{"type":"address"}]},
  {"type":"function","name":"processor","stateMutability":"view","inputs":[{"type":"address"}],"outputs":[{"type":"bool"}]},
  {"type":"function","name":"token","stateMutability":"view","inputs":[],"outputs":[{"type":"address"}]},

  // ID & reads
  {"type":"function","name":"getCertificationId","stateMutability":"view","inputs":[{"type":"address"},{"type":"uint256"}],"outputs":[{"type":"bool"},{"type":"uint256"}]},
  {"type":"function","name":"getCertification","stateMutability":"view","inputs":[{"type":"uint256"}],"outputs":[
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
    ],"type":"tuple"}
  ]},
  {"type":"function","name":"previewPayout","stateMutability":"view","inputs":[
    {"type":"address"},{"type":"uint256"},{"type":"bool"},{"type":"bool"},{"type":"bool"}
  ],"outputs":[{"type":"uint256"}]},

  // Processor read (view)
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

  // Mutations
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

  // Admin / Recovery / Policy
  {"type":"function","name":"adminBurnAndReissueAll","stateMutability":"nonpayable","inputs":[{"type":"address"},{"type":"address"}],"outputs":[]},
  {"type":"function","name":"setProcessor","stateMutability":"nonpayable","inputs":[{"type":"address"},{"type":"bool"}],"outputs":[]},
  {"type":"function","name":"testSetBaseWeeklyBenefit","stateMutability":"nonpayable","inputs":[{"type":"address"},{"type":"uint256"}],"outputs":[]},
  {"type":"function","name":"testSetPolicy","stateMutability":"nonpayable","inputs":[{"type":"uint256"},{"type":"uint16"},{"type":"uint256"}],"outputs":[]},
  {"type":"function","name":"testSetDependents","stateMutability":"nonpayable","inputs":[{"type":"address"},{"type":"uint8"}],"outputs":[]}
];

const MCC6_ABI = [
  {"type":"function","name":"decimals","stateMutability":"view","inputs":[],"outputs":[{"type":"uint8"}]},
  {"type":"function","name":"balanceOf","stateMutability":"view","inputs":[{"type":"address"}],"outputs":[{"type":"uint256"}]}
];

// ----------------- Small helpers -----------------
const $ = (id) => document.getElementById(id);
const fmtAddr = (a) => a ? (a.slice(0,6) + "…" + a.slice(-4)) : "—";
const keccakHex = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const usdToScaled = (v) => BigInt(Math.round(Number(v || 0) * 1_000_000));
const scaledToUsd = (bi, d = 6) => Number(bi) / (10 ** Number(d));
const logD = (...args) => { if (DEBUG) console.log("[resolver]", ...args); };

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

// ----------------- Tabs -----------------
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("tab")) {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
    e.target.classList.add("active");
    document.getElementById("tab-" + e.target.getAttribute("data-tab")).classList.add("active");
  }
});

// ----------------- Wallet -----------------
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

// ----------------- Config persistence -----------------
function saveConfig(){ localStorage.setItem("mdui-config", JSON.stringify({ mdui: $("mduiAddress").value })); }
function loadConfig(){ try { const s = localStorage.getItem("mdui-config"); if (s) $("mduiAddress").value = JSON.parse(s).mdui || ""; } catch{} }
function clearConfig(){ localStorage.removeItem("mdui-config"); }

// ----------------- Read MDUI summary -----------------
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
    const [dec, bal] = await Promise.all([
      (async()=>{ try { return await t.decimals(); } catch { return 6; } })(),
      t.balanceOf(me)
    ]);
    $("myMccBalance").value = scaledToUsd(bal, Number(dec)).toFixed(Number(dec));
  } catch (e) {
    console.error(e);
    alert("Failed reading MDUI.");
  }
}

// ----------------- Claimant: preview & submit -----------------
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
  $("previewResult").textContent = out
    ? ("Estimated payout: $" + scaledToUsd(out, 6).toFixed(2))
    : "Preview error — seed WBA/Policy first?";
};

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

  const id = await resolveCertIdForWeek(mdui, me, weekId);
  if (id && id !== 0n) cacheCertId(me, weekId, id);
};

// ----------------- WeekID -> certId resolution -----------------
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
  // 0) cache
  let id = readCachedCertId(me, weekId);
  if (id && id !== 0n) { logD("cached id", id); return id; }

  // 1) getter + confirm
  try {
    const res = await mdui.getCertificationId(me, weekId);
    let found = false, maybeId = 0n;
    if (Array.isArray(res)) { found = Boolean(res[0]); maybeId = BigInt(res[1] || 0); }
    else { maybeId = BigInt(res || 0); found = maybeId !== 0n; }
    if (found && maybeId && maybeId !== 0n) {
      const cert = await mdui.getCertification(maybeId);
      if (BigInt(cert.weekId) === weekId && cert.claimant?.toLowerCase() === me.toLowerCase()) {
        return maybeId;
      }
    }
  } catch (e) { logD("direct getter failed", e?.message); }

  // 2) final resort: linear scan
  for (let i = 0n; i <= SCAN_LINEAR_MAX; i++) {
    try {
      const cert = await mdui.getCertification(i);
      if (!cert?.claimant) continue;
      if (cert.claimant.toLowerCase() === me.toLowerCase() && BigInt(cert.weekId) === weekId) {
        logD("linear scan hit at", i);
        return i;
      }
    } catch { /* gap */ }
  }
  return 0n;
}

// ----------------- Claimant: lookup & preview -----------------
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
  } catch (e) {
    console.error(e);
    $("certPreviewJson").textContent = "previewCertification failed (processor-only).";
  }
};

// ----------------- Processor: preview / approve / reject -----------------
$("btnProcPreviewCert").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer || provider);

  const certIdStr = ($("procCertId").value || "").trim();
  if (!certIdStr) return alert("Enter a certId to preview.");
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
    $("procCertPreviewJson").textContent = "previewCertification failed (are you a processor?).";
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

// ----------------- Admin: Change Access / Recovery / Policy -----------------
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

  const oldAddr = ($("oldWallet").value || "").trim();
  const newAddr = ($("newWallet").value || "").trim();

  if (!ethers.isAddress(oldAddr) || !ethers.isAddress(newAddr)) {
    return alert("Please enter valid Ethereum addresses for old and new wallets.");
  }
  if (oldAddr.toLowerCase() === newAddr.toLowerCase()) {
    return alert("Old and new wallet cannot be the same.");
  }

  const mdui = new ethers.Contract(addr, MDUI_ABI, signer);

  try {
    const [me, owner] = await Promise.all([signer.getAddress(), mdui.owner()]);
    if (owner.toLowerCase() !== me.toLowerCase()) {
      return alert("Only the MDUI contract owner can perform Recovery (Burn & Reissue).");
    }

    if (!confirm(`Reissue all tokens from:\n${oldAddr}\n→ to:\n${newAddr}\n\nProceed?`)) return;

    $("btnBurnReissue").disabled = true;
    const tx = await mdui.adminBurnAndReissueAll(oldAddr, newAddr);
    const rec = await tx.wait();

    alert("Reissued. Tx: " + rec.hash);
  } catch (e) {
    console.error(e);
    alert(`Recovery failed: ${e?.shortMessage || e?.reason || e?.message || e}`);
  } finally {
    $("btnBurnReissue").disabled = false;
  }
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
  const taperBps = 0; // Maryland does not use taper; hard-coded to 0
  const max = usdToScaled($("maxWkUsd").value || "430");
  const rec = await (await mdui.testSetPolicy(disregard, taperBps, max)).wait();
  alert("Policy set. Tx: " + rec.hash);
};

// ----------------- Wire & boot -----------------
$("connectBtn").onclick = connectWallet;
$("btnInitRead").onclick = fetchMduiInfo;
$("saveConfig").onclick = saveConfig;
$("loadConfig").onclick = loadConfig;
$("clearConfig").onclick = clearConfig;
loadConfig();
