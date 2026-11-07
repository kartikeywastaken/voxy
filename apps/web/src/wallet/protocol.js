import { encodeAbiParameters, getAddress, keccak256 } from "viem";
import { domainFields, eoaChainId, eoaDomain, eoaRecoveryHash, eoaTypes, hex, parseEnrollment, parseEOARecovery, record, uint } from "@voxy/chain/eoa";
const zero = "0x0000000000000000000000000000000000000000";
const callsType = [{ type: "tuple[]", components: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }] }];
function timing(deadline, maximum) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (deadline < now || deadline > now + BigInt(maximum)) throw new Error("The signing request has expired or has an unexpected lifetime.");
}
function typed(account, name, message) { return { domain: eoaDomain(account), types: { EIP712Domain: domainFields, [name]: eoaTypes[name] }, primaryType: name, message }; }
export function enrollmentData(prepared, account, guardians, implementation) {
  const message = parseEnrollment(prepared.message);
  const expected = [...guardians.map((g) => getAddress(g))]; while (expected.length < 3) expected.push(zero);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (message.account !== getAddress(account) || message.implementation !== getAddress(implementation) || message.delay !== 180n || message.threshold !== Math.floor(guardians.length / 2) + 1 || [message.guardian0, message.guardian1, message.guardian2].some((g, i) => g !== expected[i]) || message.expiresAt < now + 364n * 86400n || message.expiresAt > now + 367n * 86400n) throw new Error("The enrollment differs from the account, guardians or waiting period you chose.");
  timing(message.deadline, 900);
  return typed(message.account, "Enrollment", message);
}
export function executionData(prepared, account, calls) {
  const input = record(prepared.message);
  const message = { account: getAddress(input.account), callsHash: hex(input.callsHash, 32), nonce: uint(input.nonce, 256), deadline: uint(input.deadline) };
  if (message.account !== getAddress(account) || message.callsHash !== keccak256(encodeAbiParameters(callsType, [calls]))) throw new Error("The signed calls differ from the action you reviewed.");
  timing(message.deadline, 900);
  return typed(message.account, "Execution", message);
}
export function recoveryData(input, account, controller, expectedDigest) {
  const message = parseEOARecovery(input);
  if (message.chainId !== BigInt(eoaChainId) || message.account !== getAddress(account) || (controller && message.newController !== getAddress(controller)) || (expectedDigest && eoaRecoveryHash(message) !== expectedDigest)) throw new Error("The recovery differs from the account, replacement controller or shared request.");
  timing(message.deadline, 86400);
  return typed(message.account, "RecoveryDigest", message);
}
export function validateExpiry(value) {
  const expiry = uint(value), now = BigInt(Math.floor(Date.now() / 1000));
  if (expiry < now + 364n * 86400n || expiry > now + 367n * 86400n) throw new Error("Guardian expiry differs from the one-year policy.");
  return expiry;
}
export function authorizationData(prepared, implementation) {
  const auth = prepared.authorization;
  if (!auth || auth.address.toLowerCase() !== implementation.toLowerCase() || auth.chainId !== eoaChainId || !Number.isSafeInteger(auth.nonce) || auth.nonce < 0) throw new Error("Unexpected EIP-7702 authorization.");
  return { address: getAddress(implementation), chainId: eoaChainId, nonce: auth.nonce };
}
