const SEPOLIA = "0xaa36a7";
export async function discoverProviders() {
  const providers = new Map();
  const announce = (event) => { if (event.detail?.info?.uuid && event.detail.provider?.request) providers.set(event.detail.info.uuid, event.detail); };
  window.addEventListener("eip6963:announceProvider", announce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => setTimeout(resolve, 300));
  window.removeEventListener("eip6963:announceProvider", announce);
  if (!providers.size && window.ethereum?.request) providers.set("legacy", { info: { name: window.ethereum.isMetaMask ? "MetaMask" : "Browser wallet" }, provider: window.ethereum });
  return [...providers.values()];
}
export async function connectProvider(provider) {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.[0]) throw new Error("Select a wallet account to continue.");
  return accounts[0];
}
export async function signBrowser(provider, typedData, expectedAccount, network) {
  const account = await connectProvider(provider);
  if (account.toLowerCase() !== expectedAccount.toLowerCase()) throw new Error("Your wallet account changed. Select the intended signer and try again.");
  if ((await provider.request({ method: "eth_chainId" })).toLowerCase() !== SEPOLIA) {
    try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA }] }); }
    catch (error) {
      if (error.code !== 4902) throw error;
      await provider.request({ method: "wallet_addEthereumChain", params: [network] });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA }] });
    }
  }
  const current = await provider.request({ method: "eth_accounts" });
  if (current?.[0]?.toLowerCase() !== expectedAccount.toLowerCase()) throw new Error("The signing account changed during network selection.");
  return provider.request({ method: "eth_signTypedData_v4", params: [expectedAccount, JSON.stringify(typedData)] });
}
