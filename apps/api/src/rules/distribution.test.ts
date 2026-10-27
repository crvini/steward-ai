import { describe, expect, it } from 'vitest';

import { checkDistribution, type RecipientFacts } from './distribution.js';

const FONDO = 'fund-missions';
const OTRO_FONDO = 'fund-building';

const LIMITES = { maxPerItemCents: 50_000, maxPerBatchCents: 200_000 };

const RECEPTORES: RecipientFacts[] = [
  {
    id: 'r-ruiz',
    name: 'Ruiz Family',
    fundId: FONDO,
    active: true,
    maxPerPayoutCents: 40_000,
    paypalEmail: 'ruiz@personal.example.com',
  },
  {
    id: 'r-mensah',
    name: 'Kofi Mensah',
    fundId: FONDO,
    active: true,
    maxPerPayoutCents: 35_000,
    paypalEmail: 'mensah@personal.example.com',
  },
  {
    id: 'r-inactivo',
    name: 'Former Missionary',
    fundId: FONDO,
    active: false,
    maxPerPayoutCents: 40_000,
    paypalEmail: 'former@personal.example.com',
  },
  {
    id: 'r-otro-fondo',
    name: 'Building Contractor',
    fundId: OTRO_FONDO,
    active: true,
    maxPerPayoutCents: 40_000,
    paypalEmail: 'contractor@personal.example.com',
  },
];

const revisar = (lines: { recipientId: string; amountCents: number }[], saldo = 500_000) =>
  checkDistribution({
    fundId: FONDO,
    fundBalanceCents: saldo,
    recipients: RECEPTORES,
    lines,
    limits: LIMITES,
  });

describe('un reparto válido', () => {
  it('pasa y suma lo pagable', () => {
    const v = revisar([
      { recipientId: 'r-ruiz', amountCents: 30_000 },
      { recipientId: 'r-mensah', amountCents: 25_000 },
    ]);

    expect(v.executable).toBe(true);
    expect(v.payableCents).toBe(55_000);
    expect(v.lines.every((l) => l.ok)).toBe(true);
    expect(v.batchViolations).toHaveLength(0);
  });
});

describe('lista blanca de destinatarios', () => {
  it('rechaza a alguien que no está en la lista', () => {
    const v = revisar([{ recipientId: 'r-inventado', amountCents: 10_000 }]);
    expect(v.lines[0]?.violations.map((x) => x.code)).toContain('RECIPIENT_UNKNOWN');
    expect(v.executable).toBe(false);
  });

  it('rechaza a un destinatario inactivo', () => {
    const v = revisar([{ recipientId: 'r-inactivo', amountCents: 10_000 }]);
    expect(v.lines[0]?.violations.map((x) => x.code)).toContain('RECIPIENT_INACTIVE');
  });

  it('rechaza a quien no recibe de este fondo', () => {
    // La contabilidad por fondos designados es la promesa central: un dólar
    // de misiones no puede salir hacia un contratista de construcción.
    const v = revisar([{ recipientId: 'r-otro-fondo', amountCents: 10_000 }]);
    expect(v.lines[0]?.violations.map((x) => x.code)).toContain('RECIPIENT_WRONG_FUND');
  });
});

describe('límites por monto', () => {
  it('rechaza por encima del tope del destinatario', () => {
    const v = revisar([{ recipientId: 'r-mensah', amountCents: 35_001 }]);
    expect(v.lines[0]?.violations.map((x) => x.code)).toContain('OVER_RECIPIENT_LIMIT');
  });

  it('acepta exactamente el tope del destinatario', () => {
    const v = revisar([{ recipientId: 'r-mensah', amountCents: 35_000 }]);
    expect(v.lines[0]?.ok).toBe(true);
  });

  it('rechaza por encima del tope global por pago', () => {
    const generoso: RecipientFacts[] = [
      { ...RECEPTORES[0]!, maxPerPayoutCents: 999_999 },
    ];
    const v = checkDistribution({
      fundId: FONDO,
      fundBalanceCents: 999_999,
      recipients: generoso,
      lines: [{ recipientId: 'r-ruiz', amountCents: 50_001 }],
      limits: LIMITES,
    });
    expect(v.lines[0]?.violations.map((x) => x.code)).toContain('OVER_ITEM_LIMIT');
  });

  it('rechaza montos no positivos y centavos fraccionarios', () => {
    const cero = revisar([{ recipientId: 'r-ruiz', amountCents: 0 }]);
    expect(cero.lines[0]?.violations.map((x) => x.code)).toContain('AMOUNT_NOT_POSITIVE');

    const negativo = revisar([{ recipientId: 'r-ruiz', amountCents: -500 }]);
    expect(negativo.lines[0]?.violations.map((x) => x.code)).toContain('AMOUNT_NOT_POSITIVE');

    const fraccion = revisar([{ recipientId: 'r-ruiz', amountCents: 100.5 }]);
    expect(fraccion.lines[0]?.violations.map((x) => x.code)).toContain('AMOUNT_NOT_WHOLE_CENTS');
  });
});

