const anchor = require('@coral-xyz/anchor');
const web3 = require('@solana/web3.js');

async function getIDL() {
  const connection = new web3.Connection('https://api.mainnet-beta.solana.com');
  const programId = new web3.PublicKey('LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn');
  const idl = await anchor.Program.fetchIdl(programId, { connection });
  console.log(JSON.stringify(idl, null, 2));
}

getIDL().catch(console.error);