import { HoppRESTRequest } from "@hoppscotch/data"
import { FaradayCage } from "faraday-cage"
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

import { defaultModules } from "~/cage-modules"
import { combineScriptsWithIIFE } from "~/scripting"
import { runPreRequestScript } from "~/web"

const sha256 = (input: string) =>
  createHash("sha256").update(input, "utf8").digest("hex")

const runCage = async (script: string) => {
  const cage = await FaradayCage.create()
  return cage.runCode(script, [...defaultModules()])
}

describe("CryptoJS compatibility shim", () => {
  it("matches crypto-js digests across padding boundaries and utf8 input", async () => {
    const samples = [
      "",
      "abc",
      "a".repeat(55), // last block before padding spills over
      "a".repeat(56),
      "a".repeat(64),
      "a".repeat(1000),
      "密码🀄 tif",
    ]
    const vectors = samples.map((s) => [s, sha256(s)])

    const result = await runCage(`
      const vectors = ${JSON.stringify(vectors)}
      for (const [input, expected] of vectors) {
        const actual = CryptoJS.SHA256(input).toString(CryptoJS.enc.Hex)
        if (actual !== expected) {
          throw new Error("SHA256 mismatch for " + JSON.stringify(input) + ": " + actual)
        }
      }

      // default encoder is Hex (CryptoJS behaviour)
      const hex = CryptoJS.SHA256("abc").toString()
      if (hex !== ${JSON.stringify(sha256("abc"))}) {
        throw new Error("default toString() is not Hex: " + hex)
      }

      // WordArray input + Hex round trip
      const fromUtf8 = CryptoJS.SHA256(CryptoJS.enc.Utf8.parse("abc")).toString(CryptoJS.enc.Hex)
      const fromHex = CryptoJS.SHA256(CryptoJS.enc.Hex.parse("616263")).toString(CryptoJS.enc.Hex)
      if (fromUtf8 !== fromHex) {
        throw new Error("WordArray input mismatch: " + fromUtf8 + " vs " + fromHex)
      }

      // Postman also exposes it as a package
      const viaRequire = require("crypto-js").SHA256("abc").toString(CryptoJS.enc.Hex)
      if (viaRequire !== fromUtf8) {
        throw new Error("require('crypto-js') mismatch: " + viaRequire)
      }
    `)

    expect(result.type).toBe("ok")
  })

  it("runs an unmodified Postman signature pre-request script", async () => {
    const request: HoppRESTRequest = {
      v: "16",
      name: "paas",
      endpoint: "https://example.com/api",
      method: "POST",
      headers: [],
      params: [],
      body: { contentType: "application/json", body: "{}" },
      auth: { authType: "none", authActive: false },
      preRequestScript: "",
      testScript: "",
      requestVariables: [],
      responses: {},
    }

    const token = "testtoken"
    const timestamp = "1700000000"
    const nonce = "123456789abcdefg"

    const script = combineScriptsWithIIFE(
      [
        `
const paasid = "yss_ai";
const token = "${token}";
const timestamp = "${timestamp}";
const nonce = '${nonce}';
const signature = CryptoJS.SHA256(timestamp + token + nonce + timestamp).toString(CryptoJS.enc.Hex).toUpperCase();

pm.request.headers.add({ key: "x-tif-paasid", value: paasid });
pm.request.headers.add({ key: "x-tif-timestamp", value: timestamp });
pm.request.headers.add({ key: "x-tif-signature", value: signature });
pm.request.headers.add({ key: "x-tif-nonce", value: nonce });
`,
      ],
      "experimental"
    )

    const res = await runPreRequestScript(script, {
      envs: { global: [], selected: [] },
      request,
    })

    if (res._tag === "Left") throw new Error(res.left)

    const headers = res.right.updatedRequest!.headers
    expect(headers.map((h) => h.key)).toEqual([
      "x-tif-paasid",
      "x-tif-timestamp",
      "x-tif-signature",
      "x-tif-nonce",
    ])
    expect(headers.find((h) => h.key === "x-tif-signature")!.value).toBe(
      sha256(timestamp + token + nonce + timestamp).toUpperCase()
    )
  })
})
