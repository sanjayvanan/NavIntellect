import argon2 from 'argon2';

export const hashPassword = (pw: string) =>
  argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });

export const verifyPassword = (hash: string, pw: string) => argon2.verify(hash, pw).catch(() => false);
