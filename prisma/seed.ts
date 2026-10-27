/**
 * Seeds the demo church so the treasurer dashboard is full from the first run.
 *
 * Deterministic on purpose: a fixed PRNG seed and a fixed anchor date mean two
 * people running `pnpm db:seed` get byte-identical data, which keeps demo
 * screenshots and the judges' walkthrough reproducible.
 *
 * Safe to re-run: it truncates the tables it owns first.
 */
import {
  PrismaClient,
  DistributionItemStatus,
  DistributionStatus,
  FundSlug,
  GiftFrequency,
  GiftStatus,
  ImpactUpdateStatus,
  TransactionDirection,
  TransactionSource,
  UserRole,
} from '@prisma/client';

const prisma = new PrismaClient();

/** Anchor so "two months of history" never drifts between runs. */
const TODAY = new Date('2026-10-26T12:00:00.000Z');
const HISTORY_DAYS = 61;

/** mulberry32 — tiny deterministic PRNG, enough for plausible demo amounts. */
function makeRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = makeRandom(20261026);

const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
const dollars = (value: number) => Math.round(value * 100);
const daysBefore = (days: number) => new Date(TODAY.getTime() - days * 86_400_000);

const FUNDS = [
  {
    slug: FundSlug.GENERAL,
    name: 'General Tithe',
    description: 'Day-to-day ministry: staff, utilities, Sunday services.',
    weight: 0.5,
  },
  {
    slug: FundSlug.MISSIONS,
    name: 'Missions',
    description: 'Support for missionaries the church has sent out.',
    weight: 0.25,
  },
  {
    slug: FundSlug.BENEVOLENCE,
    name: 'Benevolence',
    description: 'Emergency help for families in the congregation and neighborhood.',
    weight: 0.15,
  },
  {
    slug: FundSlug.BUILDING,
    name: 'Building',
    description: 'Repairs and the new childrens wing.',
    weight: 0.1,
  },
] as const;

/**
 * The first donor is the demo persona the entry screen offers to judges, so
 * its email is stable and referenced by the session route.
 */
const DONORS = [
  { name: 'Maria Lopez', email: 'member@hopechurch.example', locale: 'es' },
  { name: 'James Carter', email: 'james.carter@example.com', locale: 'en' },
  { name: 'Ana Lucía Pérez', email: 'ana.perez@example.com', locale: 'es' },
  { name: 'David Mwangi', email: 'david.mwangi@example.com', locale: 'en' },
  { name: 'Sofía Ramírez', email: 'sofia.ramirez@example.com', locale: 'es' },
  { name: 'Grace Lin', email: 'grace.lin@example.com', locale: 'en' },
  { name: 'Carlos Herrera', email: 'carlos.herrera@example.com', locale: 'es' },
  { name: 'Rebecca Owens', email: 'rebecca.owens@example.com', locale: 'en' },
] as const;

const STAFF = [
  { name: 'Daniel Ruiz', email: 'treasurer@hopechurch.example', role: UserRole.TREASURER, locale: 'es' },
  {
    name: 'Pastor Samuel Ortiz',
    email: 'pastor@hopechurch.example',
    role: UserRole.PASTOR,
    locale: 'es',
  },
] as const;

/**
 * PayPal sandbox Personal accounts stand in for these. Swap the emails for your
 * own sandbox receivers before running a live Payouts demo.
 */
const RECIPIENTS = [
  {
    name: 'Ruiz Family — Guatemala Highlands',
    paypalEmail: 'missionary-ruiz@personal.example.com',
    fundSlug: FundSlug.MISSIONS,
    maxPerPayout: 400,
    note: 'Monthly support, church plant in Quetzaltenango.',
  },
  {
    name: 'Kofi Mensah — West Africa',
    paypalEmail: 'missionary-mensah@personal.example.com',
    fundSlug: FundSlug.MISSIONS,
    maxPerPayout: 350,
    note: 'Monthly support, translation work.',
  },
  {
    name: 'Hope Benevolence Fund',
    paypalEmail: 'benevolence@hopechurch.example.com',
    fundSlug: FundSlug.BENEVOLENCE,
    maxPerPayout: 500,
    note: 'Disbursed by the deacons for rent, food and medical emergencies.',
  },
] as const;

const GIFT_AMOUNTS = [20, 25, 35, 40, 50, 60, 75, 100, 120, 150, 200, 250] as const;

/**
 * PayPal's cut, so the seeded ledger is not pretending gifts arrive whole.
 *
 * The rate is the one sandbox actually applied to a real capture on
 * 2026-10-26: $100.00 came in and the fee was $5.70, i.e. 5.4% + $0.30.
 * Fees are a real part of what a treasurer reconciles, and the donor receipt
 * shows them, so the demo data has to carry them too.
 */
