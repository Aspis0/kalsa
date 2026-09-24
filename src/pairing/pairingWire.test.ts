import { bytesToHex, hexToBytes, hmacSha256, utf8Bytes } from "./sha256";
import {
  canonicalPhoneJson,
  openCredentialSeal,
  phoneMacPayload,
  phoneMacHex,
  type PairingPhoneDeclaration,
} from "./pairingWire";

const phone: PairingPhoneDeclaration = {
  weights_bytes: 2_200_000_000,
  parameters: { total: 7_600_000_000, active: 2_400_000_000 },
  measured_tokens_per_second: 9.5,
  battery_powered: true,
};
const code = "31".repeat(16);
const nonce = "32".repeat(32);

describe("pairing wire vectors", () => {
  test("canonical JSON keeps the fixed field order and serde_json integral-f64 spelling", () => {
    expect(canonicalPhoneJson({
      weights_bytes: 12,
      parameters: null,
      measured_tokens_per_second: 10,
      battery_powered: null,
    })).toBe(
      '{"weights_bytes":12,"parameters":null,"measured_tokens_per_second":10.0,"battery_powered":null}',
    );
    expect(canonicalPhoneJson(phone)).toBe(
      '{"weights_bytes":2200000000,"parameters":{"total":7600000000,"active":2400000000},"measured_tokens_per_second":9.5,"battery_powered":true}',
    );
  });

  test("A: frozen phone MAC with empty node and empty vector token", () => {
    expect(phoneMacHex(code, nonce, {
      reachable: "http://192.168.1.10:4952",
      node: "",
      deliveryToken: "",
      phone,
    })).toBe("51e82d91c365352b430a40533ec8ea76966762ac1413557712e110889b44905e");
  });

  test("B: frozen phone MAC includes the node string", () => {
    expect(phoneMacHex(code, nonce, {
      reachable: "http://192.168.1.10:4952",
      node: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      deliveryToken: "",
      phone,
    })).toBe("0503754d7ad8a465ffcf82506231bf961da877ff802087c8f8c5756da0de0d83");
  });

  test("D: Python real-shape vector signs the minted token as ASCII", () => {
    const input = {
      reachable: "http://127.0.0.1:8132",
      node: "",
      deliveryToken: "c0".repeat(16),
      phone,
    };
    expect(phoneMacHex(code, nonce, input)).toBe(
      "ad34a8b2731b0a0e3d41f09d498e4f206333c1c1a67d3421f62b0659324f4132",
    );
    expect(bytesToHex(phoneMacPayload(input))).toBe(
      "0000000000000015687474703a2f2f3132372e302e302e313a38313332" +
      "00000000000000000000000000000020" + "6330".repeat(16) +
      "000000000000008a7b22776569676874735f6279746573223a323230303030303030302c22706172616d6574657273223a7b22746f74616c223a373630303030303030302c22616374697665223a323430303030303030307d2c226d656173757265645f746f6b656e735f7065725f7365636f6e64223a392e352c22626174746572795f706f7765726564223a747275657d",
    );
  });

  test("C: authenticate the ciphertext before opening the 32-byte credential", () => {
    const key = hexToBytes("41".repeat(16));
    const iv = hexToBytes("42".repeat(32));
    const ciphertext = "19d0b3455e311a70ba202aea83ea569e8127f2f1936f67bdc557439a82222ba7";
    const mac = "6d86a29391e258de9bb13dae9ceb3612143c4448050562a36ad2e6ac8dd4a849";
    expect(bytesToHex(openCredentialSeal(key, iv, ciphertext, mac))).toBe("ab".repeat(32));
    expect(() => openCredentialSeal(key, iv, ciphertext.slice(2), mac)).toThrow();
    expect(() => openCredentialSeal(key, iv, ciphertext, "00".repeat(32))).toThrow();
  });

  test("HMAC primitive matches RFC 4231 case 1", () => {
    expect(bytesToHex(hmacSha256(new Uint8Array(20).fill(0x0b), utf8Bytes("Hi There")))).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
  });
});
