// Gera o token de acesso do CMElite com o gerador criptográfico do sistema
// (o sandbox do plugin só tem Math.random, por isso quem gera é a ponte).
// O CMElite costuma ficar em outro computador: o token é lido no painel e digitado lá,
// então vem em blocos de 4, só maiúsculas e números, sem 0/O e 1/I.
import { randomInt } from 'node:crypto';

export const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateToken(blocks = 3, blockSize = 4): string {
  const parts: string[] = [];
  for (let b = 0; b < blocks; b++) {
    let part = '';
    for (let i = 0; i < blockSize; i++) part += TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)];
    parts.push(part);
  }
  return parts.join('-');
}
