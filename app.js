// MDUI Landing — Ethers v6
let provider, signer;
const SCALE = 1_000_000n; // 6 decimals (on MCC6 in MDUI)

// --- ABIs ---
// Minimal MDUIProcessorAligned ABI (functions the UI uses)
const MDUI_ABI = [
  // views
  {"type":"function","name":"owner","stateMutability":"view","inputs":[],"outputs":[{"type":"address"}]},
  {"type":"function","name":"processor","stateMutability":"view","inputs":[{"type":"address"}],"outputs":[{"type":"bool"}]},
  {"type":"function","name":"token","stateMutability":"view","inputs":[],"outputs":[{"type":"address"}]},
  {"type":"function","name":"SCALE","stateMutability":"view","inputs":[],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"disregard","stateMutability":"view","inputs":[],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"maxWeeklyPayout","stateMutability":"view","inputs":[],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"baseWeeklyBenefit","stateMutability":"view","inputs":[{"type":"address"}],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"dependents","stateMutability":"view","inputs":[{"type":"address"}],"outputs":[{"type":"uint8"}]},
  {"type":"function","name":"getCertificationCount","stateMutability":"view","inputs":[],"outputs":[{"type":"uint256"}]},

  // certification helpers
  {"type":"function","name":"getCertificationId","stateMutability":"view","inputs":[{"type":"address"},{"type":"uint256"}],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"previewPayout","stateMutability":"view","inputs":[
      {"type":"address"}, {"type":"uint256"}, {"type":"bool"}, {"type":"bool"}, {"type":"bool"}
    ],"outputs":[{"type":"uint256"}]},

  // preview with tuples (Certification, uint256, ProcRecord)
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
    ], "type":"tuple"},
    {"type":"uint256"},
    {"components":[
      {"name":"status","type":"uint8"},
      {"name":"lockedAmount","type":"uint256"},
      {"name":"decidedAt","type":"uint64"},
      {"name":"rejectReason","type":"string"}
    ],"type":"tuple"}
  ]},

  // txns
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
  {"type":"function","name":"approveCertification","stateMutability":"nonpayable","inputs":[{"type":"uint256"}],"outputs":[]},
  {"type":"function","name":"payApproved","stateMutability":"nonpayable","inputs":[{"type":"uint256"}],"outputs":[]},
  {"type":"function","name":"approveAndPay","stateMutability":"nonpayable","inputs":[{"type":"uint256"}],"outputs":[]},
  {"type":"function","name":"rejectCertification","stateMutability":"nonpayable","inputs":[{"type":"uint256"},{"type":"string"}],"outputs":[]},
  {"type":"function","name":"setProcessor","stateMutability":"nonpayable","inputs":[{"type":"address"},{"type":"bool"}],"outputs":[]},
  {"type":"function","name":"testSetBaseWeeklyBenefit","stateMutability":"nonpayable","inputs":[{"type":"address"},{"type":"uint256"}],"outputs":[]},
  {"type":"function","name":"testSetPolicy","stateMutability":"nonpayable","inputs":[{"type":"uint256"},{"type":"uint16"},{"type":"uint256"}],"outputs":[]},
  {"type":"function","name":"testSetDependents","stateMutability":"nonpayable","inputs":[{"type":"address"},{"type":"uint8"}],"outputs":[]}
];

// Minimal token ABIs
const MCC6_ABI = [
  {"type":"function","name":"decimals","stateMutability":"view","inputs":[],"outputs":[{"type":"uint8"}]},
  {"type":"function","name":"balanceOf","stateMutability":"view","inputs":[{"type":"address"}],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"transfer","stateMutability":"nonpayable","inputs":[{"type":"address"},{"type":"uint256"}],"outputs":[{"type":"bool"}]},
  {"type":"function","name":"approve","stateMutability":"nonpayable","inputs":[{"type":"address"},{"type":"uint256"}],"outputs":[{"type":"bool"}]},
  {"type":"function","name":"transferFrom","stateMutability":"nonpayable","inputs":[{"type":"address"},{"type":"address"},{"type":"uint256"}],"outputs":[{"type":"bool"}]},
  {"type":"function","name":"owner","stateMutability":"view","inputs":[],"outputs":[{"type":"address"}]},
  {"type":"function","name":"mint","stateMutability":"nonpayable","inputs":[{"type":"address"},{"type":"uint256"}],"outputs":[]}
];

