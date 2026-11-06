# Injected wallet connection on Rabdi

Run this in a user-triggered interaction. The user supplies their own free RPC key from [Hub access keys](https://hub.arkiv.network/access-keys); never give a browser the operator's server key. The chain definition embeds that key in its URL. Do not log the provider, chain object or raw errors.

```typescript
import { createWalletClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { custom, isAddress, type EIP1193Provider } from 'viem';

// Diagnostics contain only fixed messages and validated local transaction identifiers.
type SafeDetails = { txHash?: string; entityKey?: string; expiresAt?: bigint };
const safeErrors = new WeakMap<object, { message: string; details: SafeDetails }>();
function safeError(message = 'Arkiv operation failed', details: SafeDetails = {}): Error & SafeDetails {
  const allowed: SafeDetails = {};
  for (const field of ['txHash', 'entityKey'] as const) {
    const value = details[field];
    if (typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)) allowed[field] = value;
  }
  if (typeof details.expiresAt === 'bigint' && details.expiresAt >= 0n && details.expiresAt < 2n ** 64n) allowed.expiresAt = details.expiresAt;
  const result = Object.assign(new Error(message), allowed);
  safeErrors.set(result, { message, details: { ...allowed } });
  return result;
}
function sanitizedFailure(error: unknown, fallback = 'Arkiv request failed; reconcile any admitted write before retrying'): Error & SafeDetails {
  const own = error !== null && typeof error === 'object' ? safeErrors.get(error) : undefined;
  if (own) return safeError(own.message, own.details);
  // Preserve this exact cross-recipe preflight verdict, never any attached diagnostics.
  try { if (error instanceof Error && error.message === 'Unsigned preparation/estimate failed') return safeError('Unsigned preparation/estimate failed'); } catch {}
  return safeError(fallback);
}



export async function connectArkivWallet(provider: EIP1193Provider, userAccessKey: string) {
  try {
    const chain = rabdi({ accessKey: userAccessKey });
    const addresses = await provider.request({ method: 'eth_requestAccounts' });
    const account = addresses[0];
    if (!account || !isAddress(account)) throw safeError('Connect a valid account');
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x76edaf' }] });
    } catch (error) {
      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 4902) throw error;
      await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x76edaf',
        chainName: 'Rabdi', nativeCurrency: chain.nativeCurrency,
        rpcUrls: [chain.rpcUrls.default.http[0]], blockExplorerUrls: [chain.blockExplorers.default.url] }] });
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x76edaf' }] });
    }
    const actualChain = await provider.request({ method: 'eth_chainId' });
    if (BigInt(actualChain) !== 7794095n) throw safeError('Wallet is not on Rabdi');
    const current = await provider.request({ method: 'eth_accounts' });
    if (current[0]?.toLowerCase() !== account.toLowerCase()) throw safeError('Account changed during connection');
    return await createWalletClient({ chain, account, transport: custom(provider) });
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
```

Address-format validation does not prove EOA or account-abstraction compatibility. This helper requests connection/network configuration; it sends no entity transaction. Respect user rejection. Recheck account, chain, entity authorization and budget before signing.

Handle accountsChanged, chainChanged and disconnect by changing cache scope, clearing pending UI state and guarding late responses. Remove only your own listeners. Reconstruct a wallet client after address changes. App login and faucet sign-in are separate from wallet/RPC access.

Verify the intended wallet's unsigned request, nonce, selected RPC and approved transaction on Rabdi before claiming wallet-specific behavior. A local SDK signer test does not establish injected-wallet compatibility. Do not diagnose nonce problems from a generic RPC execution message alone.

Include explicit gas and network gasPrice in the wallet request; do not leave Rabdi estimation to MetaMask. Under exclusive account custody, read the transaction nonce at latest and check pending before proposing. Use first-write's measured floor of 1,000,000 plus 400,000 per extra batch operation, exact-operation estimate and approved fee budget; large bytes need at least twice measured maximum gas. Verify receipt.status. Allow at most one retry per operation, only after an authoritative reverted receipt proves gas exhaustion (`gasUsed === gasLimit`) and the SDK did not report success. Obtain a fresh unsigned estimate at `latest`; require the corrected gas to meet the operation floor and `2 × estimate`, at least double the previous gas cap, and satisfy `gas <= latestBlock.gasLimit / 2`. Use a fresh nonce and current network gasPrice, exclusive signer custody and approved balance/spend. Never resend after SDK success or an uncertain submission, even if a later receipt lookup is missing or disagrees. Non-gas reverts are terminal under this policy. Keep state reads at latest/pending to avoid head-only errors.

Source: [SDK chain](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/chains/rabdi.ts), [wallet client](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/clients/createWalletClient.ts).
