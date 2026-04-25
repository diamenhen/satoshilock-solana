'use client';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
} from '@solana/spl-token';

const PROGRAM_ID   = new PublicKey('CE7vQdyjXSEvPdeEdrmbEpM8hSPZi2L4MKAWi26kpZ2H');
const DISC_CREATE  = new Uint8Array([171, 216, 92, 167, 165, 8, 153, 90]);
const DISC_CLAIM   = new Uint8Array([62, 198, 214, 193, 213, 159, 108, 210]);
const ATOK_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const WSOL_MINT    = 'So11111111111111111111111111111111111111112';
const GAS_RESERVE_SOL = 0.01;

// ═══ On-chain Lock Account Layout (171 bytes total, VERIFIED) ═══════════════
// Reverse-engineered from 3 real lock accounts + cross-referenced with known
// values. See dumpLocks.js output for original analysis.
const LOCK_OFFSETS = {
  creator:     8,    // Pubkey (32)
  recipient:   40,   // Pubkey (32)
  mint:        72,   // Pubkey (32)
  amount:      104,  // u64 (8)
  withdrawn:   112,  // u64 (8)  ← amount already claimed
  startTime:   120,  // i64 (8)
  endTime:     128,  // i64 (8)
  cliffTime:   136,  // i64 (8)
  cancelAuth:  144,  // u8  (1)
  updateAuth:  145,  // u8  (1)
  nonce:       146,  // u64 (8)
  // byte 154 = bump or padding (1)
  freqSecs:    155,  // u64 (8)
  cliffAmount: 163,  // u64 (8)
};
const LOCK_ACCOUNT_SIZE = 171;

const DUR_UNITS = [
  { label: 'Minute', value: 60 },
  { label: 'Day',    value: 86400 },
  { label: 'Week',   value: 604800 },
  { label: 'Month',  value: 2592000 },
  { label: 'Year',   value: 31536000 },
];

const MAJOR_TOKEN_MINTS = [
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
];