// OpenZeppelin ERC-20 (MarylandCrabCoin) + mintForTesting
const ERC20_TEST_ABI = [
  {"type":"function","name":"name","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]},
  {"type":"function","name":"symbol","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]},
  {"type":"function","name":"decimals","stateMutability":"view","inputs":[],"outputs":[{"type":"uint8"}]},
  {"type":"function","name":"totalSupply","stateMutability":"view","inputs":[],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"balanceOf","stateMutability":"view","inputs":[{"type":"address"}],"outputs":[{"type":"uint256"}]},
  {"type":"function","name":"mintForTesting","stateMutability":"nonpayable","inputs":[{"type":"address"},{"type":"uint256"}],"outputs":[]}
];

// --- Helpers ---
const $ = (id) => document.getElementById(id);
const fmtAddr = (a) => a ? (a.slice(0,6) + '…' + a.slice(-4)) : '—';
const toBigInt = (n) => BigInt(Math.trunc(Number(n)));
function usdToScaled(usdStr) {
  // convert "123.45" => BigInt 123450000 (6 decimals)
  const n = Number(usdStr || 0);
  return BigInt(Math.round(n * 1_000_000));
}
function scaledToUsd(bi, decimals = 6) {
  const d = Number(decimals);
  const factor = 10 ** d;
  return Number(bi) / factor;
}
function statusBadge(s) {
  switch(Number(s)) {
    case 0: return "NotSubmitted";
    case 1: return "Submitted";
    default: return String(s);
  }
}
function procStatusBadge(s) {
  switch(Number(s)) {
    case 0: return "None";
    case 1: return "Approved";
    case 2: return "Rejected";
    case 3: return "Paid";
    default: return String(s);
  }
}

function saveConfig() {
  const data = {
    mdui: $("mduiAddress").value
  };
  localStorage.setItem("mdui-config", JSON.stringify(data));
}
function loadConfig() {
  const str = localStorage.getItem("mdui-config");
  if (!str) return;
  try {
    const obj = JSON.parse(str);
    if (obj.mdui) $("mduiAddress").value = obj.mdui;
  } catch {}
}
function clearConfig() {
  localStorage.removeItem("mdui-config");
}

// --- Tabs ---
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("tab")) {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
    e.target.classList.add("active");
    const tab = e.target.getAttribute("data-tab");
    document.getElementById("tab-" + tab).classList.add("active");
  }
});

// --- Wallet ---
async function connectWallet() {
  if (!window.ethereum) { alert("MetaMask not found."); return; }
  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = await provider.getSigner();
  const net = await provider.getNetwork();
  $("networkName").textContent = net.name + " (chainId " + net.chainId + ")";
  $("accountAddr").textContent = fmtAddr(await signer.getAddress());
}

async function fetchMduiInfo() {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer || provider);

  try {
    const [owner, token, me, amProc] = await Promise.all([
      mdui.owner(),
      mdui.token(),
      signer.getAddress(),
      (async()=>{ try { return await mdui.processor(await signer.getAddress()); } catch { return false; } })()
    ]);
    $("mduiOwner").value = owner;
    $("tokenAddress").value = token;
    $("amIProcessor").value = amProc ? "Yes" : "No";

    // token balance
    const t = new ethers.Contract(token, MCC6_ABI, signer || provider);
    const [dec, bal] = await Promise.all([
      (async()=>{ try { return await t.decimals(); } catch { return 6; } })(),
      t.balanceOf(me)
    ]);
    $("myMccBalance").value = scaledToUsd(bal, Number(dec)).toFixed(6);

  } catch (err) {
    console.error(err);
    alert("Failed reading MDUI — check address & network.");
  }
}

function computeFlags() {
  let f = 0;
  if ($("flagSchool").checked) f |= (1 << 0);   // FLAG_ATTENDED_SCHOOL
  if ($("flagCommission").checked) f |= (1 << 1); // FLAG_COMMISSION_THIS_WEEK
  return f;
}

function keccakHex(str) {
  const bytes = ethers.toUtf8Bytes(str);
  const hash = ethers.keccak256(bytes);
  return hash;
}

$("btnRandSalt").onclick = () => {
  const rand = ethers.hexlify(ethers.randomBytes(8));
  $("accountSalt").value = rand;
};

// --- Claimant actions ---
$("btnPreviewPayout").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer || provider);

  const me = await signer.getAddress();
  const earn = usdToScaled($("earnUsd").value);
  const avail = $("availableForWork").value === "true";
  const js = $("jobSearchCompliant").value === "true";
  const ftime = $("workedFullTime").value === "true";

  try {
    const out = await mdui.previewPayout(me, earn, avail, js, ftime);
    $("previewResult").textContent = "Estimated payout: $" + scaledToUsd(out, 6).toFixed(2);
  } catch (e) {
    console.error(e);
    $("previewResult").textContent = "Preview error — check inputs & policy seed.";
  }
};

