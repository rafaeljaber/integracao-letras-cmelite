import { expect, test } from 'bun:test';
import { Alerts, type AlertInput } from '../src/alerts';

test('queda da ponte só avisa se ela estava conectada, uma vez por queda', () => {
  const sent: AlertInput[] = [];
  let t = 1000;
  const a = new Alerts((n) => sent.push(n), () => t);
  a.bridgeDown();
  expect(sent).toEqual([]);
  a.bridgeUp();
  a.bridgeDown();
  a.bridgeDown();
  expect(sent.map((n) => n.id)).toEqual(['cmelite-ponte-1000']);
  t = 2000;
  a.bridgeUp();
  a.bridgeDown();
  expect(sent.map((n) => n.id)).toEqual(['cmelite-ponte-1000', 'cmelite-ponte-2000']);
});

test('token recusado usa id fixo (a central não repete) e cita o endereço', () => {
  const sent: AlertInput[] = [];
  new Alerts((n) => sent.push(n)).authFailed('192.168.0.20', 'invalid token');
  expect(sent[0]).toMatchObject({ id: 'cmelite-token', level: 'warning' });
  expect(sent[0].body).toContain('192.168.0.20');
});

test('sessão perdida ou chamada repetida não acionam o sino', () => {
  const sent: AlertInput[] = [];
  const a = new Alerts((n) => sent.push(n));
  a.authFailed('10.0.0.5', 'invalid session');
  a.authFailed('10.0.0.5', 'invalid rid');
  expect(sent).toEqual([]);
});

test('falha ao publicar no sino não derruba o plugin', () => {
  const a = new Alerts(() => {
    throw new Error('sem central');
  });
  a.bridgeUp();
  expect(() => a.bridgeDown()).not.toThrow();
  expect(() => a.authFailed('10.0.0.5', 'invalid token')).not.toThrow();
});
