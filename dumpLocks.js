const web3 = require('@solana/web3.js');

const PROGRAM_ID = new web3.PublicKey('CE7vQdyjXSEvPdeEdrmbEpM8hSPZi2L4MKAWi26kpZ2H');
// Ganti dengan wallet kamu yang punya lock
const WALLET = new web3.PublicKey('47FkYYeJn5dkNc2rJHx6XGeKS6pyTBG5s5zP6jmgQiao');

async function dumpAccounts() {
  const connection = new web3.Connection('https://api.mainnet-beta.solana.com', 'confirmed');

  console.log('Searching for lock accounts...\n');

  // Coba beberapa offset umum (creator atau recipient posisinya mana)
  const offsetsToTry = [8, 40, 72];
  const allAccounts = new Map(); // dedupe by address

  for (const offset of offsetsToTry) {
    try {
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [{ memcmp: { offset, bytes: WALLET.toBase58() } }],
      });
      accounts.forEach(a => {
        if (!allAccounts.has(a.pubkey.toBase58())) {
          allAccounts.set(a.pubkey.toBase58(), { ...a, _foundAt: offset });
        }
      });
      console.log(`  Offset ${offset}: found ${accounts.length} accounts`);
    } catch (e) {
      console.log(`  Offset ${offset}: error ${e.message}`);
    }
  }

  console.log(`\nTotal unique accounts: ${allAccounts.size}\n`);

  if (allAccounts.size === 0) {
    console.log('No lock accounts found for this wallet.');
    return;
  }

  // Ambil max 3 account pertama buat analisis
  let i = 0;
  for (const [address, acc] of allAccounts) {
    if (i >= 3) break;
    i++;

    console.log('═'.repeat(60));
    console.log(`LOCK ACCOUNT #${i}`);
    console.log(`Address: ${address}`);
    console.log(`Wallet found at offset: ${acc._foundAt} (hint: 8=creator, 40=recipient, 72=other)`);
    console.log(`Data size: ${acc.account.data.length} bytes`);
    console.log(`Owner program: ${acc.account.owner.toBase58()}`);
    console.log('');

    // Dump as hex, 16 bytes per line with offsets
    const data = acc.account.data;
    console.log('HEX DUMP:');
    for (let off = 0; off < data.length; off += 16) {
      const chunk = data.slice(off, Math.min(off + 16, data.length));
      const hex = Array.from(chunk)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ');
      console.log(`  ${off.toString().padStart(4)}: ${hex}`);
    }

    console.log('\nPARSED CANDIDATES (assuming 8-byte discriminator at start):');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // Try to decode common offsets
    const possibleOffsets = [8, 40, 72, 104, 112, 120, 128, 136, 144, 152];
    for (const off of possibleOffsets) {
      if (off + 8 > data.length) continue;
      try {
        const u64 = view.getBigUint64(off, true);
        const i64 = view.getBigInt64(off, true);
        const asDate = Number(i64) > 1500000000 && Number(i64) < 3000000000
          ? ` → ${new Date(Number(i64) * 1000).toISOString()}`
          : '';
        console.log(`  offset ${off.toString().padStart(3)}: u64=${u64.toString().padStart(20)} | i64=${i64.toString().padStart(20)}${asDate}`);
      } catch {}
    }

    // Try parse pubkeys at offsets 8, 40, 72
    console.log('\nPUBKEY CANDIDATES:');
    for (const off of [8, 40, 72]) {
      if (off + 32 > data.length) continue;
      try {
        const pubkey = new web3.PublicKey(data.slice(off, off + 32));
        console.log(`  offset ${off.toString().padStart(3)}: ${pubkey.toBase58()}`);
      } catch {}
    }

    console.log('');
  }

  console.log('═'.repeat(60));
  console.log('\nSend this entire output to chat.');
  console.log('I\'ll cross-reference with known values (0.005 SOL lock, etc)');
  console.log('to figure out exact offsets.');
}

dumpAccounts().catch(console.error);
