import { defineCageModule } from "faraday-cage/modules"

/**
 * Postman exposes `CryptoJS` as a sandbox global, so imported scripts are full
 * of `CryptoJS.SHA256(...).toString(CryptoJS.enc.Hex)`. Faraday-cage has no
 * CryptoJS, and `crypto.subtle.digest` is not a drop-in: it is async, and its
 * TextEncoder output crosses the VM boundary without a `length` (hashing it
 * silently yields the digest of an empty string).
 *
 * This module evaluates a synchronous pure-JS CryptoJS subset into the VM global
 * (`CryptoJS.SHA256`, `CryptoJS.enc.Hex`, `CryptoJS.enc.Utf8`,
 * `CryptoJS.lib.WordArray`) so imported scripts run unmodified.
 *
 * ponytail: SHA256 + Hex/Utf8 only. Add Base64/MD5/HMAC/AES when an import needs them.
 */
const CRYPTO_JS_SHIM = `
(() => {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const H0 = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]
  const HEX = "0123456789abcdef"

  const rotr = (x, n) => (x >>> n) | (x << (32 - n))

  const utf8Encode = (str) => {
    const out = []
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i)
      if (code < 0x80) {
        out.push(code)
      } else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
      } else if (
        code >= 0xd800 && code <= 0xdbff && i + 1 < str.length &&
        str.charCodeAt(i + 1) >= 0xdc00 && str.charCodeAt(i + 1) <= 0xdfff
      ) {
        // surrogate pair -> single 4-byte sequence
        const cp = 0x10000 + ((code - 0xd800) << 10) + (str.charCodeAt(i + 1) - 0xdc00)
        i++
        out.push(
          0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)
        )
      } else {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
      }
    }
    return out
  }

  const utf8Decode = (bytes) => {
    let str = ""
    for (let i = 0; i < bytes.length; ) {
      const b = bytes[i++]
      let extra = 0
      let cp = b
      if (b >= 0xf0) { extra = 3; cp = b & 0x07 }
      else if (b >= 0xe0) { extra = 2; cp = b & 0x0f }
      else if (b >= 0xc0) { extra = 1; cp = b & 0x1f }
      for (let k = 0; k < extra; k++) cp = (cp << 6) | (bytes[i++] & 0x3f)
      if (cp > 0xffff) {
        cp -= 0x10000
        str += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
      } else {
        str += String.fromCharCode(cp)
      }
    }
    return str
  }

  const sha256Bytes = (bytes) => {
    const padded = bytes.slice()
    const bitLen = bytes.length * 8
    padded.push(0x80)
    while (padded.length % 64 !== 56) padded.push(0)
    const hi = Math.floor(bitLen / 0x100000000)
    const lo = bitLen >>> 0
    padded.push(
      (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
      (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff
    )

    const H = H0.slice()
    const w = new Array(64)
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) {
        const j = off + i * 4
        w[i] = (padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3]
      }
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15]
        const y = w[i - 2]
        w[i] = (w[i - 16] + (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) +
          w[i - 7] + (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10))) | 0
      }

      let a = H[0], b = H[1], c = H[2], d = H[3]
      let e = H[4], f = H[5], g = H[6], h = H[7]
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
        const ch = (e & f) ^ (~e & g)
        const t1 = (h + S1 + ch + K[i] + w[i]) | 0
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
        const maj = (a & b) ^ (a & c) ^ (b & c)
        const t2 = (S0 + maj) | 0
        h = g; g = f; f = e; e = (d + t1) | 0
        d = c; c = b; b = a; a = (t1 + t2) | 0
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0
      H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0
      H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0
    }

    const out = []
    for (let i = 0; i < 8; i++) {
      out.push((H[i] >>> 24) & 0xff, (H[i] >>> 16) & 0xff, (H[i] >>> 8) & 0xff, H[i] & 0xff)
    }
    return out
  }

  const bytesFromWords = (words, sigBytes) => {
    const out = []
    for (let i = 0; i < sigBytes; i++) {
      out.push((words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff)
    }
    return out
  }

  function WordArray(words, sigBytes) {
    this.words = words || []
    this.sigBytes = sigBytes || 0
  }
  WordArray.create = (words, sigBytes) => new WordArray(words, sigBytes)
  WordArray.prototype.toString = function (encoder) {
    return (encoder || Hex).stringify(this)
  }

  const wordsFromBytes = (bytes) => {
    const words = []
    for (let i = 0; i < bytes.length; i++) {
      const idx = i >>> 2
      words[idx] = (words[idx] || 0) | (bytes[i] << (24 - (i % 4) * 8))
    }
    return new WordArray(words, bytes.length)
  }

  const toBytes = (message) => {
    if (message === undefined || message === null) return []
    if (typeof message === "string") return utf8Encode(message)
    if (message instanceof WordArray || (message.sigBytes !== undefined && message.words)) {
      return bytesFromWords(message.words, message.sigBytes)
    }
    if (typeof message.length === "number") return Array.prototype.slice.call(message)
    throw new Error("CryptoJS shim: unsupported message type")
  }

  const Hex = {
    stringify: (wordArray) => {
      const bytes = bytesFromWords(wordArray.words, wordArray.sigBytes)
      let hex = ""
      for (let i = 0; i < bytes.length; i++) {
        hex += HEX.charAt(bytes[i] >> 4) + HEX.charAt(bytes[i] & 15)
      }
      return hex
    },
    parse: (hexStr) => {
      const str = String(hexStr)
      const bytes = []
      for (let i = 0; i < str.length; i += 2) {
        bytes.push(parseInt(str.substr(i, 2), 16) || 0)
      }
      return wordsFromBytes(bytes)
    },
  }

  const Utf8 = {
    stringify: (wordArray) => utf8Decode(bytesFromWords(wordArray.words, wordArray.sigBytes)),
    parse: (str) => wordsFromBytes(utf8Encode(String(str))),
  }

  const SHA256 = (message) => wordsFromBytes(sha256Bytes(toBytes(message)))

  globalThis.CryptoJS = {
    SHA256: SHA256,
    enc: { Hex: Hex, Utf8: Utf8 },
    lib: { WordArray: WordArray },
  }

  // Postman scripts often reach for it as a package instead of the global.
  globalThis.require = (packageName) => {
    if (packageName === "crypto-js") return globalThis.CryptoJS
    throw new Error("require('" + packageName + "') is not supported in Hoppscotch")
  }
})()
`

export const cryptoJsModule = () =>
  defineCageModule((ctx) => {
    ctx.scope.manage(ctx.vm.evalCode(CRYPTO_JS_SHIM)).unwrap()
  })
