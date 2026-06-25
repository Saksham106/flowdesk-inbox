import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { encryptString, decryptString, isEncrypted, reEncryptString } from "@/lib/crypto"

const TEST_KEY = Buffer.from("test-key-32bytes-padded-here1234").toString("base64")
const ALT_KEY = Buffer.from("alt--key-32bytes-padded-here1234").toString("base64")

beforeEach(() => {
  process.env.ENCRYPTION_SECRET = TEST_KEY
  delete process.env.ENCRYPTION_SECRET_PREVIOUS
})

afterEach(() => {
  delete process.env.ENCRYPTION_SECRET
  delete process.env.ENCRYPTION_SECRET_PREVIOUS
})

describe("encryptString / decryptString", () => {
  it("round-trips a plaintext value", () => {
    const encrypted = encryptString("hello world")
    expect(encrypted).not.toBe("hello world")
    expect(decryptString(encrypted)).toBe("hello world")
  })

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const a = encryptString("same")
    const b = encryptString("same")
    expect(a).not.toBe(b)
    expect(decryptString(a)).toBe("same")
    expect(decryptString(b)).toBe("same")
  })

  it("passes through plaintext values that don't match encrypted format", () => {
    expect(decryptString("plain text")).toBe("plain text")
    expect(decryptString("https://example.com")).toBe("https://example.com")
  })

  it("throws when decryption fails and no previous key is set", () => {
    process.env.ENCRYPTION_SECRET = ALT_KEY
    const encrypted = encryptString("secret")
    process.env.ENCRYPTION_SECRET = TEST_KEY
    expect(() => decryptString(encrypted)).toThrow()
  })
})

describe("isEncrypted", () => {
  it("returns true for values in encrypted format", () => {
    expect(isEncrypted(encryptString("x"))).toBe(true)
  })

  it("returns false for plaintext", () => {
    expect(isEncrypted("plain")).toBe(false)
    expect(isEncrypted("https://example.com")).toBe(false)
  })
})

describe("decryptString with ENCRYPTION_SECRET_PREVIOUS fallback", () => {
  it("decrypts values encrypted with the previous key using fallback", () => {
    // Encrypt with old key
    process.env.ENCRYPTION_SECRET = ALT_KEY
    const oldEncrypted = encryptString("oauth-token")

    // Switch to new key, set old as PREVIOUS
    process.env.ENCRYPTION_SECRET = TEST_KEY
    process.env.ENCRYPTION_SECRET_PREVIOUS = ALT_KEY

    expect(decryptString(oldEncrypted)).toBe("oauth-token")
  })

  it("prefers current key over previous key", () => {
    const encrypted = encryptString("current-token")
    process.env.ENCRYPTION_SECRET_PREVIOUS = ALT_KEY
    expect(decryptString(encrypted)).toBe("current-token")
  })

  it("throws when both current and previous keys fail", () => {
    process.env.ENCRYPTION_SECRET = ALT_KEY
    const encrypted = encryptString("secret")
    process.env.ENCRYPTION_SECRET = TEST_KEY
    process.env.ENCRYPTION_SECRET_PREVIOUS = TEST_KEY // wrong previous key too
    expect(() => decryptString(encrypted)).toThrow()
  })
})

describe("reEncryptString", () => {
  it("re-encrypts a value encrypted with the old key to the new key", () => {
    // Encrypt with old key
    process.env.ENCRYPTION_SECRET = ALT_KEY
    const oldEncrypted = encryptString("refresh-token")

    // Rotate: new key current, old key as previous
    process.env.ENCRYPTION_SECRET = TEST_KEY
    process.env.ENCRYPTION_SECRET_PREVIOUS = ALT_KEY

    const rekeyed = reEncryptString(oldEncrypted)

    // The rekeyed value should decrypt correctly with only the new key
    delete process.env.ENCRYPTION_SECRET_PREVIOUS
    expect(decryptString(rekeyed)).toBe("refresh-token")
  })

  it("no-ops on plaintext values", () => {
    expect(reEncryptString("not-encrypted")).toBe("not-encrypted")
  })

  it("is idempotent when already on the current key", () => {
    const encrypted = encryptString("token")
    const rekeyed = reEncryptString(encrypted)
    expect(decryptString(rekeyed)).toBe("token")
  })
})