const FEE_RATE = 0.054;
const FEE_FIXED_CENTS = 30;

const feeFor = (amountCents: number) => Math.round(amountCents * FEE_RATE) + FEE_FIXED_CENTS;

async function main() {
  console.log('[seed] clearing existing demo data');
  // Order matters: children before parents.
  await prisma.transaction.deleteMany();
  await prisma.impactUpdate.deleteMany();
  await prisma.distributionItem.deleteMany();
  await prisma.distribution.deleteMany();
  await prisma.gift.deleteMany();
  await prisma.recipient.deleteMany();
  await prisma.fund.deleteMany();
  await prisma.user.deleteMany();
  await prisma.church.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.webhookEvent.deleteMany();

  const church = await prisma.church.create({
    data: { name: 'Iglesia Esperanza / Hope Church', currency: 'USD' },
  });
  console.log(`[seed] church: ${church.name}`);

  const funds = Object.fromEntries(
    await Promise.all(
      FUNDS.map(async (f) => {
        const fund = await prisma.fund.create({
          data: {
            churchId: church.id,
            slug: f.slug,
            name: f.name,
            description: f.description,
          },
        });
        return [f.slug, fund] as const;
      }),
    ),
  ) as Record<FundSlug, { id: string }>;

  const staff = await Promise.all(
    STAFF.map((s) => prisma.user.create({ data: { churchId: church.id, ...s } })),
  );

  const donors = await Promise.all(
    DONORS.map((d) =>
      prisma.user.create({ data: { churchId: church.id, role: UserRole.DONOR, ...d } }),
    ),
  );
  console.log(`[seed] users: ${staff.length} staff, ${donors.length} donors`);

  await Promise.all(
    RECIPIENTS.map((r) =>
      prisma.recipient.create({
        data: {
          churchId: church.id,
          fundId: funds[r.fundSlug].id,
          name: r.name,
          paypalEmail: r.paypalEmail,
          maxPerPayoutCents: dollars(r.maxPerPayout),
          note: r.note,
        },
      }),
    ),
  );
  console.log(`[seed] recipients: ${RECIPIENTS.length}`);

  // Two of the eight donors give monthly; the rest give one-off gifts.
  const recurringDonors = donors.slice(0, 2);
  const weighted = FUNDS.flatMap((f) => Array<FundSlug>(Math.round(f.weight * 20)).fill(f.slug));

  let gifts = 0;
  for (let day = HISTORY_DAYS; day >= 0; day--) {
    const occurredAt = daysBefore(day);
    const isSunday = occurredAt.getUTCDay() === 0;
    // Sundays carry most of the giving; weekdays see the occasional online gift.
    const count = isSunday ? 3 + Math.floor(random() * 4) : random() < 0.35 ? 1 : 0;

    for (let i = 0; i < count; i++) {
      const donor = pick(donors);
      const slug = pick(weighted);
      const amountCents = dollars(pick(GIFT_AMOUNTS));
      const isRecurring =
        recurringDonors.some((d) => d.id === donor.id) && occurredAt.getUTCDate() === 1;

      const gift = await prisma.gift.create({
        data: {
          donorId: donor.id,
          fundId: funds[slug].id,
          amountCents,
          frequency: isRecurring ? GiftFrequency.MONTHLY : GiftFrequency.ONE_TIME,
          status: GiftStatus.COMPLETED,
          createdAt: occurredAt,
          completedAt: occurredAt,
        },
      });

      const feeCents = feeFor(amountCents);
      await prisma.transaction.create({
        data: {
          fundId: funds[slug].id,
          giftId: gift.id,
          direction: TransactionDirection.IN,
          amountCents,
          feeCents,
          netCents: amountCents - feeCents,
          source: TransactionSource.SEED,
          paypalRef: `SEED-IN-${gift.id}`,
          description: `${isRecurring ? 'Recurring' : 'One-time'} gift from ${donor.name}`,
          occurredAt,
        },
      });
      gifts++;
    }
  }
  console.log(`[seed] gifts: ${gifts} completed over ${HISTORY_DAYS} days`);

  const totals = await prisma.transaction.groupBy({
    by: ['fundId'],
    _sum: { amountCents: true, feeCents: true, netCents: true },
  });
  for (const f of FUNDS) {
    const row = totals.find((t) => t.fundId === funds[f.slug].id)?._sum;
    const gross = row?.amountCents ?? 0;
    const net = row?.netCents ?? 0;
    console.log(
      `[seed]   ${f.name.padEnd(14)} gross $${(gross / 100).toFixed(2)}  net $${(net / 100).toFixed(2)}`,
    );
  }

  // ── Repartos de muestra ──────────────────────────────────────────────────
  //
  // Sin esto el panel del tesorero y la bandeja del pastor abren vacíos, y un
  // juez que entra una sola vez no llega a ver de qué trata el producto. Son
  // deterministas y no llaman a la IA: el texto del razonamiento está escrito
  // acá a propósito, para que el seed no dependa de la red ni gaste tokens.
  const missions = funds[FundSlug.MISSIONS];
  const benevolence = funds[FundSlug.BENEVOLENCE];
  const treasurerUser = staff.find((u) => u.role === UserRole.TREASURER)!;
  const pastorUser = staff.find((u) => u.role === UserRole.PASTOR)!;

  const missionRecipients = await prisma.recipient.findMany({
    where: { fundId: missions.id },
    orderBy: { name: 'asc' },
  });

  const executedAt = daysBefore(9);
  const executed = await prisma.distribution.create({
    data: {
      fundId: missions.id,
      status: DistributionStatus.EXECUTED,
      aiRationale:
        'I kept both missionaries at the level they received last month and left $210 in the fund as a reserve. Paying either of them more would have gone over their per-payout limit.',
      treasurerApprovedBy: treasurerUser.email,
      treasurerApprovedAt: daysBefore(10),
      pastorApprovedBy: pastorUser.email,
      pastorApprovedAt: daysBefore(9),
      senderBatchId: 'steward-seed-missions',
      paypalBatchId: 'SEEDBATCH00001',
      executedAt,
      createdAt: daysBefore(11),
      items: {
        create: missionRecipients.map((r, i) => ({
          recipientId: r.id,
          amountCents: i === 0 ? 30_000 : 25_000,
          status: DistributionItemStatus.SUCCEEDED,
          paypalItemId: `SEEDITEM0000${i}`,
        })),
      },
    },
    include: { items: { include: { recipient: true } } },
  });

  await prisma.transaction.createMany({
    data: executed.items.map((item) => ({
      fundId: missions.id,
      distributionItemId: item.id,
      direction: TransactionDirection.OUT,
      amountCents: item.amountCents,
      paypalRef: `SEEDBATCH00001:${item.id}`,
      source: TransactionSource.PAYOUT,
      description: `Payout to ${item.recipient.name}`,
      occurredAt: executedAt,
    })),
  });

  // Reportes de impacto ya aprobados, para que el donante demo tenga algo que
  // leer al entrar.
  const missionDonors = await prisma.gift.findMany({
    where: { fundId: missions.id, status: GiftStatus.COMPLETED },
    select: { donorId: true },
    distinct: ['donorId'],
    take: 4,
  });

  // The demo persona must always be among them: she is the donor the judges
  // sign in as, and an empty "what your giving did" is the one view that
  // cannot afford to be empty.
  const demoDonor = donors[0]!;
  if (!missionDonors.some((d) => d.donorId === demoDonor.id)) {
    missionDonors.unshift({ donorId: demoDonor.id });
  }

  for (const { donorId } of missionDonors) {
    const donor = donors.find((d) => d.id === donorId);
    if (!donor) continue;
    const es = donor.locale === 'es';
    await prisma.impactUpdate.create({
      data: {
        donorId,
        distributionId: executed.id,
        locale: donor.locale,
        status: ImpactUpdateStatus.SENT,
        approvedAt: daysBefore(8),
        sentAt: daysBefore(8),
        body: es
          ? 'Tu ofrenda se unió al fondo de Misiones, que este mes repartió $550.00: $300.00 a la familia Ruiz en las Tierras Altas de Guatemala y $250.00 a Kofi Mensah en África Occidental. Gracias por sostener este trabajo mes a mes.'
          : 'Your gift joined the Missions fund, which distributed $550.00 this month: $300.00 to the Ruiz Family in the Guatemala Highlands and $250.00 to Kofi Mensah in West Africa. Thank you for keeping this work going.',
      },
    });
  }

  // Uno esperando la firma del pastor, para que su bandeja no abra vacía.
  const benevolenceRecipient = await prisma.recipient.findFirst({
    where: { fundId: benevolence.id },
  });
  if (benevolenceRecipient) {
    await prisma.distribution.create({
      data: {
        fundId: benevolence.id,
        status: DistributionStatus.TREASURER_APPROVED,
        aiRationale:
          'I proposed $400 to the benevolence fund, below its $500 limit, so that something is left for an emergency later in the month. There is no payment history to match, so please check whether this is the right level before approving.',
        treasurerApprovedBy: treasurerUser.email,
        treasurerApprovedAt: daysBefore(1),
        createdAt: daysBefore(1),
        items: {
          create: [{ recipientId: benevolenceRecipient.id, amountCents: 40_000 }],
        },
      },
    });
  }

  console.log(`[seed] distributions: 1 executed with ${missionDonors.length} impact notes, 1 awaiting the pastor`);

  console.log('[seed] done');
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
