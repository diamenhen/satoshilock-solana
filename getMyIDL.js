const anchor = require('@coral-xyz/anchor');
const web3 = require('@solana/web3.js');

async function getIDL() {
  const connection = new web3.Connection('https://api.mainnet-beta.solana.com');
  const programId = new web3.PublicKey('CE7vQdyjXSEvPdeEdrmbEpM8hSPZi2L4MKAWi26kpZ2H');
  try {
    const idl = await anchor.Program.fetchIdl(programId, { connection });
    if (!idl) {
      console.log('IDL_NOT_FOUND_ON_CHAIN');
      return;
    }
    console.log('====== SATOSHILOCK IDL START ======');
    console.log(JSON.stringify(idl, null, 2));
    console.log('====== SATOSHILOCK IDL END ======');
  } catch (e) {
    console.error('Error:', e.message);
  }
}
getIDL().catch(console.error);
