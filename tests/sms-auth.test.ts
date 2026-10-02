import { describe, expect, test } from "bun:test";
import { smsSecretAuthorized } from "../src/server/sms-auth";

describe("smsSecretAuthorized", () => {
  test("rejects everything when no secret is configured", () => {
    expect(smsSecretAuthorized(undefined, undefined)).toBe(false);
    expect(smsSecretAuthorized(undefined, "anything")).toBe(false);
    expect(smsSecretAuthorized("", "")).toBe(false);
  });

  test("rejects a missing or wrong header", () => {
    expect(smsSecretAuthorized("s3cret", undefined)).toBe(false);
    expect(smsSecretAuthorized("s3cret", "")).toBe(false);
    expect(smsSecretAuthorized("s3cret", "s3cre")).toBe(false);
    expect(smsSecretAuthorized("s3cret", "s3cret!")).toBe(false);
  });

  test("accepts the exact secret", () => {
    expect(smsSecretAuthorized("s3cret", "s3cret")).toBe(true);
  });
});
