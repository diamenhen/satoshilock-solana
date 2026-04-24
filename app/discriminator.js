const { createHash } = require('crypto');
const hash = createHash('sha256').update('global:create_vesting_escrow').digest();
console.log('Discriminator:', Array.from(hash.slice(0, 8)));