const MAJOR_TOKENS_FALLBACK = [
  { address:'So11111111111111111111111111111111111111112',  symbol:'SOL',     name:'Solana',           decimals:9, logoURI:'' },
  { address:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  symbol:'USDC',    name:'USD Coin',         decimals:6, logoURI:'' },
  { address:'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  symbol:'USDT',    name:'USDT',             decimals:6, logoURI:'' },
  { address:'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',   symbol:'JUP',     name:'Jupiter',          decimals:6, logoURI:'' },
  { address:'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',  symbol:'BONK',    name:'Bonk',             decimals:5, logoURI:'' },
  { address:'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',  symbol:'WIF',     name:'dogwifhat',        decimals:6, logoURI:'' },
  { address:'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',   symbol:'JTO',     name:'Jito',             decimals:9, logoURI:'' },
  { address:'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',  symbol:'PYTH',    name:'Pyth Network',     decimals:6, logoURI:'' },
  { address:'4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',  symbol:'RAY',     name:'Raydium',          decimals:6, logoURI:'' },
  { address:'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',    symbol:'ORCA',    name:'Orca',             decimals:6, logoURI:'' },
  { address:'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',   symbol:'mSOL',    name:'Marinade SOL',     decimals:9, logoURI:'' },
  { address:'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',  symbol:'JitoSOL', name:'Jito Staked SOL',  decimals:9, logoURI:'' },
];

function writeU64LE(arr, o, v) { const b=BigInt(Math.floor(Number(v))); for(let i=0;i<8;i++) arr[o+i]=Number((b>>BigInt(i*8))&BigInt(0xff)); }
function writeI64LE(arr, o, v) { const b=BigInt(Math.floor(Number(v))); for(let i=0;i<8;i++) arr[o+i]=Number((b>>BigInt(i*8))&BigInt(0xff)); }

function fmtDur(s) {
  if(s>=31536000) return (s/31536000).toFixed(1)+' yr';
  if(s>=2592000)  return Math.round(s/2592000)+' mo';
  if(s>=604800)   return Math.round(s/604800)+' wk';
  if(s>=86400)    return Math.round(s/86400)+' d';
  if(s>=3600)     return Math.round(s/3600)+' hr';
  if(s>=60)       return Math.round(s/60)+' min';
  return s+' sec';
}
function fmtDate(ts) {
  if(!ts) return '—';
  return new Date(ts*1000).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function fmtDateShort(ts) {
  if(!ts) return '—';
  const d = new Date(ts*1000);
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+', '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
}
function fmtRelative(secs) {
  if (secs <= 0) return 'now';
  if (secs < 60)    return Math.round(secs)+'s';
  if (secs < 3600)  return Math.round(secs/60)+'m';
  if (secs < 86400) { const h=Math.floor(secs/3600); const m=Math.round((secs%3600)/60); return m?`${h}h ${m}m`:`${h}h`; }
  if (secs < 2592000) return Math.round(secs/86400)+'d';
  if (secs < 31536000) return Math.round(secs/2592000)+'mo';
  return Math.round(secs/31536000)+'y';
}
function shortAddr(a) { return a?a.slice(0,4)+'...'+a.slice(-4):'—'; }
function numFmt(n, dec=4) { return Number(n).toLocaleString('en-US',{maximumFractionDigits:dec}); }
function getToday() { return new Date().toISOString().split('T')[0]; }
function getNowTime() { const d=new Date(); return d.toTimeString().slice(0,5); }

// ─── On-chain lock fetching ──────────────────────────────────────────────
// Fetches all lock accounts where the wallet is creator OR recipient.
// Returns raw on-chain data — caller must merge with cache for UI-friendly
// fields like title, tokenSymbol, tokenLogo.
async function fetchOnChainLocks(connection, publicKey) {
  if (!publicKey) return [];
  const pubkeyStr = publicKey.toBase58();
  const seen = new Set();
  const results = [];

  // Query creator (offset 8) + recipient (offset 40), dedupe by address
  for (const offset of [LOCK_OFFSETS.creator, LOCK_OFFSETS.recipient]) {
    try {
      const accs = await connection.getProgramAccounts(PROGRAM_ID, {
        commitment: 'confirmed',
        filters: [{ memcmp: { offset, bytes: pubkeyStr } }],
      });
      for (const a of accs) {
        const addr = a.pubkey.toBase58();
        if (!seen.has(addr)) { seen.add(addr); results.push(a); }
      }
    } catch (e) { console.warn(`fetchOnChainLocks offset ${offset}:`, e.message); }
  }

  return results.map(a => parseLockAccount(a.account.data, a.pubkey)).filter(Boolean);
}

function parseLockAccount(data, pda) {
  if (data.length < LOCK_ACCOUNT_SIZE) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const readPubkey = (o) => new PublicKey(data.slice(o, o + 32)).toBase58();
  try {
    return {
      lock:            pda.toBase58(),
      sender:          readPubkey(LOCK_OFFSETS.creator),
      recipient:       readPubkey(LOCK_OFFSETS.recipient),
      mintAddress:     readPubkey(LOCK_OFFSETS.mint),
      amountRaw:       view.getBigUint64(LOCK_OFFSETS.amount, true),
      withdrawnRaw:    view.getBigUint64(LOCK_OFFSETS.withdrawn, true),
      cliffAmountRaw:  view.getBigUint64(LOCK_OFFSETS.cliffAmount, true),
      startTs:         Number(view.getBigInt64(LOCK_OFFSETS.startTime, true)),
      endTs:           Number(view.getBigInt64(LOCK_OFFSETS.endTime, true)),
      cliffTs:         Number(view.getBigInt64(LOCK_OFFSETS.cliffTime, true)),
      freqSecs:        Number(view.getBigUint64(LOCK_OFFSETS.freqSecs, true)),
      cancelAuth:      data[LOCK_OFFSETS.cancelAuth],
      transferAuth:    data[LOCK_OFFSETS.updateAuth],
      nonce:           view.getBigUint64(LOCK_OFFSETS.nonce, true).toString(),
    };
  } catch (e) { return null; }
}

// Enrich on-chain locks with metadata from localStorage cache.
// On-chain data is source of truth for amounts/timing. Cache provides
// human-readable extras: title, tokenSymbol, tokenLogo, durLabel, etc.
function mergeOnChainWithCache(onChain, cache) {
  const cacheByLock = new Map(cache.filter(s => s.lock).map(s => [s.lock, s]));
  return onChain.map(oc => {
    const cached = cacheByLock.get(oc.lock);
    const tokenDecimals = cached?.tokenDecimals ?? (oc.mintAddress === WSOL_MINT ? 9 : 6);
    const decDivisor = Math.pow(10, tokenDecimals);

    // If cache missing, derive human-readable freq from freqSecs
    // Pick the largest DUR_UNIT that divides freqSecs evenly
    let freqValue = cached?.freqValue;
    let freqUnit  = cached?.freqUnit;
    if ((freqValue === undefined || freqUnit === undefined) && oc.freqSecs > 0) {
      for (let i = DUR_UNITS.length - 1; i >= 0; i--) {
        const unit = DUR_UNITS[i].value;
        if (oc.freqSecs % unit === 0) {
          freqUnit = unit;
          freqValue = oc.freqSecs / unit;
          break;
        }
      }
      if (freqValue === undefined) {  // fallback: seconds
        freqValue = oc.freqSecs;
        freqUnit  = 1;
      }
    }

    return {
      // On-chain authoritative values
      lock: oc.lock,
      sender: oc.sender,
      recipient: oc.recipient,
      mintAddress: oc.mintAddress,
      amt: Number(oc.amountRaw) / decDivisor,
      withdrawn: Number(oc.withdrawnRaw) / decDivisor,
      cliffAmount: Number(oc.cliffAmountRaw) / decDivisor,
      startTs: oc.startTs,
      endTs: oc.endTs,
      cliffTs: oc.cliffTs,
      freqSecs: oc.freqSecs,
      cancelAuth: oc.cancelAuth,
      transferAuth: oc.transferAuth,
      nonce: oc.nonce,
      // From cache (fallback defaults if not cached)
      title: cached?.title || '',
      token: cached?.token || (oc.mintAddress === WSOL_MINT ? 'SOL' : oc.mintAddress.slice(0, 4)),
      tokenLogo: cached?.tokenLogo || '',
      tokenDecimals,
      isToken2022: cached?.isToken2022 || false,
      freqValue,
      freqUnit,
      durLabel: cached?.durLabel || fmtDur(oc.endTs - oc.startTs),
      txId: cached?.txId,
    };
  });
}


export default function LockForm() {
  const { publicKey, disconnect, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const { setVisible: setWalletModalVisible } = useWalletModal();

  const [tab,  setTab]  = useState('about');
  const [now,  setNow]  = useState(Date.now()/1000);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()/1000), 1000);
    return () => clearInterval(t);
  }, []);

  const [mintAddress,   setMintAddress]   = useState('');
  const [tokenSymbol,   setTokenSymbol]   = useState('');
  const [tokenName,     setTokenName]     = useState('');
  const [tokenDecimals, setTokenDecimals] = useState(6);
  const [tokenLoading,  setTokenLoading]  = useState(false);
  const [tokenFound,    setTokenFound]    = useState(false);
  const [isToken2022,   setIsToken2022]   = useState(false);
  const [tokenLogo,     setTokenLogo]     = useState('');
  const [walletBalance, setWalletBalance] = useState(null);
  const [showTokenPicker, setShowTokenPicker] = useState(false);
  const [tokenQuery, setTokenQuery]  = useState('');
  const [tokenList,  setTokenList]   = useState([]);
  const [tokenListLoading, setTokenListLoading] = useState(false);

  const [lockTitle,    setLockTitle]    = useState('');
  const [amount,       setAmount]       = useState('');
  const [recipient,    setRecipient]    = useState('');
  const [cliffDate,    setCliffDate]    = useState(getToday());
  const [cliffTime2,   setCliffTime2]   = useState(getNowTime());
  const [cliffAmount,  setCliffAmount]  = useState('');
  const [durValue,     setDurValue]     = useState('');
  const [durUnit,      setDurUnit]      = useState(2592000);
  const [freqValue,    setFreqValue]    = useState('');
  const [freqUnit,     setFreqUnit]     = useState(2592000);
  const [cancelAuth,   setCancelAuth]   = useState(0);
  const [transferAuth, setTransferAuth] = useState(0);

  const [streams, setStreams] = useState(() => {
    if (typeof window === 'undefined') return [];
    try { const s = localStorage.getItem('satoshilock_streams'); return s ? JSON.parse(s) : []; }
    catch { return []; }
  });

  const [alert,        setAlert]        = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [claimLoading, setClaimLoading] = useState({});
  const [onChainLoading, setOnChainLoading] = useState(false);
  const [titleFocused,     setTitleFocused]     = useState(false);
  const [recipientFocused, setRecipientFocused] = useState(false);

  const titleHistory = useMemo(() => {
    const set = new Set();
    streams.forEach(s => { if (s.title && s.title.trim()) set.add(s.title.trim()); });
    return Array.from(set).slice(0, 5);
  }, [streams]);

  const recipientHistory = useMemo(() => {
    const set = new Set();
    streams.forEach(s => { if (s.recipient) set.add(s.recipient); });
    return Array.from(set).slice(0, 5);
  }, [streams]);

  function showAlert(msg, type) { setAlert({msg,type}); setTimeout(()=>setAlert(null),6000); }

  // ─── Fetch locks from on-chain, merge with cache, update state ───────
  // Called automatically on wallet connect + can be triggered manually via
  // refresh button. On-chain is source of truth — cache-only locks (that no
  // longer exist on-chain) get filtered out, so stale entries self-heal.
  const refreshOnChainLocks = useCallback(async () => {
    if (!publicKey || !connection) return;
    setOnChainLoading(true);
    try {
      const onChain = await fetchOnChainLocks(connection, publicKey);
      setStreams(prev => {
        const merged = mergeOnChainWithCache(onChain, prev);
        // Preserve any cache-only entries that might be in-flight (just created
        // but RPC hasn't propagated yet). Keyed by lock address.
        const onChainLocks = new Set(onChain.map(o => o.lock));
        const pendingLocal = prev.filter(s =>
          s.lock && !onChainLocks.has(s.lock) &&
          // Only keep if freshly created (< 30s old) — avoids showing ghost
          // entries from locks that were cancelled/claimed outside this UI
          s.startTs && (Date.now()/1000 - s.startTs) < 30
        );
        // Sort by startTs descending — newest locks at top
        const combined = [...pendingLocal, ...merged].sort((a, b) => (b.startTs || 0) - (a.startTs || 0));
        try { localStorage.setItem('satoshilock_streams', JSON.stringify(combined)); } catch {}
        return combined;
      });
    } catch (e) {
      console.error('refreshOnChainLocks:', e);
    } finally {
      setOnChainLoading(false);
    }
  }, [publicKey, connection]);

  // Auto-fetch on wallet connect (or wallet change)
  useEffect(() => {
    if (publicKey) refreshOnChainLocks();
  }, [publicKey, refreshOnChainLocks]);


  const cliffTs = useMemo(() => {
    if (!cliffDate) return null;
    return Math.floor(new Date(`${cliffDate}T${cliffTime2||'00:00'}:00`).getTime()/1000);
  }, [cliffDate, cliffTime2]);

  const startTs  = cliffTs;
  const durSecs  = useMemo(() => Math.floor((parseFloat(durValue)||0) * durUnit), [durValue, durUnit]);
  const endTs    = useMemo(() => cliffTs ? cliffTs + durSecs : null, [cliffTs, durSecs]);
  const freqSecs = useMemo(() => Math.floor((parseFloat(freqValue)||0) * freqUnit), [freqValue, freqUnit]);

  // Naikin grace period ke 5 menit (sebelumnya 60 detik) supaya user tidak
  // "dihukum" karena ngisi form pelan-pelan.
  // Cliff status: 'future' | 'grace' (past 0-5 min) | 'past' (past >5 min) | null
  const cliffStatus = useMemo(() => {
    if (!cliffTs) return null;
    const delta = cliffTs - now;
    if (delta >= 0) return 'future';
    if (delta >= -300) return 'grace';
    return 'past';
  }, [cliffTs, now]);
  const cliffInPast = cliffStatus === 'past';
  const cliffInGrace = cliffStatus === 'grace';
  const perPeriod = useMemo(() => {
    const amt = parseFloat(amount) || 0;
    const cliff = parseFloat(cliffAmount) || 0;
    if (!amt || !durSecs || !freqSecs) return 0;
    const remaining = Math.max(0, amt - cliff);
    const totalPeriods = Math.max(1, Math.floor(durSecs / freqSecs));
    return remaining / totalPeriods;
  }, [amount, cliffAmount, durSecs, freqSecs]);

  useEffect(() => {
    if (!tokenFound || !mintAddress || !publicKey) { setWalletBalance(null); return; }
    const run = async () => {
      try {
        const mintPubkey   = new PublicKey(mintAddress);
        const tokenProgram = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        const ata = await getAssociatedTokenAddress(mintPubkey, publicKey, false, tokenProgram);
        const info = await connection.getParsedAccountInfo(ata);
        const splBal = info?.value?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;

        if (mintAddress === WSOL_MINT) {
          const lamports = await connection.getBalance(publicKey);
          const nativeSol = lamports / LAMPORTS_PER_SOL;
          const spendable = Math.max(0, nativeSol - GAS_RESERVE_SOL) + splBal;
          setWalletBalance(spendable);
        } else {
          setWalletBalance(splBal);
        }
      } catch { setWalletBalance(null); }
    };
    run();
  }, [tokenFound, mintAddress, publicKey, isToken2022, connection]);

  useEffect(() => {
    if (!showTokenPicker) return;
    const controller = new AbortController();
    const q = tokenQuery.trim();
    const run = async () => {
      setTokenListLoading(true);
      try {
        const queryParam = q
          ? encodeURIComponent(q)
          : MAJOR_TOKEN_MINTS.join(',');
        const url = `https://lite-api.jup.ag/tokens/v2/search?query=${queryParam}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          setTokenList(!q ? MAJOR_TOKENS_FALLBACK : []);
          setTokenListLoading(false);
          return;
        }
        const raw = await res.json();
        const arr = Array.isArray(raw) ? raw : (raw?.tokens || []);
        let normalized = arr.map(t => ({
          address: t.id || t.mint || t.address,
          symbol:  t.symbol || '',
          name:    t.name || '',
          logoURI: t.icon || t.logoURI || t.logo_uri || t.logo || '',
          decimals: t.decimals ?? 6,
        })).filter(t => t.address);

        if (!q) {
          const byAddr = new Map(normalized.map(t => [t.address, t]));
          normalized = MAJOR_TOKEN_MINTS
            .map(m => byAddr.get(m))
            .filter(Boolean);
          if (normalized.length === 0) normalized = MAJOR_TOKENS_FALLBACK;
        } else {
          normalized = normalized.slice(0, 50);
        }
        setTokenList(normalized);
      } catch(e) {
        if (e.name !== 'AbortError') {
          setTokenList(!q ? MAJOR_TOKENS_FALLBACK : []);
        }
      }
      setTokenListLoading(false);
    };
    const t = setTimeout(run, 220);
    return () => { clearTimeout(t); controller.abort(); };
  }, [tokenQuery, showTokenPicker]);

  async function selectTokenFromPicker(t) {
    setShowTokenPicker(false);
    setTokenQuery('');
    setMintAddress(t.address);
    setTokenSymbol(t.symbol || t.address.slice(0,4)+'...');
    setTokenName(t.name || '');
    setTokenLogo(t.logoURI || '');
    setTokenLoading(true);
    try {
      const mintInfo = await connection.getParsedAccountInfo(new PublicKey(t.address));
      const decimals = mintInfo?.value?.data?.parsed?.info?.decimals ?? t.decimals ?? 6;
      const t22 = mintInfo?.value?.owner?.toString() === TOKEN_2022_PROGRAM_ID.toString();
      setTokenDecimals(decimals); setIsToken2022(t22);
      setTokenFound(true);
    } catch { setTokenFound(false); }
    setTokenLoading(false);
  }

  async function createLock() {
    if (!tokenFound)                    { showAlert('Select a token first.','info'); return; }
    if (!amount||parseFloat(amount)<=0) { showAlert('Enter amount to lock.','info'); return; }
    if (!recipient)                     { showAlert('Enter recipient wallet address.','info'); return; }
    if (!cliffTs)                       { showAlert('Set a cliff date.','info'); return; }
    if (cliffInPast)                    { showAlert('Cliff date cannot be in the past.','warn'); return; }
    if (!durSecs||durSecs<60)           { showAlert('Vesting duration must be at least 1 minute.','info'); return; }
    if (!freqSecs||freqSecs<60)         { showAlert('Unlock frequency must be at least 1 minute.','info'); return; }
    if (durSecs >= freqSecs && durSecs % freqSecs !== 0) {
      showAlert('Duration must be divisible by frequency. Adjust to align schedule.','warn'); return;
    }
    if (!publicKey)                     { showAlert('Connect your wallet.','warn'); return; }
    if (walletBalance !== null && parseFloat(amount) > walletBalance) {
      showAlert('Insufficient token balance.','warn'); return;
    }

    let recipientPubkey;
    try { recipientPubkey = new PublicKey(recipient); }
    catch { showAlert('Invalid wallet address.','warn'); return; }

    setLoading(true);
    try {
      const mintPubkey   = new PublicKey(mintAddress);
      const tokenProgram = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      const totalUnits   = Math.floor(parseFloat(amount) * Math.pow(10, tokenDecimals));
      const nonce        = BigInt(Date.now());
      const nonceBytes   = new Uint8Array(8);
      writeU64LE(nonceBytes, 0, nonce);

      const [lockPDA] = await PublicKey.findProgramAddress(
        [Buffer.from('lock'), mintPubkey.toBytes(), publicKey.toBytes(), recipientPubkey.toBytes(), nonceBytes],
        PROGRAM_ID
      );

      const escrowToken  = await getAssociatedTokenAddress(mintPubkey, lockPDA, true, tokenProgram);
      const creatorToken = await getAssociatedTokenAddress(mintPubkey, publicKey, false, tokenProgram);

      const cliffUnits = Math.floor((parseFloat(cliffAmount) || 0) * Math.pow(10, tokenDecimals));
      const data = new Uint8Array(8 + 8 + 8 + 8 + 8 + 1 + 1 + 8 + 8 + 8);
      data.set(DISC_CREATE, 0);
      writeU64LE(data, 8,  totalUnits);
      writeI64LE(data, 16, startTs);
      writeI64LE(data, 24, endTs);
      writeI64LE(data, 32, cliffTs || startTs);
      data[40] = cancelAuth;
      data[41] = transferAuth;
      writeU64LE(data, 42, nonce);
      writeU64LE(data, 50, freqSecs);
      writeU64LE(data, 58, cliffUnits);

      const tx = new Transaction();
      const creatorInfo = await connection.getAccountInfo(creatorToken);
      if (!creatorInfo) {
        tx.add(createAssociatedTokenAccountInstruction(publicKey, creatorToken, publicKey, mintPubkey, tokenProgram));
      }

      const isSOL = mintAddress === WSOL_MINT;
      if (isSOL) {
        let wsolAtaLamports = 0;
        if (creatorInfo) {
          try {
            const parsed = await connection.getParsedAccountInfo(creatorToken);
            wsolAtaLamports = Number(parsed?.value?.data?.parsed?.info?.tokenAmount?.amount || 0);
          } catch {}
        }
        const shortage = totalUnits - wsolAtaLamports;
        if (shortage > 0) {
          const nativeLamports = await connection.getBalance(publicKey);
          const gasLamports = Math.floor(GAS_RESERVE_SOL * LAMPORTS_PER_SOL);
          if (nativeLamports - shortage < gasLamports) {
            showAlert(`Not enough SOL. Keep at least ${GAS_RESERVE_SOL} SOL for gas.`,'warn');
            setLoading(false); return;
          }
          tx.add(SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey:   creatorToken,
            lamports:   shortage,
          }));
          tx.add(createSyncNativeInstruction(creatorToken, tokenProgram));
        }
      }

      tx.add({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: publicKey,               isSigner:true,  isWritable:true  },
          { pubkey: recipientPubkey,         isSigner:false, isWritable:false },
          { pubkey: mintPubkey,              isSigner:false, isWritable:false },
          { pubkey: lockPDA,                 isSigner:false, isWritable:true  },
          { pubkey: creatorToken,            isSigner:false, isWritable:true  },
          { pubkey: escrowToken,             isSigner:false, isWritable:true  },
          { pubkey: tokenProgram,            isSigner:false, isWritable:false },
          { pubkey: ATOK_PROGRAM,            isSigner:false, isWritable:false },
          { pubkey: SystemProgram.programId, isSigner:false, isWritable:false },
        ],
        data,
      });

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      if (!signTransaction) { showAlert('Wallet not ready. Reconnect and try again.','warn'); setLoading(false); return; }
      const signed    = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight:false });
      await connection.confirmTransaction(signature, 'confirmed');

      setStreams(prev => {
        const updated = [{
          title: lockTitle, token: tokenSymbol, tokenLogo,
          amt: parseFloat(amount), recipient, mintAddress,
          startTs, endTs,
          cliffTs: cliffTs,
          cliffAmount: cliffAmount ? parseFloat(cliffAmount) : 0,
          freqSecs, freqValue, freqUnit,
          pct:0, cancelAuth, transferAuth,
          status: 'upcoming',
          sender: publicKey.toString(), txId: signature,
          lock: lockPDA.toString(),
          nonce: nonce.toString(),
          durLabel: fmtDur(durSecs),
          isToken2022, tokenDecimals,
          withdrawn: 0,
        }, ...prev];
        localStorage.setItem('satoshilock_streams', JSON.stringify(updated));
        return updated;
      });

      showAlert('Lock created successfully! 🎉','success');
      setLockTitle(''); setAmount(''); setRecipient(''); setCliffAmount('');
      setDurValue(''); setFreqValue('');
      setMintAddress(''); setTokenFound(false); setTokenSymbol(''); setTokenName(''); setTokenLogo('');
      setIsToken2022(false);
      setTab('streams');

      // Refresh from on-chain after a short delay to let RPC propagate
      setTimeout(() => { refreshOnChainLocks(); }, 2000);

    } catch(err) {
      console.error(err);
      showAlert('Transaction failed: '+(err.message||'Unknown error'),'warn');
    }
    setLoading(false);
  }

  async function claimTokens(stream, index) {
    if (!publicKey) { showAlert('Connect your wallet to claim.','warn'); return; }
    setClaimLoading(prev => ({...prev, [index]:true}));
    try {
      const mintPubkey     = new PublicKey(stream.mintAddress);
      const tokenProgram   = stream.isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      const lockPDA        = new PublicKey(stream.lock);
      const escrowToken    = await getAssociatedTokenAddress(mintPubkey, lockPDA, true, tokenProgram);
      const recipientToken = await getAssociatedTokenAddress(mintPubkey, publicKey, false, tokenProgram);

      const data = new Uint8Array(16);
      data.set(DISC_CLAIM, 0);
      for (let i=0; i<8; i++) data[8+i] = 0xff;

      const tx = new Transaction();
      const recipientInfo = await connection.getAccountInfo(recipientToken);
      if (!recipientInfo) {
        tx.add(createAssociatedTokenAccountInstruction(publicKey, recipientToken, publicKey, mintPubkey, tokenProgram));
      }
      tx.add({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: lockPDA,                 isSigner:false, isWritable:true  },
          { pubkey: publicKey,               isSigner:true,  isWritable:true  },
          { pubkey: mintPubkey,              isSigner:false, isWritable:false },
          { pubkey: escrowToken,             isSigner:false, isWritable:true  },
          { pubkey: recipientToken,          isSigner:false, isWritable:true  },
          { pubkey: tokenProgram,            isSigner:false, isWritable:false },
          { pubkey: ATOK_PROGRAM,            isSigner:false, isWritable:false },
          { pubkey: SystemProgram.programId, isSigner:false, isWritable:false },
        ],
        data,
      });

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      if (!signTransaction) { showAlert('Wallet not ready. Reconnect and try again.','warn'); setClaimLoading(prev => ({...prev, [index]:false})); return; }
      const signed    = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight:false });
      await connection.confirmTransaction(signature, 'confirmed');

      showAlert('Claimed successfully! 🎉','success');
      setStreams(prev => {
        const s = prev[index];
        const totalSecs    = Math.max(1, s.endTs - s.startTs);
        const elapsed      = Math.max(0, now - s.startTs);
        const freqSecs     = Math.max(1, s.freqSecs || totalSecs);
        const totalSteps   = Math.max(1, Math.floor(totalSecs / freqSecs));
        const stepsElapsed = Math.min(totalSteps, Math.floor(elapsed / freqSecs));
        const vested       = now >= s.endTs
          ? s.amt
          : s.amt * (stepsElapsed / totalSteps);
        const updated = prev.map((item,i) => i===index
          ? {...item, lastClaimed: now, withdrawn: Math.min(item.amt, vested)}
          : item);
        localStorage.setItem('satoshilock_streams', JSON.stringify(updated));
        return updated;
      });

      // Refresh from on-chain for authoritative `withdrawn` amount
      setTimeout(() => { refreshOnChainLocks(); }, 2000);
    } catch(err) {
      console.error(err);
      showAlert('Claim failed: '+(err.message||'Unknown error'),'warn');
    }
    setClaimLoading(prev => ({...prev, [index]:false}));
  }

  function getStreamStats(st) {
    const totalSecs  = Math.max(1, st.endTs - st.startTs);
    const elapsed    = Math.max(0, now - st.startTs);
    const freqSecs   = Math.max(1, st.freqSecs || totalSecs);

    const totalSteps   = Math.max(1, Math.floor(totalSecs / freqSecs));
    const stepsElapsed = Math.min(totalSteps, Math.floor(elapsed / freqSecs));
    const stepFraction = now >= st.endTs ? 1 : stepsElapsed / totalSteps;

    const vested    = st.amt * stepFraction;
    const withdrawn = st.withdrawn || 0;
    const claimable = Math.max(0, vested - withdrawn);

    const pctUnlocked = Math.round(stepFraction * 100 * 100)/100;
    const pctClaimed  = st.amt > 0 ? Math.round((withdrawn / st.amt) * 100 * 100)/100 : 0;

    const isLive = now >= st.startTs;
    const isDone = now >= st.endTs;

    let nextUnlock = null;
    if (isLive && !isDone && st.freqSecs) {
      const sinceStart = now - st.startTs;
      const periods    = Math.floor(sinceStart / st.freqSecs);
      nextUnlock       = st.startTs + (periods + 1) * st.freqSecs;
      if (nextUnlock > st.endTs) nextUnlock = st.endTs;
    }

    return { vested, claimable, pctUnlocked, pctClaimed, isLive, isDone, nextUnlock };
  }

  const receivedStreams = streams.filter(s => publicKey && s.recipient === publicKey.toString());
  const createdStreams  = streams.filter(s => publicKey && s.sender    === publicKey.toString());

  const summaryLines = useMemo(() => {
    const lines = [];
    const amt = parseFloat(amount) || 0;
    const cliff = parseFloat(cliffAmount) || 0;
    if (!tokenFound || !amt) return lines;
    lines.push(`You are locking up a total of ${numFmt(amt)} ${tokenSymbol}.`);
    if (cliffTs) {
      const cliffStr = new Date(cliffTs*1000).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
      if (cliff > 0) lines.push(`The lock will cliff on ${cliffStr}, with a cliff unlock amount of ${numFmt(cliff)} ${tokenSymbol}.`);
      else           lines.push(`The lock will cliff on ${cliffStr}.`);
    }
    if (durSecs && freqSecs && endTs) {
      const remaining = Math.max(0, amt - cliff);
      const totalPeriods = Math.max(1, Math.floor(durSecs / freqSecs));
      const freqLabel = DUR_UNITS.find(u=>u.value===freqUnit)?.label?.toLowerCase() || 'period';
      const durLabel  = DUR_UNITS.find(u=>u.value===durUnit)?.label?.toLowerCase()  || 'period';
      lines.push(`The remaining ${numFmt(remaining)} ${tokenSymbol} will vest over ${durValue} ${durLabel}(s) at a rate of ${numFmt(perPeriod)} ${tokenSymbol} every ${freqValue} ${freqLabel}(s) from ${fmtDateShort(cliffTs)} – ${fmtDateShort(endTs)}.`);
    }
    const cancelMap = {0:'No one can cancel the lock', 1:'Only creator can cancel the lock', 2:'Only recipient can cancel the lock', 3:'Creator or recipient can cancel the lock'};
    const transferMap = {0:'No one can update the lock', 1:'Only creator can update the lock', 2:'Only recipient can update the lock', 3:'Creator or recipient can update the lock'};
    lines.push(cancelMap[cancelAuth]);
    lines.push(transferMap[transferAuth]);
    return lines;
  }, [tokenFound, amount, cliffAmount, cliffTs, durSecs, freqSecs, endTs, perPeriod, durValue, freqValue, durUnit, freqUnit, tokenSymbol, cancelAuth, transferAuth]);

  const proceedText = (() => {
    if (!publicKey) return 'Connect wallet';
    if (loading) return 'Creating lock...';
    if (!tokenFound) return 'Select token';
    if (!amount || parseFloat(amount)<=0) return 'Enter amount';
    if (walletBalance !== null && parseFloat(amount) > walletBalance) return 'Insufficient balance';
    if (!recipient) return 'Enter recipient';
    if (cliffInPast) return 'Cliff date in past';
    if (!durSecs) return 'Enter duration';
    if (!freqSecs) return 'Enter frequency';
    // Block if schedule is misaligned — duration not divisible by frequency
    if (durSecs >= freqSecs && durSecs % freqSecs !== 0) return 'Fix schedule alignment';
    return 'Create lock';
  })();

  const proceedEnabled = proceedText === 'Create lock';

  return (
    <div style={S.page}>
      <Fonts />

      <div style={S.navbar}>
        <div style={S.navInner}>
          <div style={S.brand} onClick={()=>setTab('about')}>
            <MonogramS size={28} />
            <div style={S.brandName}>SatoshiLock</div>
          </div>

          <div style={S.navRight}>
            {!connected
              ? <button style={S.connectBtn} onClick={()=>setWalletModalVisible(true)}>Connect wallet</button>
              : (
                <button style={S.walletPill} onClick={()=>disconnect()}>
                  <span style={S.walletDot} />
                  <span>{shortAddr(publicKey?.toString())}</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
                </button>
              )
            }
          </div>
        </div>

        <div style={S.navTabs}>
          {[
            ['about','About'],
            ['locked','Your locked tokens'],
            ['streams','Locks you created'],
            ['create','Create lock'],
          ].map(([k,l]) => (
            <button key={k} onClick={()=>setTab(k)}
              style={{...S.navTab, ...(tab===k?S.navTabActive:{})}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {alert && (
        <div style={{...S.alertToast, ...S.alertTypes[alert.type]}}>
          <div style={{...S.alertIcon, background:S.alertTypes[alert.type].borderLeftColor+'20', color:S.alertTypes[alert.type].borderLeftColor}}>
            {alert.type==='success'?'✓':alert.type==='warn'?'!':'i'}
          </div>
          <div>
            <div style={{fontWeight:700,fontSize:13,color:COLORS.text}}>
              {alert.type==='success'?'Success':alert.type==='warn'?'Warning':'Info'}
            </div>
            <div style={{fontSize:11,color:COLORS.textDim,marginTop:2}}>{alert.msg}</div>
          </div>
        </div>
      )}

      <div style={S.main}>
        {tab==='about'  && <AboutPanel onCreate={()=>setTab('create')} onLocked={()=>setTab('locked')} publicKey={publicKey} />}
        {tab==='locked' && <LocksTable title="Your locked tokens" rows={receivedStreams} getStats={getStreamStats} onClaim={claimTokens} claimLoading={claimLoading} role="recipient" publicKey={publicKey} onCreate={()=>setTab('create')} now={now} onRefresh={refreshOnChainLocks} refreshing={onChainLoading} />}
        {tab==='streams'&& <LocksTable title="Locks you created"  rows={createdStreams}  getStats={getStreamStats} onClaim={claimTokens} claimLoading={claimLoading} role="creator"   publicKey={publicKey} onCreate={()=>setTab('create')} now={now} onRefresh={refreshOnChainLocks} refreshing={onChainLoading} />}

        {tab==='create' && (
          <div style={{width:'100%',maxWidth:560}}>
            <div style={S.pageTitle}>Create token lock</div>

            {!publicKey ? (
              <div style={{textAlign:'center',padding:'3rem 1rem'}}>
                <button style={{...S.primaryCta, width:'auto', padding:'11px 24px', margin:'0 auto'}} onClick={()=>setWalletModalVisible(true)}>Connect wallet</button>
              </div>
            ) : (
              <>
                <div style={S.sectionLabelRow}>
                  <span style={S.sectionNum}>1</span>
                  <span style={S.sectionLabel}>Select token</span>
                </div>
                <div style={S.card}>
                  <div style={S.label}>Token</div>
                  {!tokenFound ? (
                    <button style={S.selectTokenBtn} onClick={()=>setShowTokenPicker(true)}>
                      <span style={{color:COLORS.textMute}}>Search tokens</span>
                      <ChevronDown />
                    </button>
                  ) : (
                    <button style={S.selectedTokenBtn} onClick={()=>setShowTokenPicker(true)}>
                      <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
                        {tokenLogo
                          ? <img src={tokenLogo} alt="" style={{width:30,height:30,borderRadius:'50%',objectFit:'cover',flexShrink:0}} onError={e=>e.target.style.display='none'} />
                          : <div style={{width:30,height:30,borderRadius:'50%',background:COLORS.accent,color:COLORS.bg,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:13,flexShrink:0}}>{(tokenSymbol||'?')[0]}</div>}
                        <div style={{textAlign:'left',minWidth:0}}>
                          <div style={{fontWeight:700,fontSize:14,color:COLORS.text}}>{tokenSymbol}</div>
                          <div style={{fontSize:11,color:COLORS.textMute,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{tokenName || 'Token'}</div>
                        </div>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <span style={{fontSize:11,fontFamily:'monospace',color:COLORS.textMute}}>{mintAddress.slice(0,4)}...{mintAddress.slice(-4)}</span>
                        <ChevronDown />
                      </div>
                    </button>
                  )}
                </div>

                {tokenFound && <>
                  <div style={{...S.sectionLabelRow, marginTop:24}}>
                    <span style={S.sectionNum}>2</span>
                    <span style={S.sectionLabel}>Configure lock</span>
                  </div>
                  <div style={S.card}>
                    <div style={{...S.field, position:'relative'}}>
                      <div style={S.label}>Lock title</div>
                      <input style={S.input} placeholder="eg. Team Tokens"
                        value={lockTitle}
                        onChange={e=>setLockTitle(e.target.value)}
                        onFocus={()=>setTitleFocused(true)}
                        onBlur={()=>setTimeout(()=>setTitleFocused(false), 150)} />
                      {titleFocused && titleHistory.filter(t => t.toLowerCase().includes(lockTitle.toLowerCase()) && t !== lockTitle).length > 0 && (
                        <div style={S.suggestPopup}>
                          {titleHistory
                            .filter(t => t.toLowerCase().includes(lockTitle.toLowerCase()) && t !== lockTitle)
                            .map((t, idx) => (
                              <div key={idx} data-suggest-item style={S.suggestItem}
                                onMouseDown={e=>{ e.preventDefault(); setLockTitle(t); setTitleFocused(false); }}>
                                {t}
                              </div>
                            ))}
                        </div>
                      )}
                    </div>

                    <div style={S.field}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                        <div style={S.label}>Total lock amount</div>
                        {walletBalance !== null && (
                          <div style={{fontSize:11,color:COLORS.textDim,display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}
                            onClick={()=>setAmount(String(walletBalance))}>
                            <WalletIcon size={12} /> {numFmt(walletBalance)} {tokenSymbol}
                          </div>
                        )}
                      </div>
                      <div style={{position:'relative'}}>
                        <input style={{...S.input,paddingRight:70}} type="number" min="0" placeholder="0"
                          value={amount} onChange={e=>setAmount(e.target.value)} />
                        <div style={S.inputSuffix}>{tokenSymbol}</div>
                      </div>
                    </div>

                    <div style={{...S.field, position:'relative'}}>
                      <div style={S.label}>Recipient wallet address</div>
                      <div style={S.hint}>Recipient must manually claim vested tokens</div>
                      <input style={S.input} placeholder="Enter recipient wallet address"
                        value={recipient}
                        onChange={e=>setRecipient(e.target.value)}
                        onFocus={()=>setRecipientFocused(true)}
                        onBlur={()=>setTimeout(()=>setRecipientFocused(false), 150)} />
                      {recipientFocused && recipientHistory.filter(r => r.toLowerCase().includes(recipient.toLowerCase()) && r !== recipient).length > 0 && (
                        <div style={S.suggestPopup}>
                          {recipientHistory
                            .filter(r => r.toLowerCase().includes(recipient.toLowerCase()) && r !== recipient)
                            .map((r, idx) => (
                              <div key={idx} data-suggest-item style={{...S.suggestItem, fontFamily:'monospace', fontSize:12}}
                                onMouseDown={e=>{ e.preventDefault(); setRecipient(r); setRecipientFocused(false); }}>
                                {r.length > 32 ? r.slice(0, 20)+'...'+r.slice(-6) : r}
                              </div>
                            ))}
                        </div>
                      )}
                    </div>

                    <div style={S.field}>
                      <div style={{...S.label,display:'flex',alignItems:'center',gap:6}}>
                        Cliff date <InfoIcon title="Date when vesting begins" />
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 120px',gap:8}}>
                        <input style={S.input} type="date" value={cliffDate} onChange={e=>setCliffDate(e.target.value)} />
                        <input style={S.input} type="time" value={cliffTime2} onChange={e=>setCliffTime2(e.target.value)} />
                      </div>
                      {cliffInPast && <div style={S.errText}>Cliff date is too far in the past. Please choose a future time.</div>}
                      {cliffInGrace && <div style={S.warnText}>Cliff time just passed — that's fine, vesting will activate immediately.</div>}
                    </div>

                    <div style={S.field}>
                      <div style={{...S.label,display:'flex',alignItems:'center',gap:6}}>
                        Cliff unlock amount <span style={{color:COLORS.textMute,fontWeight:400}}>(optional)</span>
                        <InfoIcon title="Tokens unlocked immediately at cliff date" />
                      </div>
                      <div style={{position:'relative'}}>
                        <input style={{...S.input,paddingRight:70}} type="number" min="0" placeholder="0"
                          value={cliffAmount} onChange={e=>setCliffAmount(e.target.value)} />
                        <div style={S.inputSuffix}>{tokenSymbol}</div>
                      </div>
                    </div>

                    <div style={S.field}>
                      <div style={S.label}>Vesting duration</div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                        <input style={S.input} type="number" min="0" placeholder=""
                          value={durValue} onChange={e=>setDurValue(e.target.value)} />
                        <div style={{position:'relative'}}>
                          <select style={{...S.input,appearance:'none',paddingRight:32,cursor:'pointer'}}
                            value={durUnit} onChange={e=>setDurUnit(Number(e.target.value))}>
                            {DUR_UNITS.map(u=><option key={u.value} value={u.value}>{u.label}</option>)}
                          </select>
                          <div style={S.selectChevron}><ChevronDown /></div>
                        </div>
                      </div>
                    </div>

                    <div style={S.field}>
                      <div style={S.label}>Unlock frequency</div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                        <input style={S.input} type="number" min="0" placeholder=""
                          value={freqValue} onChange={e=>setFreqValue(e.target.value)} />
                        <div style={{position:'relative'}}>
                          <select style={{...S.input,appearance:'none',paddingRight:32,cursor:'pointer'}}
                            value={freqUnit} onChange={e=>setFreqUnit(Number(e.target.value))}>
                            {DUR_UNITS.map(u=><option key={u.value} value={u.value}>{u.label}</option>)}
                          </select>
                          <div style={S.selectChevron}><ChevronDown /></div>
                        </div>
                      </div>
                    </div>

                    {/* ── Step alignment preview & warning ── */}
                    <StepPreview
                      durSecs={durSecs}
                      freqSecs={freqSecs}
                      amount={parseFloat(amount) || 0}
                      cliffAmount={parseFloat(cliffAmount) || 0}
                      tokenSymbol={tokenSymbol}
                    />

                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:18}}>
                      <div>
                        <div style={S.label}>Who can cancel?</div>
                        <div style={{position:'relative'}}>
                          <select style={{...S.input,appearance:'none',paddingRight:32,cursor:'pointer'}}
                            value={cancelAuth} onChange={e=>setCancelAuth(Number(e.target.value))}>
                            <option value={0}>None</option>
                            <option value={1}>Only creator</option>
                            <option value={2}>Only recipient</option>
                            <option value={3}>Creator or recipient</option>
                          </select>
                          <div style={S.selectChevron}><ChevronDown /></div>
                        </div>
                      </div>
                      <div>
                        <div style={S.label}>Who can update recipient?</div>
                        <div style={{position:'relative'}}>
                          <select style={{...S.input,appearance:'none',paddingRight:32,cursor:'pointer'}}
                            value={transferAuth} onChange={e=>setTransferAuth(Number(e.target.value))}>
                            <option value={0}>None</option>
                            <option value={1}>Only creator</option>
                            <option value={2}>Only recipient</option>
                            <option value={3}>Creator or recipient</option>
                          </select>
                          <div style={S.selectChevron}><ChevronDown /></div>
                        </div>
                      </div>
                    </div>

                    {summaryLines.length > 0 && (
                      <div style={S.summaryBox}>
                        <div style={S.summaryTitle}>Lock summary</div>
                        {summaryLines.map((l,i) => (
                          <div key={i} style={S.summaryLine}>{l}</div>
                        ))}
                      </div>
                    )}
                  </div>

                  <button style={S.addAnother} onClick={()=>showAlert('Multiple locks in one transaction coming soon.','info')}>
                    + Add another lock
                  </button>

                  <button style={{...S.primaryCta, ...(proceedEnabled?{}:S.primaryCtaDisabled)}}
                    onClick={createLock} disabled={!proceedEnabled || loading}>
                    {loading && <span style={S.spinner} />}
                    {proceedText}
                  </button>
                </>}
              </>
            )}
          </div>
        )}
      </div>

      {showTokenPicker && (
        <div style={S.modalOverlay} onClick={()=>setShowTokenPicker(false)}>
          <div style={S.modalCard} onClick={e=>e.stopPropagation()}>
            <div style={S.modalSearch}>
              <div style={S.modalSearchIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              </div>
              <input style={S.modalSearchInput} autoFocus
                placeholder="Search tokens / paste contract address"
                value={tokenQuery} onChange={e=>setTokenQuery(e.target.value)} />
              <button style={S.modalClose} onClick={()=>setShowTokenPicker(false)}>✕</button>
            </div>
            {!tokenQuery.trim() && !tokenListLoading && tokenList.length > 0 && (
              <div style={S.modalSectionHeader}>Popular tokens</div>
            )}
            <div style={S.modalList}>
              {tokenListLoading && (
                <div style={{padding:'24px',textAlign:'center',fontSize:13,color:COLORS.textDim}}>Loading tokens...</div>
              )}
              {!tokenListLoading && tokenList.length === 0 && (
                <div style={{padding:'24px',textAlign:'center',fontSize:13,color:COLORS.textDim}}>No tokens found</div>
              )}
              {!tokenListLoading && tokenList.map((t,i)=>(
                <div key={t.address+i} style={S.modalRow} onClick={()=>selectTokenFromPicker(t)}
                  onMouseEnter={e=>e.currentTarget.style.background=COLORS.cardBgElevated}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <div style={{display:'flex',alignItems:'center',gap:12,minWidth:0}}>
                    {t.logoURI
                      ? <img src={t.logoURI} alt="" style={{width:34,height:34,borderRadius:'50%',objectFit:'cover',flexShrink:0}} onError={e=>e.target.style.display='none'} />
                      : <div style={{width:34,height:34,borderRadius:'50%',background:COLORS.accent,color:COLORS.bg,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:12,flexShrink:0}}>{(t.symbol||'?')[0]}</div>}
                    <div style={{minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:4,color:COLORS.text,fontWeight:700,fontSize:14}}>
                        {t.symbol}
                        <VerifiedIcon />
                      </div>
                      <div style={{fontSize:11,color:COLORS.textDim,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:180}}>{t.name}</div>
                    </div>
                  </div>
                  <div style={{fontSize:11,fontFamily:'monospace',color:COLORS.textMute,flexShrink:0}}>
                    {t.address.slice(0,4)}...{t.address.slice(-4)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════ Components ══════════
function LockLogo({ size=28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id="lockG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F4A460" />
          <stop offset="1" stopColor="#E87B3E" />
        </linearGradient>
      </defs>
      {/* Track ring — subtle, blends with dark bg */}
      <circle cx="16" cy="16" r="12" stroke="#1F2840" strokeWidth="2.4" fill="none" />
      {/* Gradient arc — ~85% filled, gap at top symbolizes "unlock opening" */}
      <circle cx="16" cy="16" r="12" stroke="url(#lockG)" strokeWidth="2.4" fill="none"
        strokeDasharray="75.4" strokeDashoffset="12"
        transform="rotate(-90 16 16)" strokeLinecap="round" />
      {/* Keyhole — circle + trapezoid */}
      <circle cx="16" cy="14" r="1.8" fill="url(#lockG)" />
      <path d="M14.8 15.5 L17.2 15.5 L17.8 20.5 L14.2 20.5 Z" fill="url(#lockG)" />
    </svg>
  );
}
function MonogramS({ size=28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect x="2" y="2" width="28" height="28" rx="6" stroke="#E87B3E" strokeWidth="2.2" fill="none"/>
      <text x="16" y="24" textAnchor="middle" fontFamily='"Arial Black", sans-serif' fontSize="22" fontWeight="900" fontStyle="italic" fill="#E87B3E">S</text>
    </svg>
  );
}
function ChevronDown() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{color:COLORS.textMute}}><path d="m6 9 6 6 6-6"/></svg>;
}
function InfoIcon({ title }) {
  return <span title={title} style={{display:'inline-flex',width:13,height:13,borderRadius:'50%',border:'1px solid '+COLORS.textMute,color:COLORS.textMute,alignItems:'center',justifyContent:'center',fontSize:9,cursor:'help',fontStyle:'italic'}}>i</span>;
}
function WalletIcon({ size=14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>;
}
function VerifiedIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill={COLORS.cyan}/><path d="m8.5 12.5 2.5 2.5 4.5-4.5" stroke={COLORS.bg} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function CopyIcon({ size=10, onClick }) {
  return <svg onClick={onClick} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{cursor:'pointer'}}>
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>;
}
function StepPreview({ durSecs, freqSecs, amount, cliffAmount, tokenSymbol }) {
  if (!durSecs || !freqSecs || durSecs < freqSecs) return null;

  const totalSteps = Math.floor(durSecs / freqSecs);
  const leftover = durSecs - (totalSteps * freqSecs);
  const remaining = Math.max(0, amount - cliffAmount);
  const perStep = totalSteps > 0 ? remaining / totalSteps : 0;
  const lastUnlockAt = totalSteps * freqSecs;
  const misaligned = leftover > 0;

  return (
    <div style={{
      background: misaligned ? 'rgba(248,113,113,0.06)' : 'rgba(125,211,252,0.06)',
      border: `1px solid ${misaligned ? 'rgba(248,113,113,0.3)' : 'rgba(125,211,252,0.2)'}`,
      borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 11, lineHeight: 1.6,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', marginBottom: 6,
        color: misaligned ? COLORS.red : COLORS.cyan,
      }}>
        {misaligned ? '⛔ Schedule misalignment' : 'Schedule preview'}
      </div>
      <div style={{color: COLORS.textDim}}>
        <span className="tabular" style={{color: COLORS.text, fontWeight: 600}}>{totalSteps}</span> unlock event{totalSteps > 1 ? 's' : ''} of{' '}
        {amount > 0 ? (
          <><span className="tabular" style={{color: COLORS.text, fontWeight: 600}}>{numFmt(perStep)}</span> {tokenSymbol}</>
        ) : (
          <span style={{color: COLORS.textMute}}>[amount]</span>
        )}
        {' '}every <span className="tabular" style={{color: COLORS.text, fontWeight: 600}}>{fmtDur(freqSecs)}</span>.
      </div>
      {misaligned && (
        <div style={{color: COLORS.red, marginTop: 6, fontWeight: 500}}>
          Last unlock at <span className="tabular">{fmtDur(lastUnlockAt)}</span>, then <span className="tabular">{fmtDur(leftover)}</span> of "dead time" before end. Fix frequency so it divides duration evenly.
        </div>
      )}
    </div>
  );
}


function FeatureChip({dot,label}) {
  return (
    <div style={{background:COLORS.cardBg,border:'1px solid '+COLORS.border,borderRadius:999,padding:'7px 14px',fontSize:12,color:COLORS.text,display:'flex',gap:7,alignItems:'center'}}>
      <span style={{width:7,height:7,borderRadius:'50%',background:dot}}/>
      {label}
    </div>
  );
}
function Fonts() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      body { margin:0; background:${COLORS.bg}; }
      input[type=number]::-webkit-inner-spin-button,
      input[type=number]::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
      input[type=number] { -moz-appearance:textfield; }
      input[type=date]::-webkit-calendar-picker-indicator,
      input[type=time]::-webkit-calendar-picker-indicator { filter:invert(0.6); cursor:pointer; }
      select option { background:${COLORS.cardBgElevated}; color:${COLORS.text}; }
      @keyframes spin { to { transform:rotate(360deg); } }
      @keyframes slideDown { from { transform:translateY(-12px); opacity:0; } to { transform:translateY(0); opacity:1; } }
      .satoshi-row:hover { background:${COLORS.cardBgElevated} !important; }
      div[data-suggest-item]:hover { background:${COLORS.cardBgElevated}; }
      /* Stable-width digits so live-updating numbers don't jitter */
      .tabular { font-variant-numeric: tabular-nums; }
    `}</style>
  );
}

function AboutPanel({ onCreate, onLocked, publicKey }) {
  return (
    <div style={{width:'100%',maxWidth:760,padding:'80px 24px 56px',textAlign:'center',margin:'0 auto'}}>

      {/* Brand mark */}
      <div style={{display:'inline-flex',alignItems:'center',gap:10,marginBottom:14}}>
        <MonogramS size={32} />
        <span style={{fontSize:24,fontWeight:500,color:COLORS.text,letterSpacing:'-0.01em'}}>SatoshiLock</span>
      </div>

      {/* Subtitle */}
      <p style={{fontSize:15,color:COLORS.textDim,lineHeight:1.5,margin:'0 0 36px',fontWeight:400}}>
        Token vesting on Solana. Native SOL and any SPL token.
      </p>

      {/* CTA Row */}
      <div style={{display:'flex',gap:10,justifyContent:'center',marginBottom:40,flexWrap:'wrap'}}>
        <button
          onClick={onCreate}
          style={{background:'#E87B3E',border:'none',borderRadius:999,padding:'10px 22px',fontSize:13,fontWeight:500,color:'#0B0C10',cursor:'pointer',fontFamily:'inherit'}}>
          Create lock
        </button>
        <button
          onClick={onLocked}
          style={{background:'transparent',border:'0.5px solid rgba(255,255,255,0.15)',borderRadius:999,padding:'10px 22px',fontSize:13,fontWeight:500,color:COLORS.text,cursor:'pointer',fontFamily:'inherit'}}>
          My locks
        </button>
      </div>

      {/* Stat cards */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,maxWidth:380,margin:'0 auto 32px'}}>
        <div style={{background:'#13141A',borderRadius:12,padding:'14px 12px',textAlign:'left'}}>
          <div style={{fontSize:10,color:'#6B6A65',letterSpacing:'0.06em',marginBottom:4}}>Network</div>
          <div style={{fontSize:13,fontWeight:500,color:COLORS.text}}>Solana</div>
        </div>
        <div style={{background:'#13141A',borderRadius:12,padding:'14px 12px',textAlign:'left'}}>
          <div style={{fontSize:10,color:'#6B6A65',letterSpacing:'0.06em',marginBottom:4}}>Wallet</div>
          <div style={{fontSize:13,fontWeight:500,color:publicKey ? COLORS.text : COLORS.textDim}}>
            {publicKey ? publicKey.toString().slice(0,4)+'...'+publicKey.toString().slice(-4) : 'Not connected'}
          </div>
        </div>
      </div>

      {/* Production contract strip */}
      <div style={{borderTop:'0.5px solid rgba(255,255,255,0.06)',paddingTop:18,maxWidth:380,margin:'0 auto',textAlign:'left'}}>
        <div style={{fontSize:10,color:'#6B6A65',letterSpacing:'0.06em',marginBottom:10}}>Production contract</div>
        <a href="https://solscan.io/account/CE7vQdyjXSEvPdeEdrmbEpM8hSPZi2L4MKAWi26kpZ2H" target="_blank" rel="noopener" style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',fontSize:13,textDecoration:'none'}}>
          <span style={{color:'#E87B3E'}}>Solana mainnet</span>
          <span style={{color:COLORS.textDim,fontFamily:'monospace',fontSize:11}}>CE7v...pZ2H</span>
        </a>
      </div>

      {/* Footer attribution */}
      <div style={{marginTop:48,paddingTop:18,borderTop:'0.5px solid rgba(255,255,255,0.04)',textAlign:'right',maxWidth:760,margin:'48px auto 0'}}>
        <span style={{fontSize:12,color:COLORS.textDim}}>Built by </span>
        <a href="https://x.com/AriantheChain" target="_blank" rel="noopener" style={{fontSize:12,color:'#E87B3E',fontWeight:500,textDecoration:'none'}}>@AriantheChain</a>
      </div>

    </div>
  );
}