describe('reglas del lote', () => {
  it('rechaza si el lote supera el tope', () => {
    const muchos: RecipientFacts[] = Array.from({ length: 6 }, (_, i) => ({
      id: `r-${i}`,
      name: `Receptor ${i}`,
      fundId: FONDO,
      active: true,
      maxPerPayoutCents: 50_000,
      paypalEmail: `r${i}@personal.example.com`,
    }));
    const v = checkDistribution({
      fundId: FONDO,
      fundBalanceCents: 999_999,
      recipients: muchos,
      lines: muchos.map((r) => ({ recipientId: r.id, amountCents: 50_000 })),
      limits: LIMITES,
    });

    // Cada línea es válida por separado; el lote de $3,000 no lo es.
    expect(v.lines.every((l) => l.ok)).toBe(true);
    expect(v.batchViolations.map((b) => b.code)).toContain('OVER_BATCH_LIMIT');
    expect(v.executable).toBe(false);
  });

  it('rechaza si el fondo no tiene saldo', () => {
    const v = revisar([{ recipientId: 'r-ruiz', amountCents: 30_000 }], 20_000);
    expect(v.batchViolations.map((b) => b.code)).toContain('INSUFFICIENT_FUND_BALANCE');
    expect(v.executable).toBe(false);
  });

  it('rechaza un reparto vacío', () => {
    const v = revisar([]);
    expect(v.batchViolations.map((b) => b.code)).toContain('NO_VALID_LINES');
    expect(v.executable).toBe(false);
  });

  it('rechaza pagar dos veces al mismo destinatario', () => {
    const v = revisar([
      { recipientId: 'r-ruiz', amountCents: 10_000 },
      { recipientId: 'r-ruiz', amountCents: 10_000 },
    ]);
    expect(v.lines[1]?.violations.map((x) => x.code)).toContain('DUPLICATE_RECIPIENT');
    expect(v.executable).toBe(false);
  });
});

describe('lo que el tesorero tiene que poder ver', () => {
  it('conserva las líneas rechazadas en lugar de descartarlas', () => {
    const v = revisar([
      { recipientId: 'r-ruiz', amountCents: 30_000 },
      { recipientId: 'r-inactivo', amountCents: 20_000 },
    ]);

    // Descartar en silencio lo que la IA intentó haría invisible justo lo
    // que hay que revisar.
    expect(v.lines).toHaveLength(2);
    expect(v.lines[1]?.ok).toBe(false);
    expect(v.lines[1]?.recipientName).toBe('Former Missionary');
  });

  it('una sola línea mala impide ejecutar todo el lote', () => {
    const v = revisar([
      { recipientId: 'r-ruiz', amountCents: 30_000 },
      { recipientId: 'r-inactivo', amountCents: 20_000 },
    ]);

    // "Casi bien" no se ejecuta: el tesorero quita la línea primero.
    expect(v.executable).toBe(false);
    expect(v.payableCents).toBe(30_000);
  });

  it('cada rechazo trae una explicación para mostrar en pantalla', () => {
    const v = revisar([{ recipientId: 'r-mensah', amountCents: 40_000 }]);
    const violacion = v.lines[0]?.violations[0];
    expect(violacion?.detail).toContain('Kofi Mensah');
    expect(violacion?.detail).toMatch(/\$350\.00/);
  });
});

describe('reporte de todas las reglas', () => {
  it('siempre informa cada regla, pase o falle', () => {
    const v = revisar([{ recipientId: 'r-ruiz', amountCents: 30_000 }]);

    // Mostrar sólo los fallos deja al lector adivinando qué más se revisó, y
    // "¿qué más revisaste?" es justo lo que un guardarraíl debe contestar.
    expect(v.checks.length).toBeGreaterThanOrEqual(11);
    expect(v.checks.every((c) => c.passed)).toBe(true);
    expect(v.checks.every((c) => c.label.length > 0)).toBe(true);
  });

  it('marca la regla que falló y deja el resto en pasa', () => {
    const v = revisar([{ recipientId: 'r-otro-fondo', amountCents: 10_000 }]);

    const fondo = v.checks.find((c) => c.code === 'RECIPIENT_WRONG_FUND');
    expect(fondo?.passed).toBe(false);
    expect(fondo?.detail).toContain('Building Contractor');

    const duplicado = v.checks.find((c) => c.code === 'DUPLICATE_RECIPIENT');
    expect(duplicado?.passed).toBe(true);
    expect(duplicado?.detail).toBeUndefined();
  });

  it('informa también las reglas del lote, no solo las de línea', () => {
    const v = revisar([{ recipientId: 'r-ruiz', amountCents: 30_000 }], 20_000);

    const saldo = v.checks.find((c) => c.code === 'INSUFFICIENT_FUND_BALANCE');
    expect(saldo?.passed).toBe(false);
    expect(saldo?.detail).toMatch(/\$200\.00/);
  });

  it('el conteo de reglas no cambia según el resultado', () => {
    const bien = revisar([{ recipientId: 'r-ruiz', amountCents: 30_000 }]);
    const mal = revisar([{ recipientId: 'r-inactivo', amountCents: 999_999 }]);

    // Si la lista encogiera cuando todo pasa, la pantalla mostraría menos
    // reglas en el caso bueno, que es justo cuando hay que demostrar
    // cuántas se revisaron.
    expect(mal.checks.length).toBe(bien.checks.length);
  });
});
