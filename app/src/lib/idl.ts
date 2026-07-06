/**
 * Minimal Anchor IDL for the delegated_trading program — enough for the app to
 * build `create_session` / `execute_trade` instructions and decode the
 * TradingSession account. Field order matches the on-chain struct exactly.
 */
export const IDL: any = {
  version: "0.1.0",
  name: "delegated_trading",
  instructions: [
    {
      name: "createSession",
      accounts: [
        { name: "owner", isMut: true, isSigner: true },
        { name: "session", isMut: true, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "sessionPubkey", type: "publicKey" },
        { name: "expiresAt", type: "i64" },
        { name: "maxTradeAmount", type: "u64" },
        { name: "dailyTradeLimit", type: "u64" },
        { name: "allowedPrograms", type: { vec: "publicKey" } },
        { name: "allowedInputTokens", type: { vec: "publicKey" } },
        { name: "allowedOutputTokens", type: { vec: "publicKey" } },
      ],
    },
    {
      name: "executeTrade",
      accounts: [
        { name: "sessionSigner", isMut: false, isSigner: true },
        { name: "session", isMut: true, isSigner: false },
        { name: "jupiterProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "amountIn", type: "u64" },
        { name: "inputMint", type: "publicKey" },
        { name: "outputMint", type: "publicKey" },
        { name: "expectedNonce", type: "u64" },
        { name: "routeData", type: "bytes" },
      ],
    },
    {
      name: "revokeSession",
      accounts: [
        { name: "owner", isMut: false, isSigner: true },
        { name: "session", isMut: true, isSigner: false },
      ],
      args: [],
    },
  ],
  accounts: [
    {
      name: "TradingSession",
      type: {
        kind: "struct",
        fields: [
          { name: "owner", type: "publicKey" },
          { name: "sessionPubkey", type: "publicKey" },
          { name: "createdAt", type: "i64" },
          { name: "expiresAt", type: "i64" },
          { name: "revoked", type: "bool" },
          { name: "maxTradeAmount", type: "u64" },
          { name: "dailyTradeLimit", type: "u64" },
          { name: "dailyVolumeUsed", type: "u64" },
          { name: "dailyWindowStart", type: "i64" },
          { name: "allowedPrograms", type: { vec: "publicKey" } },
          { name: "allowedInputTokens", type: { vec: "publicKey" } },
          { name: "allowedOutputTokens", type: { vec: "publicKey" } },
          { name: "nonce", type: "u64" },
          { name: "bump", type: "u8" },
        ],
      },
    },
  ],
};
