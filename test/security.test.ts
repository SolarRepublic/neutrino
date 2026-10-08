import assert from 'node:assert/strict';
import {createCipheriv, randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {aes_128_siv_encrypt, aes_128_siv_decrypt} from '../src/aes-128-siv.js';
import {chacha20} from '../src/chacha20.js';
import {chacha20_poly1305_seal, chacha20_poly1305_open} from '../src/chacha20-poly1305.js';

test('ChaCha20-Poly1305 agrees with OpenSSL for sliced buffers and boundary sizes', () => {
  for(const size of [0, 1, 15, 16, 17, 63, 64, 65, 255]) {
    const key = randomBytes(40).subarray(3, 35);
    const nonce = randomBytes(20).subarray(5, 17);
    const data = randomBytes(size);
    const aad = randomBytes(size % 17);
    const cipher = createCipheriv('chacha20-poly1305', key, nonce, {authTagLength: 16});
    cipher.setAAD(aad, {plaintextLength: size});
    const expected = Buffer.concat([cipher.update(data), cipher.final()]);
    const [encrypted, tag] = chacha20_poly1305_seal(key, nonce, data, aad);
    assert.deepEqual(Buffer.from(encrypted), expected);
    assert.deepEqual(Buffer.from(tag), cipher.getAuthTag());
    assert.deepEqual(Buffer.from(chacha20_poly1305_open(key, nonce, tag, encrypted, aad)), data);
    tag[0] ^= 1;
    assert.throws(() => chacha20_poly1305_open(key, nonce, tag, encrypted, aad), /Tag mismatch/);
  }
});

test('ChaCha20 rejects malformed parameters and counter exhaustion', () => {
  const key = new Uint8Array(32), nonce = new Uint8Array(12);
  assert.throws(() => chacha20(key.subarray(1), nonce, new Uint8Array()), /32-byte/);
  assert.throws(() => chacha20(key, nonce.subarray(1), new Uint8Array()), /12-byte/);
  for(const counter of [-1, 0x100000000, NaN, 1.5]) assert.throws(() => chacha20(key, nonce, new Uint8Array(), counter), /counter/);
  assert.throws(() => chacha20(key, nonce, new Uint8Array(65), 0xffffffff), /overflow/);
  assert.equal(chacha20(key, nonce, new Uint8Array(64), 0xffffffff).length, 64);
});

test('AES-SIV authentication failure never exposes decrypted content', async() => {
  const key = new Uint8Array(32);
  const plaintext = new TextEncoder().encode('private viewing key and account data');
  const encrypted = await aes_128_siv_encrypt(key, plaintext);
  // These SIV tag bits are masked out for CTR, preserving plaintext but failing authentication.
  encrypted[8] ^= 0x80;
  await assert.rejects(aes_128_siv_decrypt(key, encrypted), {message: 'SIV authentication failed'});
});

import {createHash, createPrivateKey, createPublicKey, diffieHellman} from 'node:crypto';
import {ecs_mul, ecs_mul_base} from '../src/x25519.js';
import {ripemd160} from '../src/ripemd160.js';

test('X25519 agrees with OpenSSL across deterministic keys and sliced buffers', () => {
  const derPrefix = Buffer.from('302e020100300506032b656e04220420','hex');
  const key = (seed: string) => createHash('sha256').update(seed).digest();
  for(let i=0; i<32; i++) {
    const scalar = key('neutrino-scalar-'+i);
    const peerScalar = key('neutrino-peer-'+i);
    const privateKey = createPrivateKey({key:Buffer.concat([derPrefix,scalar]),format:'der',type:'pkcs8'});
    const peerKey = createPrivateKey({key:Buffer.concat([derPrefix,peerScalar]),format:'der',type:'pkcs8'});
    const peer = createPublicKey(peerKey);
    const peerBytes = peer.export({format:'der',type:'spki'}).subarray(-32);
    const scalarSlice = Buffer.concat([Buffer.alloc(7),scalar,Buffer.alloc(3)]).subarray(7,39);
    assert.deepEqual(Buffer.from(ecs_mul_base(scalarSlice)),createPublicKey(privateKey).export({format:'der',type:'spki'}).subarray(-32));
    assert.deepEqual(Buffer.from(ecs_mul(scalarSlice,peerBytes)),diffieHellman({privateKey,publicKey:peer}));
  }
  assert.throws(() => ecs_mul(new Uint8Array(31),new Uint8Array(32)),/32 bytes/);
  assert.throws(() => ecs_mul(new Uint8Array(32),new Uint8Array(33)),/32 bytes/);
});

test('RIPEMD-160 agrees with OpenSSL across padding boundaries and buffer offsets', () => {
  for(const size of [0,1,31,55,56,57,63,64,65,119,120,127,128,129,1024,4096]) {
    const bytes = Uint8Array.from({length:size+11},(_,i) => (i*197+size)%256).subarray(7,7+size);
    assert.deepEqual(Buffer.from(ripemd160(bytes)),createHash('ripemd160').update(bytes).digest());
  }
});