$("btnSubmitCert").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer);

  const weekId = BigInt($("weekId").value || "0");
  if (weekId === 0n) return alert("Week ID required.");

  // answersHash from JSON
  let answersStr = $("answersJson").value.trim();
  if (!answersStr) answersStr = "[]";
  let parsed;
  try { parsed = JSON.parse(answersStr); } catch { return alert("Answers must be valid JSON."); }
  const answersHash = keccakHex(JSON.stringify(parsed));

  // accountRef = keccak256(account# + ":" + salt + ":" + weekId)
  const acct = ($("accountNumber").value || "").trim();
  const salt = ($("accountSalt").value || "").trim() || ethers.hexlify(ethers.randomBytes(8));
  $("accountSalt").value = salt; // keep
  const accountRef = keccakHex(`${acct}:${salt}:${weekId.toString()}`);

  const earn = usdToScaled($("earnUsd").value);
  const avail = $("availableForWork").value === "true";
  const js = $("jobSearchCompliant").value === "true";
  const ftime = $("workedFullTime").value === "true";
  const flags = computeFlags();

  try {
    const tx = await mdui.submitCertification(weekId, answersHash, accountRef, earn, avail, js, ftime, flags);
    const rec = await tx.wait();
    alert("Submitted. Tx hash: " + rec.hash);
  } catch (e) {
    console.error(e);
    alert("Submit failed — check network, your policy seed (WBA), and that you haven't already submitted this week.");
  }
};

$("btnLookupCertId").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer || provider);
  const me = await signer.getAddress();
  const weekId = BigInt($("lookupWeekId").value || "0");
  if (weekId === 0n) return alert("Week ID required.");
  try {
    const certId = await mdui.getCertificationId(me, weekId);
    $("foundCertId").value = String(certId);
  } catch (e) {
    console.error(e);
    $("foundCertId").value = "error";
  }
};

$("btnPreviewCert").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer || provider);
  const certId = BigInt(($("foundCertId").value || "0"));
  if (certId === 0n) return alert("Enter or resolve a certId first.");
  try {
    const res = await mdui.previewCertification(certId);
    const [cert, computed, proc] = res;
    const obj = {
      cert: {
        claimant: cert.claimant,
        weekId: String(cert.weekId),
        answersHash: cert.answersHash,
        accountRef: cert.accountRef,
        flags: Number(cert.flags),
        inputs: {
          reportedEarnings: scaledToUsd(cert.inputs.reportedEarnings, 6),
          availableForWork: Boolean(cert.inputs.availableForWork),
          jobSearchCompliant: Boolean(cert.inputs.jobSearchCompliant),
          workedFullTime: Boolean(cert.inputs.workedFullTime),
        },
        status: statusBadge(cert.status),
        submittedAt: Number(cert.submittedAt),
      },
      computedAmountUSD: scaledToUsd(computed, 6),
      proc: {
        status: procStatusBadge(proc.status),
        lockedAmountUSD: scaledToUsd(proc.lockedAmount, 6),
        decidedAt: Number(proc.decidedAt),
        rejectReason: proc.rejectReason
      }
    };
    $("certPreviewJson").textContent = JSON.stringify(obj, null, 2);
  } catch (e) {
    console.error(e);
    $("certPreviewJson").textContent = "previewCertification failed.";
  }
};

// --- Processor/Admin ---
$("btnApprove").onclick = async () => {
  await processorAction("approveCertification");
};
$("btnPay").onclick = async () => {
  await processorAction("payApproved");
};
$("btnApproveAndPay").onclick = async () => {
  await processorAction("approveAndPay");
};
$("btnReject").onclick = async () => {
  const reason = $("rejectReason").value || "";
  await processorAction("rejectCertification", reason);
};

async function processorAction(fn, extra) {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer);
  const certId = BigInt($("procCertId").value || "0");
  if (certId === 0n) return alert("Enter a certId.");

  try {
    const tx = extra === undefined ? await mdui[fn](certId) : await mdui[fn](certId, extra);
    const rec = await tx.wait();
    alert(`${fn} done. Tx: ${rec.hash}`);
  } catch (e) {
    console.error(e);
    alert(`${fn} failed — are you a processor? Check state & inputs.`);
  }
}

// owner utils
$("btnSetProcessor").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer);
  const who = $("newProcessor").value.trim();
  const allowed = $("newProcessorAllowed").value === "true";
  try {
    const tx = await mdui.setProcessor(who, allowed);
    const rec = await tx.wait();
    alert("setProcessor done. Tx: " + rec.hash);
  } catch (e) {
    console.error(e);
    alert("setProcessor failed — only owner can do this.");
  }
};

