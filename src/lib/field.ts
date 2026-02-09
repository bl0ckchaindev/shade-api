/** BN254 scalar field prime - circuit field modulus. Commitments must be < this. */
export const FIELD_SIZE = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

export function modField(value: string | bigint): string {
  const v = typeof value === 'string' ? BigInt(value) : value;
  return (v % FIELD_SIZE + FIELD_SIZE) % FIELD_SIZE + '';
}
