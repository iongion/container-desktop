// A dedicated, seeded faker instance. We build a fresh `new Faker(...)` per engine (rather than mutating
// the shared `faker` singleton) so generation streams never interleave and importing the generator from a
// test can't perturb global faker state. setDefaultRefDate is the load-bearing call: without it faker.date.*
// reads the wall clock and the dataset churns between runs.

import { base, en, Faker } from "@faker-js/faker";

import { REF_DATE } from "./config";

export function buildFaker(seed: number): Faker {
  const faker = new Faker({ locale: [en, base] });
  faker.seed(seed);
  faker.setDefaultRefDate(REF_DATE);
  return faker;
}
