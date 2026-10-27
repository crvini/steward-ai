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
  FundSlug,
  UserRole,
  GiftFrequency,
  GiftStatus,
  TransactionDirection,
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

const DONORS = [
  { name: 'María González', email: 'maria.gonzalez@example.com', locale: 'es' },
  { name: 'James Carter', email: 'james.carter@example.com', locale: 'en' },
  { name: 'Ana Lucía Pérez', email: 'ana.perez@example.com', locale: 'es' },
  { name: 'David Mwangi', email: 'david.mwangi@example.com', locale: 'en' },
  { name: 'Sofía Ramírez', email: 'sofia.ramirez@example.com', locale: 'es' },
  { name: 'Grace Lin', email: 'grace.lin@example.com', locale: 'en' },
  { name: 'Carlos Herrera', email: 'carlos.herrera@example.com', locale: 'es' },
  { name: 'Rebecca Owens', email: 'rebecca.owens@example.com', locale: 'en' },
] as const;

const STAFF = [
  { name: 'Elena Morales', email: 'treasurer@hopechurch.example', role: UserRole.TREASURER, locale: 'es' },
  { name: 'Pastor Daniel Ruiz', email: 'pastor@hopechurch.example', role: UserRole.PASTOR, locale: 'es' },
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

      await prisma.transaction.create({
        data: {
          fundId: funds[slug].id,
          giftId: gift.id,
          direction: TransactionDirection.IN,
          amountCents,
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
    _sum: { amountCents: true },
  });
  for (const f of FUNDS) {
    const sum = totals.find((t) => t.fundId === funds[f.slug].id)?._sum.amountCents ?? 0;
    console.log(`[seed]   ${f.name.padEnd(14)} $${(sum / 100).toFixed(2)}`);
  }

  console.log('[seed] done');
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
