/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

// Builds a Thai QR Payment (PromptPay) payload string per the EMVCo-based
// spec published by the Bank of Thailand. Pass an amount to get a "dynamic"
// QR with the amount pre-filled in the payer's banking app.

function tlv(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, "0")}${value}`
}

function crc16(payload: string): string {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1)
      crc &= 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0")
}

// Normalizes a phone number (e.g. "081-234-5678" or "0812345678") into the
// 13-digit format PromptPay expects (0066 + number without leading 0).
function normalizeTarget(target: string): { id: "01" | "02" | "03"; value: string } {
  const digits = target.replace(/[^0-9]/g, "")
  if (digits.length === 13) return { id: "02", value: digits } // national ID / tax ID
  if (digits.length === 10 && digits.startsWith("0")) {
    return { id: "01", value: `0066${digits.slice(1)}` } // mobile number
  }
  if (digits.length === 15 && digits.startsWith("0066")) {
    return { id: "01", value: digits }
  }
  // e-Wallet ID (15 digits)
  return { id: "03", value: digits }
}

/**
 * @param target  PromptPay ID — mobile number (08xxxxxxxx) or national ID (13 digits)
 * @param amount  Optional amount in THB. When set, produces a "dynamic" QR.
 */
export function buildPromptPayPayload(target: string, amount?: number): string {
  const { id, value } = normalizeTarget(target)

  let payload = ""
  payload += tlv("00", "01") // Payload Format Indicator
  payload += tlv("01", amount ? "12" : "11") // Point of Initiation Method
  payload += tlv("29", tlv("00", "A000000677010111") + tlv(id, value)) // Merchant Account Info
  payload += tlv("53", "764") // Currency: THB
  if (amount) payload += tlv("54", amount.toFixed(2)) // Transaction Amount
  payload += tlv("58", "TH") // Country Code

  payload += "6304" // CRC tag + length placeholder
  return payload + crc16(payload)
}

// Returns true if the string looks like a valid PromptPay target
// (10-digit mobile number or 13-digit national/tax ID).
export function isValidPromptPayId(target: string): boolean {
  const digits = target.replace(/[^0-9]/g, "")
  return digits.length === 10 || digits.length === 13
}

// Alias used by payment-requests API routes
export const generatePromptPayQR = buildPromptPayPayload