function ProgressRing({ pct, color, size=54 }) {
  const r = (size - 8) / 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={COLORS.borderLite} strokeWidth="4"/>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={circ} strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cx})`} strokeLinecap="round"
        style={{transition:'stroke-dashoffset 0.5s ease'}}/>
    </svg>
  );
}

function DetailItem({ label, value, copyValue, highlight }) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:4}}>
      <div style={{fontSize:10,fontWeight:700,color:COLORS.textMute,textTransform:'uppercase',letterSpacing:'0.06em'}}>{label}</div>
      <div style={{display:'flex',alignItems:'center',gap:6,fontSize:13,color:highlight ? COLORS.accent : COLORS.text,fontWeight: highlight ? 700 : 500,fontFamily:'monospace'}}>
        <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{value}</span>
        {copyValue && <CopyIcon size={11} onClick={(e)=>{e.stopPropagation(); navigator.clipboard?.writeText(copyValue);}} />}
      </div>
    </div>
  );
}

function LockCard({ st, stats, role, index, publicKey, onClaim, claimLoading, now }) {
  const { vested, claimable, pctUnlocked, pctClaimed, isLive, isDone, nextUnlock } = stats;
  const isClaiming = claimLoading[index];
  const hasClaimable = claimable > 0.000001 && pctUnlocked > pctClaimed + 0.001;
  const canClaim = publicKey && st.recipient === publicKey.toString() && st.mintAddress;
  const fullyClaimed = isDone && Math.abs((st.withdrawn || 0) - st.amt) < 0.000001 && st.amt > 0;
  const isNativeSol = st.mintAddress === WSOL_MINT;

  // 4-state status badge
  let badge = { label: 'Vesting', color: COLORS.accent, bg: COLORS.accentBg, border: 'rgba(232,123,62,0.3)' };
  if (fullyClaimed || isDone) badge = { label: 'Complete', color: COLORS.textDim, bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.3)' };
  else if (!isLive && st.cliffTs) {
    const untilCliff = st.cliffTs - now;
    if (untilCliff < 86400 * 3 && untilCliff > 0) badge = { label: 'Cliff soon', color: COLORS.amber, bg: COLORS.amberBg, border: 'rgba(252,211,77,0.3)' };
    else                                          badge = { label: 'Upcoming',   color: COLORS.cyan,  bg: COLORS.cyanBg,  border: 'rgba(125,211,252,0.3)' };
  }

  const freqSecs = st.freqSecs || (st.endTs - st.startTs);
  const durSecs  = st.endTs - st.startTs;

  return (
    <div style={S.lockCardEvm}>
      {/* Header: title + ID + status */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,marginBottom:18,flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
            <div style={{fontSize:18,fontWeight:700,color:COLORS.text}}>{st.title || 'Untitled Lock'}</div>
            {isNativeSol && <span style={{fontSize:10,fontWeight:700,color:COLORS.accent,background:COLORS.accentBg,padding:'2px 7px',borderRadius:4,letterSpacing:'0.06em'}}>SOL</span>}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:COLORS.textMute,fontFamily:'monospace'}}>
            <span>ID {shortAddr(st.lock)}</span>
            <CopyIcon size={11} onClick={(e)=>{e.stopPropagation(); navigator.clipboard?.writeText(st.lock);}} />
          </div>
        </div>
        <div style={{fontSize:11,fontWeight:700,padding:'4px 12px',borderRadius:999,background:badge.bg,border:`1px solid ${badge.border}`,color:badge.color,letterSpacing:'0.04em',textTransform:'uppercase',whiteSpace:'nowrap'}}>{badge.label}</div>
      </div>

      {/* Amount row */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:20,flexWrap:'wrap'}}>
        <div style={{fontSize:32,fontWeight:700,color:COLORS.text,letterSpacing:'-0.01em'}} className="tabular">
          {numFmt(st.amt, 4)}
          <span style={{fontSize:14,color:COLORS.textDim,fontWeight:500,marginLeft:8}}>{st.token}</span>
        </div>
        {fullyClaimed && (
          <div style={{display:'inline-flex',alignItems:'center',gap:5,color:COLORS.accent,fontSize:11,fontWeight:700,background:COLORS.accentBg,border:`1px solid rgba(232,123,62,0.25)`,borderRadius:999,padding:'4px 10px'}}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5"/></svg>
            All tokens claimed
          </div>
        )}
      </div>

      {/* Progress: UNLOCKED + CLAIMED */}
      <div style={{marginBottom:20}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6}}>
          <span style={{fontSize:11,fontWeight:700,color:COLORS.textMute,textTransform:'uppercase',letterSpacing:'0.06em'}}>Unlocked</span>
          <span style={{fontSize:12,color:COLORS.text,fontFamily:'monospace'}} className="tabular">{numFmt(vested, 4)} {st.token} · {pctUnlocked.toFixed(2)}%</span>
        </div>
        <div style={{height:4,background:COLORS.progressTrack,borderRadius:999,overflow:'hidden',marginBottom:14}}>
          <div style={{height:'100%',width:Math.min(100,pctUnlocked)+'%',background:COLORS.accent,borderRadius:999,transition:'width 0.5s ease'}}/>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6}}>
          <span style={{fontSize:11,fontWeight:700,color:COLORS.textMute,textTransform:'uppercase',letterSpacing:'0.06em'}}>Claimed</span>
          <span style={{fontSize:12,color:COLORS.text,fontFamily:'monospace'}} className="tabular">{numFmt(st.withdrawn || 0, 4)} {st.token} · {pctClaimed.toFixed(2)}%</span>
        </div>
        <div style={{height:4,background:COLORS.progressTrack,borderRadius:999,overflow:'hidden'}}>
          <div style={{height:'100%',width:Math.min(100,pctClaimed)+'%',background:COLORS.cyan,borderRadius:999,transition:'width 0.5s ease'}}/>
        </div>
      </div>

      {/* 10-field detail grid */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))',gap:'14px 18px',marginBottom: canClaim ? 20 : 0,paddingTop:18,borderTop:`1px solid ${COLORS.border}`}}>
        <DetailItem label={role==='creator' ? 'Recipient' : 'Creator'}
          value={shortAddr(role==='creator' ? st.recipient : st.sender)}
          copyValue={role==='creator' ? st.recipient : st.sender} />
        <DetailItem label="Asset"
          value={isNativeSol ? 'Native SOL' : shortAddr(st.mintAddress)}
          copyValue={isNativeSol ? null : st.mintAddress} />
        <DetailItem label="Cliff Date"    value={st.cliffTs ? fmtDate(st.cliffTs) : '\u2014'} />
        <DetailItem label="Cliff Amount"  value={`${numFmt(st.cliffAmount || 0, 4)} ${st.token}`} />
        <DetailItem label="Start"         value={fmtDate(st.startTs)} />
        <DetailItem label="End"           value={fmtDate(st.endTs)} />
        <DetailItem label="Duration"      value={fmtDur(durSecs)} />
        <DetailItem label="Frequency"     value={fmtDur(freqSecs)} />
        <DetailItem label="Next Unlock"   value={isDone ? 'Fully unlocked' : nextUnlock ? fmtDate(nextUnlock) : '\u2014'} />
        <DetailItem label="Claimable Now" value={`${numFmt(claimable, 6)} ${st.token}`} highlight={hasClaimable} />
      </div>

      {/* Action row: Claim only (Cancel/Update not implemented in Solana program yet) */}
      {canClaim && (
        <div style={{display:'flex',gap:10,marginTop:4}}>
          {!fullyClaimed ? (
            <button
              style={{...S.claimBtn, flex:1, ...(hasClaimable && !isClaiming ? {} : S.claimBtnDisabled)}}
              onClick={()=>{ if(hasClaimable && !isClaiming) onClaim(st, index); }}
              disabled={!hasClaimable || isClaiming}>
              {isClaiming ? '...' : hasClaimable ? `Claim \u00B7 ${numFmt(claimable, 4)} ${st.token}` : 'Locked'}
            </button>
          ) : (
            <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:7,padding:'11px 18px',background:COLORS.accentBg,border:`1px solid rgba(232,123,62,0.25)`,borderRadius:8,color:COLORS.accent,fontSize:13,fontWeight:700}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5"/></svg>
              All tokens claimed
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function LocksTable({ title, rows, getStats, onClaim, claimLoading, role, publicKey, onCreate, now, onRefresh, refreshing }) {
  return (
    <div style={{width:'100%',maxWidth:780}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,marginBottom:32,position:'relative'}}>
        <div style={{...S.pageTitle, margin:0}}>{title}</div>
        {publicKey && onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh from on-chain"
            style={{
              position:'absolute', right:0,
              background:'transparent',
              border:`1px solid ${COLORS.border}`,
              borderRadius:8, padding:'6px 10px',
              color:refreshing ? COLORS.textMute : COLORS.textDim,
              cursor:refreshing ? 'wait' : 'pointer',
              fontSize:12, fontFamily:'inherit',
              display:'inline-flex', alignItems:'center', gap:6,
              transition:'all 0.15s',
            }}>
            <span style={{
              display:'inline-block',
              animation: refreshing ? 'spin 0.8s linear infinite' : 'none',
            }}>↻</span>
            {refreshing ? 'Syncing' : 'Refresh'}
          </button>
        )}
      </div>

      {!publicKey && (
        <div style={{padding:'3rem 1rem',textAlign:'center'}}>
          <div style={{fontSize:14,color:COLORS.textDim,marginBottom:18}}>Connect your wallet to view locks.</div>
        </div>
      )}

      {publicKey && rows.length === 0 && refreshing && (
        <div style={{padding:'3rem 1rem',textAlign:'center'}}>
          <div style={{fontSize:14,color:COLORS.textDim}}>Loading locks from chain...</div>
        </div>
      )}

      {publicKey && rows.length === 0 && !refreshing && (
        <div style={{padding:'3rem 1rem',textAlign:'center'}}>
          <div style={{display:'inline-block',position:'relative',marginBottom:16,opacity:0.55}}>
            <div style={{position:'absolute',inset:-12,background:COLORS.accent,opacity:0.06,borderRadius:'50%',filter:'blur(20px)',pointerEvents:'none'}}/>
            <div style={{position:'relative'}}><LockLogo size={56} /></div>
          </div>
          <div style={{fontSize:14,color:COLORS.textDim,marginBottom:6}}>No locks yet.</div>
          <div style={{fontSize:12,color:COLORS.textMute,marginBottom:22,maxWidth:320,margin:'0 auto 22px'}}>
            {role==='recipient' ? 'When someone locks tokens for you, they will appear here.' : 'Vest tokens to teammates, investors, or yourself — all on-chain.'}
          </div>
          <button style={{...S.primaryCta, width:'auto', padding:'10px 22px', margin:'0 auto'}} onClick={onCreate}>DEPLOY LOCK</button>
        </div>
      )}

      {publicKey && rows.length > 0 && (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {rows.map((st, i) => (
            <LockCard key={i}
              st={st}
              stats={getStats(st)}
              role={role}
              index={i}
              publicKey={publicKey}
              onClaim={onClaim}
              claimLoading={claimLoading}
              now={now}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════ Colors & Styles ══════════
const COLORS = {
  bg:              '#0B0C10',
  navBg:           '#0B0C10',
  cardBg:          '#141824',
  cardBgDarker:    '#0F131F',
  cardBgElevated:  '#1C2235',
  border:          '#2A334A',
  borderLite:      '#232B42',
  borderSubtle:    '#16181E',

  text:            '#F0F4FC',
  textDim:         '#9B9A95',
  textMute:        '#6B6F78',

  accent:          '#E87B3E',
  accentDark:      '#C4884A',
  accentBg:        'rgba(232, 123, 62,0.12)',

  mint:            '#86EFAC',
  mintBg:          'rgba(134,239,172,0.10)',
  cyan:            '#7DD3FC',
  cyanBg:          'rgba(125,211,252,0.10)',
  amber:           '#FCD34D',
  amberBg:         'rgba(252,211,77,0.10)',
  red:             '#F87171',

  progressTrack:   '#1C2235',
};

const S = {
  page: {
    minHeight: '100vh', background: COLORS.bg, color: COLORS.text,
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
    display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative',
  },

  navbar: { width:'100%', background:COLORS.navBg, position:'sticky', top:0, zIndex:10 },
  navInner: { padding:'14px 28px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:20 },
  brand: { display:'flex', alignItems:'center', gap:10, cursor:'pointer' },
  brandName: { fontSize:17, fontWeight:700, color:COLORS.text, letterSpacing:'-0.01em' },
  navSearch: { position:'relative', width:'100%', maxWidth:460, justifySelf:'center' },
  navSearchIcon: { position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', color:COLORS.textMute, pointerEvents:'none' },
  navSearchInput: { width:'100%', background:COLORS.cardBgDarker, border:`1px solid ${COLORS.border}`, borderRadius:999, padding:'8px 14px 8px 38px', color:COLORS.text, fontSize:13, outline:'none', boxSizing:'border-box', fontFamily:'inherit' },
  navRight: { display:'flex', alignItems:'center', gap:10, justifySelf:'end' },
  priority: { display:'flex', alignItems:'center', gap:6, background:COLORS.cardBgDarker, border:`1px solid ${COLORS.border}`, borderRadius:8, padding:'7px 12px', fontSize:12 },
  gearBtn: { width:32, height:32, background:COLORS.cardBgDarker, border:`1px solid ${COLORS.border}`, borderRadius:8, color:COLORS.textDim, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' },
  connectBtn: { background:'transparent', border:`1px solid ${COLORS.accent}`, color:COLORS.accent, padding:'7px 16px', borderRadius:999, fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit', transition:'all 0.2s' },
  walletPill: { display:'flex', alignItems:'center', gap:6, background:COLORS.cardBgDarker, border:`1px solid ${COLORS.border}`, borderRadius:999, padding:'7px 12px', color:COLORS.text, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' },
  walletDot: { width:16, height:16, borderRadius:'50%', background:`linear-gradient(135deg, ${COLORS.cyan}, ${COLORS.accent})` },

  navTabs: { maxWidth:1280, margin:'0 auto', padding:'0 28px', display:'flex', alignItems:'center', gap:26, justifyContent:'center' },
  navTab: { background:'none', border:'none', outline:'none', color:COLORS.textDim, padding:'12px 0', fontSize:13, fontWeight:500, cursor:'pointer', borderBottom:'2px solid rgba(0,0,0,0)', fontFamily:'inherit' },
  navTabActive: { color:COLORS.accent, borderBottom:'2px solid #E87B3E', fontWeight:600 },

  alertToast: { position:'fixed', bottom:28, left:28, zIndex:50, display:'flex', gap:12, alignItems:'flex-start', padding:'12px 16px', background:COLORS.cardBg, border:`1px solid ${COLORS.border}`, borderLeftWidth:3, borderRadius:8, minWidth:260, maxWidth:340, animation:'slideDown 0.25s ease' },
  alertIcon: { width:22, height:22, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, flexShrink:0 },
  alertTypes: {
    success: { borderLeftColor: COLORS.mint },
    info:    { borderLeftColor: COLORS.cyan },
    warn:    { borderLeftColor: COLORS.red  },
  },

  main: { width:'100%', flex:1, display:'flex', flexDirection:'column', alignItems:'center', padding:'32px 24px 80px' },
  pageTitle: { fontSize:22, fontWeight:700, color:COLORS.text, textAlign:'center', marginBottom:28, letterSpacing:'-0.015em' },

  // Section header with numbered circle
  sectionLabelRow: { display:'flex', alignItems:'center', gap:10, marginBottom:10 },
  sectionNum: { width:22, height:22, borderRadius:'50%', background:COLORS.accentBg, color:COLORS.accent, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, border:`1px solid ${COLORS.accent}40` },
  sectionLabel: { fontSize:13, fontWeight:700, color:COLORS.text },

  card: { background:COLORS.cardBg, border:`1px solid ${COLORS.border}`, borderRadius:12, padding:20, boxShadow:'inset 0 1px 0 rgba(255,255,255,0.03)' },
  field: { marginBottom:18 },
  label: { fontSize:12, fontWeight:500, color:COLORS.textDim, marginBottom:6 },
  hint: { fontSize:11, color:COLORS.textMute, marginBottom:8, marginTop:-2 },
  input: { width:'100%', background:COLORS.cardBgDarker, border:`1px solid ${COLORS.border}`, borderRadius:8, padding:'10px 12px', color:COLORS.text, fontSize:13, outline:'none', fontFamily:'inherit', boxSizing:'border-box' },
  inputSuffix: { position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', fontSize:12, color:COLORS.textMute, fontWeight:600 },
  selectChevron: { position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' },
  errText: { fontSize:11, color:COLORS.red, marginTop:4 },
  warnText: { fontSize:11, color:COLORS.amber, marginTop:4 },

  selectTokenBtn: { width:'100%', background:COLORS.cardBgDarker, border:`1px solid ${COLORS.border}`, borderRadius:8, padding:'10px 12px', color:COLORS.text, fontSize:13, fontFamily:'inherit', display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer', boxSizing:'border-box' },
  selectedTokenBtn: { width:'100%', background:COLORS.cardBgDarker, border:`1px solid ${COLORS.border}`, borderRadius:8, padding:'8px 12px', color:COLORS.text, fontFamily:'inherit', display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer', boxSizing:'border-box' },

  summaryBox: {
    background: COLORS.cardBgDarker,
    border: `1px solid ${COLORS.border}`,
    borderLeft: `3px solid ${COLORS.accent}`,
    borderRadius: 8, padding:'14px 16px', marginTop:4,
  },
  summaryTitle: { fontSize:12, fontWeight:700, color:COLORS.accent, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 },
  summaryLine: { fontSize:12, color:COLORS.textDim, lineHeight:1.65, marginBottom:6 },

  addAnother: { background:'none', border:'none', color:COLORS.accent, fontSize:12, fontWeight:600, padding:'16px 0', cursor:'pointer', fontFamily:'inherit' },

  primaryCta:{width:'100%',background:'#E87B3E',border:'none',borderRadius:0,padding:'14px 22px',color:'#000',fontSize:13,fontWeight:900,cursor:'pointer',fontFamily:'JetBrains Mono, Consolas, monospace',display:'flex',alignItems:'center',justifyContent:'center',gap:8,textTransform:'uppercase',letterSpacing:'0.15em'},
  primaryCtaDisabled: { background:COLORS.cardBgElevated, color:COLORS.textMute, cursor:'not-allowed', boxShadow:'none' },
  spinner: { width:12, height:12, border:'2px solid rgba(0,0,0,0.3)', borderTopColor:COLORS.bg, borderRadius:'50%', animation:'spin 0.7s linear infinite' },

  // Modal
  modalOverlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(4px)', zIndex:100, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'100px 16px 16px' },
  modalCard: { background:COLORS.cardBg, border:`1px solid ${COLORS.border}`, borderRadius:14, width:'100%', maxWidth:460, maxHeight:'70vh', display:'flex', flexDirection:'column', overflow:'hidden' },
  modalSearch: { position:'relative', padding:14, borderBottom:`1px solid ${COLORS.borderSubtle}`, display:'flex', alignItems:'center', gap:10 },
  modalSearchIcon: { position:'absolute', left:28, top:'50%', transform:'translateY(-50%)', color:COLORS.textMute, pointerEvents:'none' },
  modalSearchInput: { flex:1, background:COLORS.cardBgDarker, border:`1px solid ${COLORS.border}`, borderRadius:8, padding:'9px 12px 9px 36px', color:COLORS.text, fontSize:13, outline:'none', fontFamily:'inherit' },
  modalClose: { background:'none', border:'none', color:COLORS.textDim, fontSize:16, cursor:'pointer', padding:4, marginLeft:2 },
  modalSectionHeader: { padding:'10px 16px 6px', fontSize:10, fontWeight:700, color:COLORS.textMute, textTransform:'uppercase', letterSpacing:'0.08em' },
  modalList: { overflowY:'auto', flex:1 },
  modalRow: { padding:'10px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer', transition:'background 0.15s' },

  // Lock card (replaces old table)
  lockCard: {
  lockCardEvm: { background: COLORS.cardBg, border: '1px solid ' + COLORS.border, borderRadius: 12, padding: '22px 24px', transition: 'all 0.2s ease' },
    background: COLORS.cardBg,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    padding: 16,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
    transition: 'border-color 0.2s',
  },

  claimBtn: { background:COLORS.accent, border:'none', color:COLORS.bg, borderRadius:8, padding:'9px 16px', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' },
  claimBtnDisabled: { background:COLORS.cardBgElevated, color:COLORS.textMute, cursor:'not-allowed' },
  allClaimed: { display:'inline-flex', alignItems:'center', gap:5, color:COLORS.mint, fontSize:11, fontWeight:700, background:COLORS.mintBg, border:`1px solid ${COLORS.mint}40`, borderRadius:999, padding:'6px 12px' },

  suggestPopup: { position:'absolute', left:0, bottom:'calc(100% + 4px)', zIndex:20, background:COLORS.cardBgElevated, border:`1px solid ${COLORS.border}`, borderRadius:8, padding:4, minWidth:220, maxWidth:'100%', boxShadow:'0 4px 20px rgba(0,0,0,0.5)' },
  suggestItem: { padding:'6px 10px', color:COLORS.text, fontSize:13, cursor:'pointer', borderRadius:5, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', transition:'background 0.12s' },
};
