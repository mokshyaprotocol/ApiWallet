import { describe, it, expect } from "vitest";
import { encodePumpBuy, encodePumpSell, PUMP_BUY_DISC, PUMP_SELL_DISC } from "../src/venues/pumpSwap.js";
import { encodeMeteoraSwap2, METEORA_SWAP2_DISC } from "../src/venues/meteoraDlmm.js";

describe("venue instruction data encoders", () => {
  it("pumpswap buy: [disc(8), baseOut u64le, maxQuoteIn u64le]", () => {
    const d = encodePumpBuy(1n, 2n);
    expect(Array.from(d.slice(0, 8))).toEqual(Array.from(PUMP_BUY_DISC));
    expect(d[8]).toBe(1);
    expect(d[16]).toBe(2);
    expect(d.length).toBe(24);
  });

  it("pumpswap sell: correct discriminator + args", () => {
    const d = encodePumpSell(256n, 0n);
    expect(Array.from(d.slice(0, 8))).toEqual(Array.from(PUMP_SELL_DISC));
    expect(d[8]).toBe(0); // 256 = 0x0100 LE -> byte8=0, byte9=1
    expect(d[9]).toBe(1);
  });

  it("meteora swap2: [disc(8), amountIn u64le, minOut u64le, emptyRemainingInfo]", () => {
    const d = encodeMeteoraSwap2(5n, 3n);
    expect(Array.from(d.slice(0, 8))).toEqual(Array.from(METEORA_SWAP2_DISC));
    expect(d[8]).toBe(5);
    expect(d[16]).toBe(3);
    expect(d.length).toBe(28); // + 4-byte empty RemainingAccountsInfo
    expect(Array.from(d.slice(24))).toEqual([0, 0, 0, 0]);
  });
});