$("btnBurnReissue").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer);
  const oldW = $("oldWallet").value.trim();
  const newW = $("newWallet").value.trim();
  try {
    const tx = await mdui.adminBurnAndReissueAll(oldW, newW);
    const rec = await tx.wait();
    alert("Reissued. Tx: " + rec.hash);
  } catch (e) {
    console.error(e);
    alert("Reissue failed — only owner can do this.");
  }
};

$("btnSetWBA").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer);
  const who = $("wbaAddress").value.trim();
  const amt = usdToScaled($("wbaUsd").value);
  try {
    const tx = await mdui.testSetBaseWeeklyBenefit(who, amt);
    const rec = await tx.wait();
    alert("WBA set. Tx: " + rec.hash);
  } catch (e) {
    console.error(e);
    alert("Setting WBA failed — owner-only in most deployments.");
  }
};

$("btnSetDeps").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer);
  const who = $("depAddress").value.trim();
  const dep = Number($("depCount").value || 0);
  try {
    const tx = await mdui.testSetDependents(who, dep);
    const rec = await tx.wait();
    alert("Dependents set. Tx: " + rec.hash);
  } catch (e) {
    console.error(e);
    alert("Setting dependents failed — owner-only in most deployments.");
  }
};

$("btnSetPolicy").onclick = async () => {
  const addr = $("mduiAddress").value.trim();
  if (!addr) return alert("Enter MDUI contract address.");
  if (!provider) await connectWallet();
  const mdui = new ethers.Contract(addr, MDUI_ABI, signer);
  const disregard = usdToScaled($("disregardUsd").value || "50");
  const taperBps = Number($("taperBps").value || 0);
  const max = usdToScaled($("maxWkUsd").value || "430");
  try {
    const tx = await mdui.testSetPolicy(disregard, taperBps, max);
    const rec = await tx.wait();
    alert("Policy set. Tx: " + rec.hash);
  } catch (e) {
    console.error(e);
    alert("Setting policy failed — owner-only in most deployments.");
  }
};

// Token tools
$("refreshBalances").onclick = async () => {
  await fetchMduiInfo();
  let out = {};
  try {
    const me = await signer.getAddress();
    // MDUI-owned token
    const token = $("tokenAddress").value.trim();
    if (token) {
      const t = new ethers.Contract(token, MCC6_ABI, signer || provider);
      const [dec, bal] = await Promise.all([t.decimals(), t.balanceOf(me)]);
      out["MDUI.token()"] = { token, decimals: Number(dec), balance: Number(bal) / 10**Number(dec) };
    }
    // external demo token (MarylandCrabCoin)
    const ext = $("extTokenAddr").value.trim();
    if (ext) {
      const e20 = new ethers.Contract(ext, ERC20_TEST_ABI, signer || provider);
      const [name, symbol, dec, total, bal] = await Promise.all([
        e20.name(), e20.symbol(), e20.decimals(), e20.totalSupply(), e20.balanceOf(me)
      ]);
      out["External ERC20"] = { address: ext, name, symbol, decimals: Number(dec), totalSupply: Number(total) / 10**Number(dec), myBalance: Number(bal) / 10**Number(dec) };
    }
  } catch (e) {
    console.error(e);
    out["error"] = "Failed to read token(s).";
  }
  $("tokenInfo").textContent = JSON.stringify(out, null, 2);
};

$("btnMintTest").onclick = async () => {
  const ext = $("extTokenAddr").value.trim();
  if (!ext) return alert("Paste the external ERC-20 address first.");
  if (!provider) await connectWallet();
  const e20 = new ethers.Contract(ext, ERC20_TEST_ABI, signer);
  const me = await signer.getAddress();
  const amt = Number($("mintAmount").value || 0);
  if (amt <= 0) return alert("Enter amount to mint.");
  try {
    const dec = await e20.decimals();
    const scaled = BigInt(Math.round(amt * (10 ** Number(dec))));
    const tx = await e20.mintForTesting(me, scaled);
    const rec = await tx.wait();
    alert("Minted. Tx: " + rec.hash);
  } catch (e) {
    console.error(e);
    alert("Mint failed — ensure contract has mintForTesting and you're on the correct network.");
  }
};

// UI wiring
$("connectBtn").onclick = connectWallet;
$("btnInitRead").onclick = fetchMduiInfo;
$("saveConfig").onclick = saveConfig;
$("loadConfig").onclick = loadConfig;
$("clearConfig").onclick = clearConfig;

// On load
loadConfig();
